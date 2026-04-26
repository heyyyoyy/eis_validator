# AGENTS.md

Rust service (Axum/Tokio): EIS package **parse** and XSD **validate** HTTP APIs; CLI **`index_mds`** embeds Markdown chunks into **Qdrant** (`rig-core`, `qdrant-client`, `bm25`, `pulldown-cmark`). XSD via **libxml2** (`libxml` crate).

## Layout

```text
.
├── Cargo.toml
├── Cargo.lock
├── .gitignore
├── .env.example
├── schemas
│   └── DP_PAKET_EIS_01_00.xsd
└── src
    ├── main.rs
    ├── config.rs
    ├── error.rs
    ├── state.rs
    ├── bin
    │   └── index_mds.rs
    ├── handlers
    │   ├── mod.rs
    │   ├── parse.rs
    │   ├── query.rs
    │   └── validate.rs
    ├── middleware
    │   └── mod.rs
    ├── repository
    │   ├── mod.rs
    │   └── eis_documents.rs
    └── routes
        └── mod.rs
```

Handlers live under `src/handlers` (re-export from `mod.rs`); routes in `src/routes`; config in `src/config.rs`; HTTP errors via `AppError` in `error.rs`; vector search in `src/repository`.

## API (multipart `file` field)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{"status":"ok","timestamp":...}` |
| POST | `/parse` | SOAP envelope (Windows-1251): decode Base64 from `Документ/Контент` and `Прилож/Контент` → JSON `{document, attachment}` (pretty-printed UTF-8 XML). **400** if missing/invalid. |
| POST | `/validate` | Validate against `schemas/DP_PAKET_EIS_01_00.xsd` → `{valid, errors[]}`. **200** even when invalid; **400** without file; **500** on I/O. |
| POST | `/query` | RAG query: hybrid vector search (dense + BM25 sparse, merged via RRF) → streamed SSE response. **503** if `OPENAI_API_KEY` or Qdrant is unavailable. |

Plain HTTP only (TLS at reverse proxy).

## Config

Copy `.env.example` → `.env`. `index_mds` auto-loads `.env` via `dotenvy`.

**Server:** `HOST` (default `0.0.0.0`), `PORT` (`3000`), `LOG_LEVEL` (`info`).

**Qdrant:** `QDRANT_URL` (`http://localhost:6334`), `QDRANT_API_KEY` (optional, for cloud), `QDRANT_COLLECTION` (`eis_documents`).

**`index_mds`:** `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (`https://api.openai.com/v1`), `EMBEDDING_MODEL` (`text-embedding-3-small`), `EMBEDDING_NDIMS` (required for non-OpenAI models; auto for `text-embedding-3-small`→1536, `text-embedding-3-large`→3072, `text-embedding-ada-002`→1536), `CHUNK_SIZE`/`CHUNK_OVERLAP`/`BATCH_SIZE` (512/64/50; keep batch ≤100).

## Vector storage schema

The Qdrant collection `eis_documents` stores two named vectors per point:

| Vector name | Type   | Distance | Description                          |
|-------------|--------|----------|--------------------------------------|
| `dense`     | Dense  | Cosine   | OpenAI embedding (default 1536-dim)  |
| `sparse`    | Sparse | —        | BM25 term weights (u32 index space)  |

Payload fields: `id`, `file_name`, `page`, `chunk_index`, `content`.

Search uses Reciprocal Rank Fusion (RRF, k=60) to merge dense and sparse result lists.

## Prerequisites and build

```bash
# macOS
brew install libxml2 pkgconf
export PKG_CONFIG_PATH="/opt/homebrew/Cellar/libxml2/$(brew list --versions libxml2 | awk '{print $2}')/lib/pkgconfig"

# Debian/Ubuntu
sudo apt install libxml2-dev pkg-config

# Start Qdrant (Docker)
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant

cargo build
cargo run
curl http://127.0.0.1:3000/health
curl -F "file=@your_file.xml" http://127.0.0.1:3000/validate
```

**`index_mds`:** `cargo run --bin index_mds -- --dir /path/to/docs` (append to existing collection: add `--append`; see `.env.example` for env vars).

## Coding Guidelines

- Keep modules separated by concern (`routes`, `handlers`, `middleware`, `config`, `repository`, `error`).
- Use typed request/response structs.
- Prefer `AppError` for failures returned to clients.
- Use `tracing` macros instead of `println!`.

## Commit and PR Guidelines

- Prefer small, focused PRs with one primary intent.
- Before committing or opening a PR, run: `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.
- In the PR description, include what changed, why, and how you validated it.
