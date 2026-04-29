//! Markdown embedding indexer — Qdrant backend.
//!
//! Walks a directory of Markdown (`.md`) files, splits content into logical
//! chunks (heading-aware, then size-capped with overlap), generates:
//!
//! - **Dense embeddings** via an OpenAI-compatible API.
//! - **Sparse BM25 vectors** computed locally over the full corpus.
//!
//! Both vector types are upserted into a Qdrant collection under the named
//! vectors `"dense"` and `"sparse"`.
//!
//! # Environment variables
//!
//! | Variable            | Default                        | Purpose                                   |
//! |---------------------|-------------------------------|-------------------------------------------|
//! | `OPENAI_API_KEY`    | *(required)*                  | Bearer token for the embedding endpoint   |
//! | `OPENAI_BASE_URL`   | `https://api.openai.com/v1`   | Base URL (supports any compatible proxy)  |
//! | `EMBEDDING_MODEL`   | `text-embedding-3-small`       | Model name                                |
//! | `EMBEDDING_NDIMS`   | `1536`                        | Embedding dimensions (match your model)   |
//! | `CHUNK_SIZE`        | `512`                         | Max characters per chunk                  |
//! | `CHUNK_OVERLAP`     | `64`                          | Overlap characters between chunks         |
//! | `BATCH_SIZE`        | `50`                          | Chunks per embedding API call             |
//! | `QDRANT_URL`        | `http://localhost:6334`        | Qdrant server URL (gRPC)                  |
//! | `QDRANT_API_KEY`    | *(optional)*                  | Qdrant API key for cloud deployments      |
//! | `QDRANT_COLLECTION` | `eis_documents`               | Target collection name                    |

use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use bm25::{Embedder, EmbedderBuilder, Language};
use clap::Parser;
use qdrant_client::{
    qdrant::{
        CreateCollectionBuilder, Distance, Modifier, NamedVectors, PointStruct,
        SparseIndexConfigBuilder, SparseVectorParamsBuilder, SparseVectorsConfigBuilder,
        UpsertPointsBuilder, VectorParamsBuilder, VectorsConfigBuilder,
    },
    Payload, Qdrant,
};

#[path = "../repository/eis_documents.rs"]
mod eis_documents;
use eis_documents::EisDocuments;

use pulldown_cmark::{Event, Options, Parser as MdParser, Tag, TagEnd};
use rig::{
    client::{EmbeddingsClient, ProviderClient},
    embeddings::EmbeddingModel,
    providers::openai,
};
use tracing::{error, info, warn};
use walkdir::WalkDir;

// ── CLI ──────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "index_mds",
    about = "Extract text from Markdown files, embed them, and store in Qdrant"
)]
struct Cli {
    /// Directory containing Markdown files to index (searched recursively)
    #[arg(short, long, value_name = "DIR")]
    dir: PathBuf,

    /// Append to an existing collection instead of recreating it.
    /// Without this flag the collection is deleted and recreated.
    #[arg(long, default_value_t = false)]
    append: bool,
}

// ── Markdown parsing ──────────────────────────────────────────────────────────

#[derive(Debug)]
struct Section {
    heading: String,
    body: String,
}

fn parse_sections(source: &str) -> Vec<Section> {
    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_SMART_PUNCTUATION;

    let parser = MdParser::new_ext(source, opts);

    let mut sections: Vec<Section> = Vec::new();
    let mut current_heading = "(root)".to_string();
    let mut current_body = String::new();
    let mut in_heading = false;
    let mut heading_text = String::new();

    let push_section = |sections: &mut Vec<Section>, heading: &str, body: &str| {
        let trimmed = body.trim().to_string();
        if !trimmed.is_empty() {
            let body_with_heading = if heading != "(root)" {
                format!("{heading}\n\n{trimmed}")
            } else {
                trimmed
            };
            sections.push(Section {
                heading: heading.to_string(),
                body: body_with_heading,
            });
        }
    };

    for event in parser {
        match event {
            Event::Start(Tag::Heading { .. }) => {
                push_section(&mut sections, &current_heading, &current_body);
                current_body.clear();
                heading_text.clear();
                in_heading = true;
            }
            Event::End(TagEnd::Heading(_)) => {
                current_heading = heading_text.trim().to_string();
                if current_heading.is_empty() {
                    current_heading = "(untitled)".to_string();
                }
                in_heading = false;
            }
            Event::Text(t) | Event::Code(t) => {
                if in_heading {
                    heading_text.push_str(&t);
                } else {
                    current_body.push_str(&t);
                    current_body.push(' ');
                }
            }
            Event::SoftBreak | Event::HardBreak if !in_heading => {
                current_body.push('\n');
            }
            Event::End(TagEnd::Paragraph)
            | Event::End(TagEnd::Item)
            | Event::End(TagEnd::BlockQuote(_))
            | Event::End(TagEnd::CodeBlock)
                if !in_heading =>
            {
                current_body.push('\n');
            }
            _ => {}
        }
    }

    push_section(&mut sections, &current_heading, &current_body);
    sections
}

// ── Text chunking ─────────────────────────────────────────────────────────────

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

// ── Slug helper ───────────────────────────────────────────────────────────────

fn slugify(heading: &str) -> String {
    heading
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

/// Aggregate duplicate sparse indices by summing their values.
///
/// The `bm25` crate emits one `TokenEmbedding` per token *occurrence*, so a
/// token that appears N times in a document produces N entries with the same
/// index. Qdrant requires indices to be unique within a sparse vector.
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

/// Derive a stable numeric ID from a string so that re-indexing the same chunk
/// always produces the same Qdrant point ID (upsert semantics).
fn point_id_from_str(id: &str) -> u64 {
    use std::hash::{Hash, Hasher as _};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut h);
    h.finish()
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "index_mds=info".into()),
        )
        .init();

    let cli = Cli::parse();

    // ── Config from environment ───────────────────────────────────────────────

    let model_name = std::env::var("EMBEDDING_MODEL")
        .unwrap_or_else(|_| openai::TEXT_EMBEDDING_3_SMALL.to_string());

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
                "EMBEDDING_NDIMS must be set for model '{model_name}' (e.g. EMBEDDING_NDIMS=768)"
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
    let batch_size: usize = std::env::var("BATCH_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);
    let qdrant_url = std::env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6334".into());
    let qdrant_api_key = std::env::var("QDRANT_API_KEY").ok();
    let collection = std::env::var("QDRANT_COLLECTION").unwrap_or_else(|_| "eis_documents".into());

    info!(
        model = %model_name,
        ndims,
        chunk_size,
        chunk_overlap,
        batch_size,
        qdrant = %qdrant_url,
        collection = %collection,
        append = cli.append,
        "Starting Markdown indexer"
    );

    // ── OpenAI / embedding client ─────────────────────────────────────────────

    let oai_client =
        openai::Client::from_env().context("creating OpenAI client from environment")?;
    let embed_model = oai_client.embedding_model_with_ndims(&model_name, ndims);

    // ── Qdrant client ─────────────────────────────────────────────────────────

    let mut qdrant_builder = Qdrant::from_url(&qdrant_url);
    if let Some(key) = qdrant_api_key {
        qdrant_builder = qdrant_builder.api_key(key);
    }
    let qdrant = qdrant_builder.build().context("building Qdrant client")?;

    // ── Collect Markdown paths ────────────────────────────────────────────────

    let md_paths: Vec<PathBuf> = WalkDir::new(&cli.dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|x| x.eq_ignore_ascii_case("md"))
                    .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect();

    if md_paths.is_empty() {
        warn!("No Markdown files found in {}", cli.dir.display());
        return Ok(());
    }

    info!("Found {} Markdown file(s) to process", md_paths.len());

    // ── Pass 1: parse every file and collect all chunks ───────────────────────

    let mut all_docs: Vec<EisDocuments> = Vec::new();

    for md_path in &md_paths {
        let file_name = md_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| md_path.display().to_string());

        let source = match fs::read_to_string(md_path) {
            Ok(s) => s,
            Err(err) => {
                error!("Skipping {file_name}: {err:#}");
                continue;
            }
        };

        if source.trim().is_empty() {
            warn!("Skipping {file_name}: file is empty");
            continue;
        }

        let sections = parse_sections(&source);
        if sections.is_empty() {
            warn!("Skipping {file_name}: no text content after parsing");
            continue;
        }

        for section in &sections {
            for (chunk_idx, content) in chunk_text(&section.body, chunk_size, chunk_overlap)
                .into_iter()
                .enumerate()
            {
                all_docs.push(EisDocuments {
                    id: format!(
                        "{file_name}::{section_slug}::c{chunk_idx}",
                        section_slug = slugify(&section.heading)
                    ),
                    file_name: file_name.clone(),
                    page: section.heading.clone(),
                    chunk_index: chunk_idx.to_string(),
                    content,
                });
            }
        }
    }

    info!("Collected {} chunks across all files", all_docs.len());

    if all_docs.is_empty() {
        warn!("No chunks produced — aborting");
        return Ok(());
    }

    // ── Pass 2: fit BM25 on the full corpus ───────────────────────────────────

    let corpus_texts: Vec<&str> = all_docs.iter().map(|d| d.content.as_str()).collect();
    let bm25: Embedder<u32> =
        EmbedderBuilder::with_fit_to_corpus(Language::Russian, corpus_texts.as_slice()).build();

    info!(avgdl = bm25.avgdl(), "BM25 corpus fitted");

    // ── Recreate or reuse the Qdrant collection ───────────────────────────────

    if !cli.append {
        if qdrant.collection_exists(&collection).await? {
            qdrant
                .delete_collection(&collection)
                .await
                .with_context(|| format!("deleting collection '{collection}'"))?;
            info!("Deleted existing collection '{collection}'");
        }

        let mut dense_config = VectorsConfigBuilder::default();
        dense_config.add_named_vector_params(
            "dense",
            VectorParamsBuilder::new(ndims as u64, Distance::Cosine),
        );

        let mut sparse_config = SparseVectorsConfigBuilder::default();
        sparse_config.add_named_vector_params(
            "sparse",
            SparseVectorParamsBuilder::default()
                .modifier(Modifier::Idf)
                .index(SparseIndexConfigBuilder::default()),
        );

        qdrant
            .create_collection(
                CreateCollectionBuilder::new(&collection)
                    .vectors_config(dense_config)
                    .sparse_vectors_config(sparse_config),
            )
            .await
            .with_context(|| format!("creating collection '{collection}'"))?;

        info!("Created collection '{collection}' with dense ({ndims}D) + sparse vectors");
    } else {
        info!("Appending to existing collection '{collection}'");
    }

    // ── Pass 3: embed in batches and upsert ──────────────────────────────────

    let total = all_docs.len();
    let mut upserted = 0usize;

    for (batch_idx, chunk) in all_docs.chunks(batch_size).enumerate() {
        let texts: Vec<String> = chunk.iter().map(|d| d.content.clone()).collect();

        let embeddings: Vec<Vec<f32>> = embed_model
            .embed_texts(texts)
            .await
            .with_context(|| format!("embedding batch {batch_idx}"))?
            .into_iter()
            .map(|e| e.vec.into_iter().map(|v| v as f32).collect())
            .collect();

        let points: Vec<PointStruct> = chunk
            .iter()
            .zip(embeddings.into_iter())
            .map(|(doc, dense_vec)| {
                let sparse_emb = bm25.embed(&doc.content);
                let (sparse_indices, sparse_values) =
                    dedup_sparse(sparse_emb.indices().copied(), sparse_emb.values().copied());

                let named_vectors = NamedVectors::default()
                    .add_vector("dense", dense_vec)
                    .add_vector(
                        "sparse",
                        qdrant_client::qdrant::Vector::new_sparse(sparse_indices, sparse_values),
                    );

                let payload = Payload::try_from(serde_json::json!({
                    "id": doc.id,
                    "file_name": doc.file_name,
                    "page": doc.page,
                    "chunk_index": doc.chunk_index,
                    "content": doc.content,
                }))
                .expect("payload serialization is infallible");

                PointStruct::new(point_id_from_str(&doc.id), named_vectors, payload)
            })
            .collect();

        let n = points.len();
        qdrant
            .upsert_points(UpsertPointsBuilder::new(&collection, points))
            .await
            .with_context(|| format!("upserting batch {batch_idx}"))?;

        upserted += n;
        info!("Upserted batch {batch_idx}: {n} points (total so far: {upserted}/{total})");
    }

    info!("Done. Upserted {upserted} chunk(s) into Qdrant collection '{collection}'");

    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{chunk_text, parse_sections, point_id_from_str, slugify};

    #[test]
    fn chunk_empty_string() {
        assert!(chunk_text("", 512, 64).is_empty());
    }

    #[test]
    fn chunk_shorter_than_size() {
        let chunks = chunk_text("hello world", 512, 64);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "hello world");
    }

    #[test]
    fn chunk_produces_overlap() {
        let chunks = chunk_text("abcdefghij", 6, 2);
        assert_eq!(chunks.len(), 2);
        assert_eq!(&chunks[0], "abcdef");
        assert_eq!(&chunks[1], "efghij");
    }

    #[test]
    fn chunk_skips_whitespace_only() {
        assert!(chunk_text("   \n\t  ", 512, 64).is_empty());
    }

    #[test]
    fn parse_sections_no_headings() {
        let md = "Just some plain text.\nAnd another line.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].heading, "(root)");
        assert!(sections[0].body.contains("Just some plain text."));
    }

    #[test]
    fn parse_sections_with_headings() {
        let md = "# Title\n\nIntro text.\n\n## Section A\n\nBody A.\n\n## Section B\n\nBody B.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].heading, "Title");
        assert_eq!(sections[1].heading, "Section A");
        assert_eq!(sections[2].heading, "Section B");
    }

    #[test]
    fn parse_sections_strips_inline_markup() {
        let md = "## Header\n\n**bold** and *italic* and `code` text.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        let body = &sections[0].body;
        assert!(body.starts_with("Header"));
        assert!(body.contains("bold"));
        assert!(body.contains("italic"));
        assert!(body.contains("code"));
        assert!(!body.contains("**"));
        assert!(!body.contains("*"));
        assert!(!body.contains("`"));
    }

    #[test]
    fn parse_sections_skips_empty_sections() {
        let md = "# Empty\n\n# Has content\n\nSome text here.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].heading, "Has content");
    }

    #[test]
    fn parse_sections_heading_prepended_in_body() {
        let md = "### РДИК_0003 — Дубль документа\n\nОписание: уже существует документ.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].heading, "РДИК_0003 — Дубль документа");
        assert!(sections[0].body.starts_with("РДИК_0003 — Дубль документа"));
        assert!(sections[0].body.contains("Описание"));
    }

    #[test]
    fn parse_sections_root_body_not_prefixed() {
        let md = "Just plain intro text.";
        let sections = parse_sections(md);
        assert_eq!(sections[0].heading, "(root)");
        assert!(!sections[0].body.starts_with("(root)"));
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello_world");
        assert_eq!(slugify("  foo  bar  "), "foo_bar");
        assert_eq!(slugify("(root)"), "root");
    }

    #[test]
    fn point_id_is_deterministic() {
        let a = point_id_from_str("test::root::c0");
        let b = point_id_from_str("test::root::c0");
        assert_eq!(a, b);
    }

    #[test]
    fn point_id_different_ids_differ() {
        let a = point_id_from_str("file_a::root::c0");
        let b = point_id_from_str("file_b::root::c0");
        assert_ne!(a, b);
    }
}
