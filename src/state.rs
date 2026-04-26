use std::sync::Arc;

use qdrant_client::Qdrant;
use rig::{
    client::{CompletionClient, EmbeddingsClient},
    providers::openai,
};

use crate::config::AppConfig;
use crate::repository::{build_bm25_embedder, EisRepository};

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
/// Returns `None` when `OPENAI_API_KEY` is not set or Qdrant is unreachable;
/// the server still starts but `/query` returns 503.
pub async fn build_state(config: &AppConfig) -> Option<Arc<AppState>> {
    let api_key = match &config.openai_api_key {
        Some(k) => k.clone(),
        None => {
            tracing::warn!("OPENAI_API_KEY is not set — /query endpoint will be unavailable");
            return None;
        }
    };

    // ── OpenAI client ─────────────────────────────────────────────────────────
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

    // ── Qdrant client ─────────────────────────────────────────────────────────
    let mut qdrant_builder = Qdrant::from_url(&config.qdrant_url);
    if let Some(key) = config.qdrant_api_key.clone() {
        qdrant_builder = qdrant_builder.api_key(key);
    }
    let qdrant = match qdrant_builder.build() {
        Ok(q) => Arc::new(q),
        Err(e) => {
            tracing::error!("Failed to build Qdrant client: {e}");
            return None;
        }
    };

    // avgdl at query time: the indexer fits the real value, but the server only
    // needs a plausible approximation since BM25 here drives candidate retrieval,
    // not final ranking. CHUNK_SIZE characters ÷ ~5 chars/word ≈ word count.
    let avgdl: f32 = 512.0 / 5.0; // ≈ 100 tokens for default 512-char chunks
    let bm25 = Arc::new(build_bm25_embedder(avgdl));

    Some(Arc::new(AppState {
        repository: EisRepository {
            qdrant,
            collection: config.qdrant_collection.clone(),
            embed_model,
            bm25,
        },
        completion_model,
    }))
}
