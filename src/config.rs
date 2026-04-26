use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    #[allow(dead_code)]
    pub log_level: String,
    /// Bearer token for the OpenAI-compatible API (required for /query).
    pub openai_api_key: Option<String>,
    /// Base URL for the OpenAI-compatible API.
    pub openai_base_url: Option<String>,
    /// Embedding model name (must match what was used when indexing).
    pub embedding_model: String,
    /// Embedding vector dimensions (must match the indexed collection).
    pub embedding_ndims: usize,
    /// Completion model name used for RAG responses.
    pub completion_model: String,
    /// Qdrant server URL (gRPC).
    pub qdrant_url: String,
    /// Optional Qdrant API key for cloud deployments.
    pub qdrant_api_key: Option<String>,
    /// Name of the Qdrant collection that stores document embeddings.
    pub qdrant_collection: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into());
        let openai_api_key = std::env::var("OPENAI_API_KEY").ok();
        let openai_base_url = std::env::var("OPENAI_BASE_URL").ok();
        let embedding_model =
            std::env::var("EMBEDDING_MODEL").unwrap_or_else(|_| "text-embedding-3-small".into());
        let embedding_ndims = std::env::var("EMBEDDING_NDIMS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1536);
        let completion_model =
            std::env::var("COMPLETION_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into());
        let qdrant_url =
            std::env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6334".into());
        let qdrant_api_key = std::env::var("QDRANT_API_KEY").ok();
        let qdrant_collection =
            std::env::var("QDRANT_COLLECTION").unwrap_or_else(|_| "eis_documents".into());

        Self {
            host,
            port,
            log_level,
            openai_api_key,
            openai_base_url,
            embedding_model,
            embedding_ndims,
            completion_model,
            qdrant_url,
            qdrant_api_key,
            qdrant_collection,
        }
    }

    pub fn socket_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("invalid socket address")
    }
}
