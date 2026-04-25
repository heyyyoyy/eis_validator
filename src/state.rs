use std::sync::Arc;

use rig::{
    client::{CompletionClient, EmbeddingsClient},
    providers::openai,
};
use rig_sqlite::SqliteVectorStore;
use rusqlite::ffi::sqlite3_auto_extension;
use sqlite_vec::sqlite3_vec_init;
use tokio_rusqlite::Connection;

use crate::config::AppConfig;
use crate::repository::eis_documents::EisDocuments;
use crate::repository::EisRepository;

// ── Concrete type aliases ─────────────────────────────────────────────────────

pub type CompletModel = openai::responses_api::ResponsesCompletionModel;

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    pub repository: EisRepository,
    pub completion_model: CompletModel,
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
    let vector_store: SqliteVectorStore<_, EisDocuments> =
        match SqliteVectorStore::new(conn, &embed_model).await {
            Ok(store) => store,
            Err(e) => {
                tracing::error!("Failed to initialize SQLite vector store: {e}");
                return None;
            }
        };
    let vector_index = vector_store.index(embed_model);

    Some(Arc::new(AppState {
        repository: EisRepository { vector_index },
        completion_model,
    }))
}
