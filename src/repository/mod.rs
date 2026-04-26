pub mod eis_documents;

use std::collections::HashMap;
use std::sync::Arc;

use bm25::{Embedder, EmbedderBuilder, Language};
use qdrant_client::qdrant::{QueryPointsBuilder, ScoredPoint, VectorInput, Value};
use qdrant_client::Qdrant;
use rig::embeddings::EmbeddingModel;
use rig::providers::openai;

use crate::repository::eis_documents::EisDocuments;

pub type EmbedModel = openai::EmbeddingModel;

/// RRF constant — higher k de-emphasises rank differences between the two lists.
const RRF_K: f64 = 60.0;

pub struct EisRepository {
    pub qdrant: Arc<Qdrant>,
    pub collection: String,
    pub embed_model: EmbedModel,
    /// BM25 embedder fitted on the indexed corpus (or a sensible default avgdl).
    pub bm25: Arc<Embedder>,
}

impl EisRepository {
    /// Hybrid (dense + sparse BM25) search with Reciprocal Rank Fusion.
    ///
    /// Returns up to `top_k` chunks ordered by descending RRF score.
    pub async fn search(
        &self,
        query: &str,
        top_k: u64,
    ) -> anyhow::Result<Vec<(f64, EisDocuments)>> {
        let fetch_limit = top_k * 2; // retrieve more candidates before RRF merge

        // ── Dense embedding ───────────────────────────────────────────────────
        let dense_embedding = self
            .embed_model
            .embed_text(query)
            .await
            .map_err(|e| anyhow::anyhow!("Dense embedding failed: {e}"))?;
        let dense_vec: Vec<f32> = dense_embedding.vec.into_iter().map(|x| x as f32).collect();

        // ── Sparse BM25 embedding (deduplicated) ──────────────────────────────
        let bm25_embedding = self.bm25.embed(query);
        let (sparse_indices, sparse_values) = dedup_sparse(
            bm25_embedding.indices().copied(),
            bm25_embedding.values().copied(),
        );

        // ── Parallel Qdrant queries ───────────────────────────────────────────
        let dense_req = QueryPointsBuilder::new(&self.collection)
            .query(dense_vec)
            .using("dense")
            .limit(fetch_limit)
            .with_payload(true)
            .build();

        let sparse_req = QueryPointsBuilder::new(&self.collection)
            .query(VectorInput::new_sparse(sparse_indices, sparse_values))
            .using("sparse")
            .limit(fetch_limit)
            .with_payload(true)
            .build();

        let (dense_res, sparse_res) = tokio::try_join!(
            self.qdrant.query(dense_req),
            self.qdrant.query(sparse_req),
        )
        .map_err(|e| anyhow::anyhow!("Qdrant query failed: {e}"))?;

        // ── Reciprocal Rank Fusion ─────────────────────────────────────────────
        let mut rrf_scores: HashMap<u64, f64> = HashMap::new();

        for (rank, point) in dense_res.result.iter().enumerate() {
            if let Some(id) = point_numeric_id(point) {
                *rrf_scores.entry(id).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
            }
        }
        for (rank, point) in sparse_res.result.iter().enumerate() {
            if let Some(id) = point_numeric_id(point) {
                *rrf_scores.entry(id).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
            }
        }

        // Build a lookup map: numeric id → first seen ScoredPoint
        let mut point_map: HashMap<u64, &ScoredPoint> = HashMap::new();
        for pt in dense_res.result.iter().chain(sparse_res.result.iter()) {
            if let Some(id) = point_numeric_id(pt) {
                point_map.entry(id).or_insert(pt);
            }
        }

        // Sort by descending RRF score, take top_k
        let mut ranked: Vec<(u64, f64)> = rrf_scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked.truncate(top_k as usize);

        let mut results = Vec::with_capacity(ranked.len());
        for (id, score) in ranked {
            if let Some(pt) = point_map.get(&id) {
                if let Some(doc) = payload_to_doc(&pt.payload) {
                    results.push((score, doc));
                }
            }
        }

        Ok(results)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn point_numeric_id(pt: &ScoredPoint) -> Option<u64> {
    pt.id.as_ref().and_then(|pid| {
        pid.point_id_options.as_ref().and_then(|opt| {
            if let qdrant_client::qdrant::point_id::PointIdOptions::Num(n) = opt {
                Some(*n)
            } else {
                None
            }
        })
    })
}

fn payload_to_doc(payload: &HashMap<String, Value>) -> Option<EisDocuments> {
    let id = str_field(payload, "id")?;
    let file_name = str_field(payload, "file_name")?;
    let page = str_field(payload, "page")?;
    let chunk_index = str_field(payload, "chunk_index")?;
    let content = str_field(payload, "content")?;
    Some(EisDocuments { id, file_name, page, chunk_index, content })
}

fn str_field(payload: &HashMap<String, Value>, key: &str) -> Option<String> {
    payload.get(key).and_then(|v| {
        v.kind.as_ref().and_then(|k| {
            if let qdrant_client::qdrant::value::Kind::StringValue(s) = k {
                Some(s.clone())
            } else {
                None
            }
        })
    })
}

/// Aggregate duplicate sparse indices by summing their values.
///
/// The `bm25` crate emits one `TokenEmbedding` per token *occurrence*, so a
/// token that appears N times produces N entries with the same index.
/// Qdrant requires indices to be unique within a sparse vector.
fn dedup_sparse(
    indices: impl Iterator<Item = u32>,
    values: impl Iterator<Item = f32>,
) -> (Vec<u32>, Vec<f32>) {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<u32, f32> = BTreeMap::new();
    for (idx, val) in indices.zip(values) {
        *map.entry(idx).or_insert(0.0) += val;
    }
    map.into_iter().unzip()
}

/// Build a BM25 embedder with a fixed average document length.
///
/// Used at query time when the full corpus is unavailable. The `avgdl` should
/// be set to approximately the mean meaningful token count per chunk — the
/// configured `CHUNK_SIZE` (in characters) is a reasonable proxy.
pub fn build_bm25_embedder(avgdl: f32) -> Embedder {
    EmbedderBuilder::<u32>::with_avgdl(avgdl)
        .language_mode(Language::Russian)
        .build()
}
