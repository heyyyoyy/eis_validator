//! Markdown embedding indexer.
//!
//! Walks a directory of Markdown (`.md`) files, splits content into logical
//! chunks (heading-aware, then size-capped with overlap), generates embeddings
//! via an OpenAI-compatible API, and persists both the text chunks and their
//! vector embeddings to a SQLite database using `rig-sqlite` (backed by the
//! `sqlite-vec` extension).
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
#[path = "../repository/eis_documents.rs"]
mod eis_documents;
use eis_documents::EisDocuments;
use pulldown_cmark::{Event, Options, Parser as MdParser, Tag, TagEnd};
use rig::{
    client::ProviderClient,
    embeddings::{EmbeddingModel, EmbeddingsBuilder},
    prelude::EmbeddingsClient,
    providers::openai,
    vector_store::InsertDocuments,
};
use rig_sqlite::SqliteVectorStore;
use rusqlite::ffi::sqlite3_auto_extension;
use sqlite_vec::sqlite3_vec_init;
use tokio_rusqlite::Connection;
use tracing::{error, info, warn};
use walkdir::WalkDir;

// ── CLI ──────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "index_mds",
    about = "Extract text from Markdown files, embed them, and store in SQLite"
)]
struct Cli {
    /// Directory containing Markdown files to index (searched recursively)
    #[arg(short, long, value_name = "DIR")]
    dir: PathBuf,

    /// Append to an existing database instead of creating a new one.
    /// Without this flag the database file is removed before indexing.
    #[arg(long, default_value_t = false)]
    append: bool,
}

// ── Markdown parsing ──────────────────────────────────────────────────────────

/// A heading-delimited section extracted from a Markdown document.
#[derive(Debug)]
struct Section {
    /// The heading text that opened this section, or `"(root)"` for content
    /// before the first heading.
    heading: String,
    /// Plain-text body of the section (markup stripped).
    body: String,
}

/// Parse `source` into a list of [`Section`]s.
///
/// Each ATX/Setext heading (`#` … `######`) starts a new section. Content
/// before the first heading belongs to the synthetic `"(root)"` section.
/// Inline markup (bold, italic, code spans, links, images, etc.) is stripped
/// so only readable text remains. Block-level elements (lists, blockquotes,
/// code blocks) contribute their plain-text content.
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
            // Prepend the heading into the body so the embedding captures the
            // section title (e.g. "РДИК_0003") alongside its content.
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
                // Flush the current section before starting the new heading.
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
            Event::SoftBreak | Event::HardBreak => {
                if !in_heading {
                    current_body.push('\n');
                }
            }
            // Paragraph / list item / blockquote boundaries → newlines in body.
            Event::End(TagEnd::Paragraph)
            | Event::End(TagEnd::Item)
            | Event::End(TagEnd::BlockQuote(_))
            | Event::End(TagEnd::CodeBlock) => {
                if !in_heading {
                    current_body.push('\n');
                }
            }
            // Skip HTML, footnotes, and all other structural tags.
            _ => {}
        }
    }

    // Flush the last section.
    push_section(&mut sections, &current_heading, &current_body);

    sections
}

// ── Text chunking ─────────────────────────────────────────────────────────────

/// Split `text` into overlapping windows of at most `size` characters.
///
/// Each step advances by `(size - overlap)` characters so consecutive chunks
/// share `overlap` characters of context. Empty chunks are skipped.
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

// ── Embedding helper ──────────────────────────────────────────────────────────

async fn embed_batch<M>(
    model: M,
    batch: Vec<EisDocuments>,
) -> Result<Vec<(EisDocuments, rig::OneOrMany<rig::embeddings::Embedding>)>>
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
        append = cli.append,
        "Starting Markdown indexer"
    );

    // ── Database setup ────────────────────────────────────────────────────────

    if !cli.append {
        // Remove any existing database so the run starts clean.
        if Path::new(&db_path).exists() {
            fs::remove_file(&db_path)
                .with_context(|| format!("removing existing database at {db_path}"))?;
            info!("Removed existing database at {db_path}");
        }
    }

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

    let client = openai::Client::from_env();
    let model = client.embedding_model_with_ndims(&model_name, ndims);

    let conn = Connection::open(&db_path)
        .await
        .with_context(|| format!("opening SQLite at {db_path}"))?;

    let store: SqliteVectorStore<_, EisDocuments> = SqliteVectorStore::new(conn, &model)
        .await
        .context("initialising SqliteVectorStore")?;

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

    // ── Index loop ────────────────────────────────────────────────────────────

    let mut total_chunks = 0usize;
    let mut total_files_ok = 0usize;
    let mut pending: Vec<EisDocuments> = Vec::new();

    for md_path in &md_paths {
        let file_name = md_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| md_path.display().to_string());

        info!("Processing {file_name}");

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
            warn!("Skipping {file_name}: no text content found after parsing");
            continue;
        }

        let mut file_chunks = 0usize;

        for section in &sections {
            let raw_chunks = chunk_text(&section.body, chunk_size, chunk_overlap);

            if raw_chunks.is_empty() {
                continue;
            }

            for (chunk_idx, content) in raw_chunks.into_iter().enumerate() {
                pending.push(EisDocuments {
                    id: format!("{file_name}::{section_slug}::c{chunk_idx}",
                        section_slug = slugify(&section.heading)),
                    file_name: file_name.clone(),
                    page: section.heading.clone(),
                    chunk_index: chunk_idx.to_string(),
                    content,
                });
                file_chunks += 1;

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

        info!("  → {file_name}: {file_chunks} chunk(s) across {} section(s)", sections.len());
        total_files_ok += 1;
    }

    // ── Final flush ───────────────────────────────────────────────────────────

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
        md_paths.len()
    );

    Ok(())
}

/// Convert a heading string to a compact, filename-safe slug.
///
/// Lowercases, trims, and collapses whitespace/punctuation to underscores.
fn slugify(heading: &str) -> String {
    heading
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect::<String>()
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{chunk_text, parse_sections, slugify};

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
        // size=6, overlap=2 → step=4
        // chunk 0: [0..6] = "abcdef"
        // chunk 1: [4..10] = "efghij"
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
        // Heading is prepended into the body for embedding quality.
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
        // The heading with no body should produce no section.
        let md = "# Empty\n\n# Has content\n\nSome text here.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].heading, "Has content");
    }

    #[test]
    fn parse_sections_heading_prepended_in_body() {
        // The heading must appear at the start of the body so the embedding
        // can match queries that mention only the heading identifier (e.g. "РДИК_0003").
        let md = "### РДИК_0003 — Дубль документа\n\nОписание: уже существует документ.";
        let sections = parse_sections(md);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].heading, "РДИК_0003 — Дубль документа");
        assert!(sections[0].body.starts_with("РДИК_0003 — Дубль документа"));
        assert!(sections[0].body.contains("Описание"));
    }

    #[test]
    fn parse_sections_root_body_not_prefixed() {
        // Content before any heading is "(root)" — no prefix should be added.
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
}
