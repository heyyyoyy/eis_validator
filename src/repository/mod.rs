pub mod eis_documents;

use rig::providers::openai;
use rig::vector_store::{VectorSearchRequest, VectorStoreIndex};
use rig_sqlite::SqliteVectorIndex;

use crate::repository::eis_documents::EisDocuments;

pub type EmbedModel = openai::EmbeddingModel;
pub type VectorIndex = SqliteVectorIndex<EmbedModel, EisDocuments>;

pub struct EisRepository {
    pub vector_index: VectorIndex,
}

impl EisRepository {
    /// Returns up to `top_k` chunks ordered by descending cosine similarity.
    pub async fn search(
        &self,
        query: &str,
        top_k: u64,
    ) -> anyhow::Result<Vec<(f64, EisDocuments)>> {
        let req = VectorSearchRequest::builder()
            .query(query)
            .samples(top_k)
            .build()?;

        let results = self.vector_index.top_n::<EisDocuments>(req).await?;
        Ok(results
            .into_iter()
            .map(|(score, _, chunk)| (score, chunk))
            .collect())
    }
}
