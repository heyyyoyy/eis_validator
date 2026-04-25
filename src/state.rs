use std::sync::Arc;

use rig::{
    client::{CompletionClient, EmbeddingsClient},
    embeddings::EmbeddingModel,
    providers::openai,
};
use rusqlite::ffi::sqlite3_auto_extension;
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;
use tokio_rusqlite::Connection;

use crate::config::AppConfig;

// ── Document type ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfChunk {
    pub id: String,
    pub file_name: String,
    pub page: i64,
    pub chunk_index: i64,
    pub content: String,
}

// ── Concrete type aliases ─────────────────────────────────────────────────────

pub type EmbedModel = openai::EmbeddingModel;
pub type CompletModel = openai::responses_api::ResponsesCompletionModel;

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    pub conn: Connection,
    pub embed_model: EmbedModel,
    pub completion_model: CompletModel,
}

impl AppState {
    /// Run a vector similarity search directly against SQLite.
    ///
    /// Returns up to `top_k` chunks ordered by descending cosine similarity.
    pub async fn search(&self, query: &str, top_k: u64) -> anyhow::Result<Vec<(f64, PdfChunk)>> {
        let embedding = self.embed_model.embed_text(query).await?;

        // Serialise the embedding to little-endian f32 bytes (sqlite-vec format).
        let vec_bytes: Vec<u8> = embedding
            .vec
            .iter()
            .flat_map(|&v| (v as f32).to_le_bytes())
            .collect();

        let results = self
            .conn
            .call(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT \
                       d.id, \
                       d.file_name, \
                       d.page, \
                       d.chunk_index, \
                       d.content, \
                       (1.0 - vec_distance_cosine(?, e.embedding)) AS score \
                     FROM pdf_chunks_embeddings e \
                     JOIN pdf_chunks d ON e.rowid = d.rowid \
                     WHERE e.embedding MATCH ? AND k = ? \
                     ORDER BY score DESC",
                )?;

                let blob = rusqlite::types::Value::Blob(vec_bytes.clone());
                let rows = stmt
                    .query_map(rusqlite::params![blob.clone(), blob, top_k], |row| {
                        Ok((
                            row.get::<_, f64>(5)?,
                            PdfChunk {
                                id: row.get(0)?,
                                file_name: row.get(1)?,
                                page: row.get(2)?,
                                chunk_index: row.get(3)?,
                                content: row.get(4)?,
                            },
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;

                Ok(rows)
            })
            .await?;

        Ok(results)
    }
}

// ── Initialisation ────────────────────────────────────────────────────────────

/// Initialise the shared state.
///
/// Returns `None` when `OPENAI_API_KEY` is not set or the DB cannot be opened;
/// the server still starts but `/query` returns 503.
pub async fn build_state(config: &AppConfig) -> Option<Arc<AppState>> {
    let api_key = match &config.openai_api_key {
        Some(k) => k.clone(),
        None => {
            tracing::warn!("OPENAI_API_KEY is not set — /query endpoint will be unavailable");
            return None;
        }
    };

    // Register sqlite-vec before any connection is opened.
    // SAFETY: called once at startup, no connections exist yet.
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

    let conn = match Connection::open(&config.db_path).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to open vector DB '{}': {e}", config.db_path);
            return None;
        }
    };

    let mut builder = openai::Client::builder().api_key(&api_key);
    if let Some(base_url) = &config.openai_base_url {
        builder = builder.base_url(base_url);
    }
    let client = match builder.build() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to build OpenAI client: {e}");
            return None;
        }
    };

    let embed_model =
        client.embedding_model_with_ndims(&config.embedding_model, config.embedding_ndims);
    let completion_model = client.completion_model(&config.completion_model);

    Some(Arc::new(AppState {
        conn,
        embed_model,
        completion_model,
    }))
}
