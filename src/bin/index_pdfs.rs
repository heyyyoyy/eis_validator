//! PDF embedding indexer.
//!
//! Walks a directory of PDF files, extracts text page-by-page, splits it into
//! overlapping chunks, generates embeddings via an OpenAI-compatible API, and
//! persists both the text chunks and their vector embeddings to a SQLite
//! database using `rig-sqlite` (backed by the `sqlite-vec` extension).
//!
//! # Environment variables
//!
//! | Variable          | Default                        | Purpose                                  |
//! |-------------------|-------------------------------|------------------------------------------|
//! | `OPENAI_API_KEY`  | *(required)*                  | Bearer token for the embedding endpoint  |
//! | `OPENAI_BASE_URL` | `https://api.openai.com/v1`   | Base URL (supports any compatible proxy) |
//! | `EMBEDDING_MODEL` | `text-embedding-3-small`       | Model name                               |
//! | `EMBEDDING_NDIMS` | `1536`                        | Embedding dimensions (match your model)  |
//! | `CHUNK_SIZE`      | `512`                         | Max characters per chunk                 |
//! | `CHUNK_OVERLAP`   | `64`                          | Overlap characters between chunks        |
//! | `DB_PATH`         | `chunks.db`                   | Output SQLite file path                  |
//! | `BATCH_SIZE`      | `50`                          | Chunks per embedding API call            |

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use clap::Parser;
use rig::{
    client::ProviderClient,
    embeddings::{EmbeddingModel, EmbeddingsBuilder},
    prelude::EmbeddingsClient,
    providers::openai,
    vector_store::InsertDocuments,
    Embed,
};
use rig_sqlite::{Column, ColumnValue, SqliteVectorStore, SqliteVectorStoreTable};
use rusqlite::ffi::sqlite3_auto_extension;
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;
use tokio_rusqlite::Connection;
use tracing::{error, info, warn};
use walkdir::WalkDir;

// ── CLI ──────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "index_pdfs",
    about = "Extract text from PDFs, embed them, and store in SQLite"
)]
struct Cli {
    /// Directory containing PDF files to index (searched recursively)
    #[arg(short, long, value_name = "DIR")]
    dir: PathBuf,
}

// ── Document type ─────────────────────────────────────────────────────────────

/// One text chunk extracted from a PDF, ready to be embedded.
#[derive(Embed, Clone, Debug, Serialize, Deserialize)]
struct PdfChunk {
    /// Unique identifier: `"{filename}::p{page}::c{chunk_idx}"`
    id: String,
    file_name: String,
    page: usize,
    chunk_index: usize,
    #[embed]
    content: String,
}

impl SqliteVectorStoreTable for PdfChunk {
    fn name() -> &'static str {
        "pdf_chunks"
    }

    fn schema() -> Vec<Column> {
        vec![
            Column::new("id", "TEXT PRIMARY KEY"),
            Column::new("file_name", "TEXT").indexed(),
            Column::new("page", "INTEGER"),
            Column::new("chunk_index", "INTEGER"),
            Column::new("content", "TEXT"),
        ]
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    fn column_values(&self) -> Vec<(&'static str, Box<dyn ColumnValue>)> {
        vec![
            ("id", Box::new(self.id.clone())),
            ("file_name", Box::new(self.file_name.clone())),
            ("page", Box::new(self.page.to_string())),
            ("chunk_index", Box::new(self.chunk_index.to_string())),
            ("content", Box::new(self.content.clone())),
        ]
    }
}

// ── Text chunking ─────────────────────────────────────────────────────────────

/// Split `text` into overlapping windows of at most `size` characters.
///
/// Each step advances by `(size - overlap)` characters so that consecutive
/// chunks share `overlap` characters of context. Empty chunks are skipped.
fn chunk_text(text: &str, size: usize, overlap: usize) -> Vec<String> {
    if text.is_empty() || size == 0 {
        return vec![];
    }

    let step = size.saturating_sub(overlap).max(1);
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < total {
        let end = (start + size).min(total);
        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim().to_string();
        if !trimmed.is_empty() {
            chunks.push(trimmed);
        }
        if end == total {
            break;
        }
        start += step;
    }

    chunks
}

// ── PDF extraction ────────────────────────────────────────────────────────────

/// Returns a list of `(page_number, text)` pairs (1-indexed).
///
/// On error the file is skipped with a warning instead of aborting the run.
fn extract_pages(path: &Path) -> Result<Vec<(usize, String)>> {
    let bytes = fs::read(path).with_context(|| format!("reading {}", path.display()))?;

    let doc = lopdf::Document::load_mem(&bytes)
        .with_context(|| format!("parsing PDF {}", path.display()))?;

    let page_count = doc.get_pages().len();
    let mut pages = Vec::with_capacity(page_count);

    for page_num in 1..=page_count {
        // extract_text takes 1-based page numbers, not object IDs
        match doc.extract_text(&[page_num as u32]) {
            Ok(text) => pages.push((page_num, text)),
            Err(err) => {
                warn!(
                    "Could not extract text from page {page_num} of {}: {err}",
                    path.display()
                );
            }
        }
    }

    Ok(pages)
}

// ── Embedding helper ──────────────────────────────────────────────────────────

/// Embed a batch of `PdfChunk`s using `model` and return the result pairs.
async fn embed_batch<M>(
    model: M,
    batch: Vec<PdfChunk>,
) -> Result<Vec<(PdfChunk, rig::OneOrMany<rig::embeddings::Embedding>)>>
where
    M: EmbeddingModel + Clone,
{
    let result = EmbeddingsBuilder::new(model)
        .documents(batch)
        .context("building embeddings batch")?
        .build()
        .await
        .context("calling embedding API")?;
    Ok(result)
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env from the current directory if present; silently ignored when absent.
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "index_pdfs=info".into()),
        )
        .init();

    let cli = Cli::parse();

    // Configuration from environment
    let model_name = std::env::var("EMBEDDING_MODEL")
        .unwrap_or_else(|_| openai::TEXT_EMBEDDING_3_SMALL.to_string());

    // Derive a sensible default only for well-known OpenAI models.
    // For any other model EMBEDDING_NDIMS must be set explicitly.
    let default_ndims: Option<usize> = match model_name.as_str() {
        openai::TEXT_EMBEDDING_3_LARGE => Some(3072),
        openai::TEXT_EMBEDDING_3_SMALL | openai::TEXT_EMBEDDING_ADA_002 => Some(1536),
        _ => None,
    };
    let ndims: usize = std::env::var("EMBEDDING_NDIMS")
        .ok()
        .and_then(|v| v.parse().ok())
        .or(default_ndims)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "EMBEDDING_NDIMS must be set for model '{model_name}' \
                 (e.g. EMBEDDING_NDIMS=768)"
            )
        })?;
    let chunk_size: usize = std::env::var("CHUNK_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(512);
    let chunk_overlap: usize = std::env::var("CHUNK_OVERLAP")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(64);
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| "chunks.db".into());
    let batch_size: usize = std::env::var("BATCH_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    info!(
        model = %model_name,
        ndims,
        chunk_size,
        chunk_overlap,
        batch_size,
        db = %db_path,
        "Starting PDF indexer"
    );

    // Initialise SQLite vector extension — must happen before any connection is opened.
    // SAFETY: called once at startup before any connections exist.
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut i8,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> i32,
        >(sqlite3_vec_init as *const ())));
    }

    // Build OpenAI-compatible client.
    // Reads OPENAI_API_KEY (required) and OPENAI_BASE_URL (optional) from env.
    let client = openai::Client::from_env();
    let model = client.embedding_model_with_ndims(&model_name, ndims);

    // Open SQLite connection and initialise the vector store schema.
    let conn = Connection::open(&db_path)
        .await
        .with_context(|| format!("opening SQLite at {db_path}"))?;

    let store: SqliteVectorStore<_, PdfChunk> = SqliteVectorStore::new(conn, &model)
        .await
        .context("initialising SqliteVectorStore")?;

    // Collect PDF paths from the target directory.
    let pdf_paths: Vec<PathBuf> = WalkDir::new(&cli.dir)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|x| x.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect();

    if pdf_paths.is_empty() {
        warn!("No PDF files found in {}", cli.dir.display());
        return Ok(());
    }

    info!("Found {} PDF file(s) to process", pdf_paths.len());

    let mut total_chunks = 0usize;
    let mut total_files_ok = 0usize;
    let mut pending: Vec<PdfChunk> = Vec::new();

    for pdf_path in &pdf_paths {
        let file_name = pdf_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| pdf_path.display().to_string());

        info!("Processing {}", file_name);

        let pages = match extract_pages(pdf_path) {
            Ok(p) => p,
            Err(err) => {
                error!("Skipping {}: {err:#}", pdf_path.display());
                continue;
            }
        };

        for (page_num, page_text) in &pages {
            let raw_chunks = chunk_text(page_text, chunk_size, chunk_overlap);
            for (chunk_idx, content) in raw_chunks.into_iter().enumerate() {
                pending.push(PdfChunk {
                    id: format!("{file_name}::p{page_num}::c{chunk_idx}"),
                    file_name: file_name.clone(),
                    page: *page_num,
                    chunk_index: chunk_idx,
                    content,
                });

                // Flush when the pending buffer reaches the configured batch size.
                if pending.len() >= batch_size {
                    let batch = std::mem::take(&mut pending);
                    let n = batch.len();
                    let embeddings = embed_batch(model.clone(), batch)
                        .await
                        .with_context(|| format!("embedding batch for {file_name}"))?;
                    store
                        .insert_documents(embeddings)
                        .await
                        .context("inserting documents into SQLite")?;
                    total_chunks += n;
                    info!("Flushed batch of {n} chunks (total so far: {total_chunks})");
                }
            }
        }

        total_files_ok += 1;
    }

    // Flush any remaining chunks.
    if !pending.is_empty() {
        let n = pending.len();
        let embeddings = embed_batch(model.clone(), pending)
            .await
            .context("embedding final batch")?;
        store
            .insert_documents(embeddings)
            .await
            .context("inserting final batch into SQLite")?;
        total_chunks += n;
        info!("Flushed final batch of {n} chunks");
    }

    info!(
        "Done. Processed {total_files_ok}/{} file(s), stored {total_chunks} chunk(s) in {db_path}",
        pdf_paths.len()
    );

    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::chunk_text;

    #[test]
    fn chunk_empty_string() {
        assert!(chunk_text("", 512, 64).is_empty());
    }

    #[test]
    fn chunk_shorter_than_size() {
        let text = "hello world";
        let chunks = chunk_text(text, 512, 64);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "hello world");
    }

    #[test]
    fn chunk_exact_size() {
        let text = "a".repeat(512);
        let chunks = chunk_text(&text, 512, 0);
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn chunk_produces_overlap() {
        let text = "abcdefghij"; // 10 chars
                                 // size=6, overlap=2 → step=4
                                 // chunk 0: [0..6] = "abcdef"
                                 // chunk 1: [4..10] = "efghij"
        let chunks = chunk_text(text, 6, 2);
        assert_eq!(chunks.len(), 2);
        assert_eq!(&chunks[0], "abcdef");
        assert_eq!(&chunks[1], "efghij");
    }

    #[test]
    fn chunk_skips_whitespace_only() {
        let text = "   \n\t  ";
        assert!(chunk_text(text, 512, 64).is_empty());
    }
}
