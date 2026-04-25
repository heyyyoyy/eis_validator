use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use futures::StreamExt;
use rig::{completion::CompletionModel, streaming::StreamedAssistantContent};
use serde::Deserialize;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, warn};

use crate::error::AppError;
use crate::repository::eis_documents::EisDocuments;
use crate::state::AppState;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Rough character budget for retrieved context (≈ 3 000 tokens at 4 chars/token).
/// Keeps the prompt well within gpt-4o-mini's 128 k token window while leaving
/// room for the system preamble, user query, and the model's response.
const MAX_CONTEXT_CHARS: usize = 12_000;

/// Default number of chunks to retrieve from the vector store.
const DEFAULT_TOP_K: u64 = 5;

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct QueryRequest {
    /// User's natural-language question.
    pub query: String,
    /// How many candidate chunks to retrieve (default: 5).
    pub top_k: Option<u64>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// POST /query
///
/// 1. Embeds the user query and retrieves the most similar chunks from SQLite.
/// 2. Truncates context to `MAX_CONTEXT_CHARS` characters.
/// 3. Builds a RAG prompt and streams the OpenAI response back as SSE.
pub async fn query_handler(
    State(state): State<Option<Arc<AppState>>>,
    Json(payload): Json<QueryRequest>,
) -> Result<Response, AppError> {
    // Guard: RAG subsystem unavailable (missing API key or DB).
    let state = match state {
        Some(s) => s,
        None => {
            tracing::warn!("Query request rejected: RAG subsystem is unavailable");
            return Err(AppError::ServiceUnavailable);
        }
    };

    let query = payload.query.trim().to_string();
    if query.is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let top_k = payload.top_k.unwrap_or(DEFAULT_TOP_K);

    // ── Step 1: vector similarity search ─────────────────────────────────────
    let results: Vec<(f64, EisDocuments)> =
        state.repository.search(&query, top_k).await.map_err(|e| {
            tracing::error!("Vector search failed: {e}");
            AppError::InternalMsg(e.to_string())
        })?;

    debug!(
        query_len = query.len(),
        top_k,
        retrieved = results.len(),
        "RAG retrieval finished"
    );
    if let Some((score, chunk)) = results.first() {
        debug!(
            top_score = *score,
            top_source = %chunk.file_name,
            top_page = %chunk.page,
            "RAG top chunk selected"
        );
    }

    // ── Step 2: build context, truncate to token budget ───────────────────────
    let context_text = build_context(&results);
    let has_context = !context_text.is_empty();
    debug!(
        has_context,
        context_chars = context_text.len(),
        "RAG context assembled"
    );

    // ── Step 3: build the prompt ──────────────────────────────────────────────
    let system_prompt = build_system_prompt(&context_text, has_context);

    // ── Step 4: start streaming completion ───────────────────────────────────
    let mut stream = state
        .completion_model
        .completion_request(&query)
        .preamble(system_prompt)
        .stream()
        .await
        .map_err(|e| {
            tracing::error!("Completion request failed: {e}");
            AppError::InternalMsg(e.to_string())
        })?;

    // ── Step 5: pipe streaming chunks into an SSE body ────────────────────────
    // Use a bounded channel to decouple the rig stream from the HTTP body stream.
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(64);

    tokio::spawn(async move {
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(StreamedAssistantContent::Text(t)) => {
                    let sse = format!("data: {}\n\n", t.text);
                    if tx.send(Ok(Bytes::from(sse))).await.is_err() {
                        break; // client disconnected
                    }
                }
                Ok(StreamedAssistantContent::Final(_)) => {
                    // Final usage info — not forwarded to the client.
                }
                Ok(_) => {} // Tool calls, reasoning deltas — ignored for RAG
                Err(e) => {
                    warn!("Streaming error: {e}");
                    let msg = format!("data: [ERROR] {}\n\n", e);
                    let _ = tx.send(Ok(Bytes::from(msg))).await;
                    break;
                }
            }
        }
        // Signal end of stream.
        let _ = tx.send(Ok(Bytes::from("data: [DONE]\n\n"))).await;
    });

    let body_stream = ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(body_stream);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    // Prevent nginx / proxies from buffering the SSE stream.
    headers.insert(
        header::HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );

    Ok((StatusCode::OK, headers, body).into_response())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Accumulate chunk content strings, respecting `MAX_CONTEXT_CHARS`.
/// Chunks are already ordered by descending similarity score.
pub(crate) fn build_context(results: &[(f64, EisDocuments)]) -> String {
    if results.is_empty() {
        return String::new();
    }

    let mut parts: Vec<String> = Vec::new();
    let mut total_chars: usize = 0;

    for (score, chunk) in results {
        let content = chunk.content.trim();
        if content.is_empty() {
            continue;
        }

        let entry = format!(
            "[{file} p.{page}] (score: {score:.3})\n{content}",
            file = chunk.file_name,
            page = chunk.page,
            score = score,
            content = content,
        );

        if total_chars + entry.len() > MAX_CONTEXT_CHARS {
            // Try to fit a truncated version of this chunk.
            let remaining = MAX_CONTEXT_CHARS.saturating_sub(total_chars);
            if remaining > 50 {
                let truncated = &entry[..remaining];
                parts.push(truncated.to_string());
            }
            break;
        }

        total_chars += entry.len();
        parts.push(entry);
    }

    parts.join("\n\n")
}

pub(crate) fn build_system_prompt(context: &str, has_context: bool) -> String {
    if has_context {
        format!(
            "You are a helpful assistant. Answer the user's question using the \
             retrieved document excerpts below. Respond in the same language as the user’s query. \
             Cite source files and page numbers \
             where relevant. If the excerpts do not contain enough information, say so.\n\n\
             --- Retrieved context ---\n{context}\n--- End of context ---",
            context = context,
        )
    } else {
        "You are a helpful assistant. No relevant documents were found in the \
         knowledge base for this query. Do not answer from general knowledge. \
         Tell the user you could not find relevant excerpts and ask a clarifying query. \
         Respond in the same language as the user’s query."
            .to_string()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: &str, file_name: &str, page: i64, content: &str) -> EisDocuments {
        EisDocuments {
            id: id.to_string(),
            file_name: file_name.to_string(),
            page: page.to_string(),
            chunk_index: "0".into(),
            content: content.to_string(),
        }
    }

    // ── build_context ─────────────────────────────────────────────────────────

    #[test]
    fn context_empty_when_no_results() {
        assert_eq!(build_context(&[]), "");
    }

    #[test]
    fn context_skips_whitespace_only_chunks() {
        let results = vec![(0.9, chunk("1", "doc.pdf", 1, "   \n\t  "))];
        assert_eq!(build_context(&results), "");
    }

    #[test]
    fn context_formats_single_chunk() {
        let results = vec![(0.85, chunk("1", "doc.pdf", 3, "Hello world"))];
        let ctx = build_context(&results);
        assert!(ctx.contains("[doc.pdf p.3]"));
        assert!(ctx.contains("score: 0.850"));
        assert!(ctx.contains("Hello world"));
    }

    #[test]
    fn context_joins_multiple_chunks_with_blank_line() {
        let results = vec![
            (0.9, chunk("1", "a.pdf", 1, "First")),
            (0.8, chunk("2", "b.pdf", 2, "Second")),
        ];
        let ctx = build_context(&results);
        assert!(ctx.contains("First"));
        assert!(ctx.contains("Second"));
        // Separator between entries
        assert!(ctx.contains("\n\n"));
    }

    #[test]
    fn context_truncates_at_budget() {
        // Single chunk whose content alone exceeds the budget
        let big_content = "x".repeat(MAX_CONTEXT_CHARS + 1000);
        let results = vec![(1.0, chunk("1", "big.pdf", 1, &big_content))];
        let ctx = build_context(&results);
        assert!(ctx.len() <= MAX_CONTEXT_CHARS);
    }

    #[test]
    fn context_drops_chunk_that_would_barely_fit() {
        // Fill budget with the first chunk, then add a tiny second one.
        // The second chunk should be dropped (remaining < 50 chars after header).
        let first_content = "a".repeat(MAX_CONTEXT_CHARS - 30);
        let results = vec![
            (0.9, chunk("1", "f.pdf", 1, &first_content)),
            (0.8, chunk("2", "g.pdf", 2, "tiny")),
        ];
        let ctx = build_context(&results);
        assert!(!ctx.contains("tiny"));
    }

    #[test]
    fn context_trims_chunk_content() {
        let results = vec![(0.7, chunk("1", "doc.pdf", 1, "  trimmed  "))];
        let ctx = build_context(&results);
        // Should contain the trimmed text, not leading/trailing spaces
        assert!(ctx.contains("trimmed"));
        assert!(!ctx.contains("  trimmed  "));
    }

    // ── build_system_prompt ───────────────────────────────────────────────────

    #[test]
    fn prompt_with_context_includes_context_block() {
        let prompt = build_system_prompt("some context", true);
        assert!(prompt.contains("--- Retrieved context ---"));
        assert!(prompt.contains("some context"));
        assert!(prompt.contains("--- End of context ---"));
    }

    #[test]
    fn prompt_without_context_mentions_no_documents() {
        let prompt = build_system_prompt("", false);
        assert!(prompt.contains("No relevant documents were found"));
        assert!(!prompt.contains("Retrieved context"));
    }

    #[test]
    fn prompt_with_context_instructs_citation() {
        let prompt = build_system_prompt("ctx", true);
        assert!(prompt.contains("Cite source files and page numbers"));
    }
}
