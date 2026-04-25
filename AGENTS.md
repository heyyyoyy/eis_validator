# AGENTS.md

## Project Overview

`eis_validator` is a Rust API service built with Axum and Tokio. It provides a health endpoint, an XSD validation endpoint that validates uploaded XML files against the EIS transport package schema, and a standalone CLI binary (`index_pdfs`) that indexes PDF documents into a SQLite vector store for use in RAG pipelines.

## Tech Stack

- Rust (2021), Axum, Tokio
- Serde / `serde_json`
- Tower / `tower-http` (CORS, trace)
- `thiserror`, `tracing`, `tracing-subscriber`
- `libxml` (libxml2 binding for XSD validation)
- `tempfile` (temporary file management)
- `quick-xml` (XML parsing and pretty-printing)
- `encoding_rs` (Windows-1251 → UTF-8 transcoding)
- `base64` (Base64 decoding)
- `rig-core` (embeddings via OpenAI-compatible API)
- `rig-sqlite` + `sqlite-vec` (SQLite vector store)
- `lopdf` (PDF text extraction)
- `walkdir` (recursive directory traversal)
- `dotenvy` (`.env` file loading)
- `clap` (CLI argument parsing for `index_pdfs`)
- `anyhow` (error handling in `index_pdfs`)

## Repository Structure

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
    ├── bin
    │   └── index_pdfs.rs
    ├── handlers
    │   ├── mod.rs
    │   ├── parse.rs
    │   └── validate.rs
    ├── middleware
    │   └── mod.rs
    └── routes
        └── mod.rs
```

### Module Responsibilities

- `src/main.rs`: bootstraps config, middleware, and plain HTTP server startup/shutdown via Axum + Tokio
- `src/config.rs`: environment-based app config
- `src/routes/mod.rs`: route registration
- `src/handlers/mod.rs`: handler module declarations and re-exports
- `src/handlers/parse.rs`: EIS package parse handler, `extract_and_pretty_print` core logic, and unit tests
- `src/handlers/validate.rs`: XSD validation handler, `run_validation` core logic, and unit tests
- `src/middleware/mod.rs`: middleware layers
- `src/error.rs`: application error type and HTTP response mapping
- `src/bin/index_pdfs.rs`: standalone CLI binary — walks a PDF directory, chunks text, generates embeddings, and stores results in a SQLite vector store
- `schemas/`: XSD schema files used for validation

## API Surface

- `GET /health` returns `{"status":"ok","timestamp":"<ms>"}`.
- `POST /parse` accepts a `multipart/form-data` request with a single EIS package XML file field (a Windows-1251 encoded SOAP envelope). Extracts the Base64-encoded XML payloads from `Документ/Контент` and `Прилож/Контент`, decodes them, and returns both as pretty-printed UTF-8 XML strings:

```json
{
  "document": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<root>\n  ...\n</root>",
  "attachment": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<root>\n  ...\n</root>"
}
```

Returns `200 OK` on success. Returns `400 Bad Request` if no file field is present, if either `Документ/Контент` or `Прилож/Контент` is missing, or if the Base64 content is invalid.

- `POST /validate` accepts a `multipart/form-data` request with a single XML file field. Validates the file against `schemas/DP_PAKET_EIS_01_00.xsd` and returns:

```json
{
  "valid": false,
  "errors": [
    {
      "message": "Element 'ФайлПакет': The attribute 'ИдТрПакет' is required but missing.",
      "level": "Error",
      "line": 2,
      "column": null,
      "filename": null
    }
  ]
}
```

Returns `200 OK` for both valid and invalid XML. Returns `400 Bad Request` if no file field is present, or `500` on I/O failures.

## Configuration

Copy `.env.example` to `.env` and adjust. Both the API server and `index_pdfs` read environment variables; `index_pdfs` also auto-loads `.env` from the working directory via `dotenvy`.

### API server

| Variable    | Default     | Purpose                        |
|-------------|-------------|--------------------------------|
| `HOST`      | `0.0.0.0`   | Bind address                   |
| `PORT`      | `3000`      | Listen port                    |
| `LOG_LEVEL` | `info`      | Log verbosity (`trace`…`error`)|

The backend always runs plain HTTP. TLS termination is handled exclusively by the Nginx reverse proxy.

```bash
HOST=127.0.0.1 PORT=8080 LOG_LEVEL=debug cargo run
```

### `index_pdfs` binary

| Variable           | Default                       | Purpose                                                   |
|--------------------|-------------------------------|-----------------------------------------------------------|
| `OPENAI_API_KEY`   | *(required)*                  | Bearer token for the embedding API                        |
| `OPENAI_BASE_URL`  | `https://api.openai.com/v1`   | Endpoint — any OpenAI-compatible proxy is supported       |
| `EMBEDDING_MODEL`  | `text-embedding-3-small`      | Model name                                                |
| `EMBEDDING_NDIMS`  | auto for OpenAI models        | Vector dimensions — **must** be set for custom models     |
| `CHUNK_SIZE`       | `512`                         | Max characters per text chunk                             |
| `CHUNK_OVERLAP`    | `64`                          | Overlap characters between consecutive chunks             |
| `BATCH_SIZE`       | `50`                          | Chunks per embedding API call (keep ≤ 100)                |
| `DB_PATH`          | `chunks.db`                   | Output SQLite file path                                   |

Known OpenAI model dimensions (auto-detected when `EMBEDDING_MODEL` matches):
`text-embedding-3-small` → 1536, `text-embedding-3-large` → 3072, `text-embedding-ada-002` → 1536.
For any other model (e.g. a local Nomic model at 768 dims) set `EMBEDDING_NDIMS` explicitly.

## Setup Instructions

### Prerequisites

`libxml2` and `pkgconf` must be installed:

```bash
# macOS
brew install libxml2 pkgconf

# Linux (Debian/Ubuntu)
apt install libxml2-dev pkg-config
```

On macOS, libxml2 is keg-only. Export the pkg-config path before building:

```bash
export PKG_CONFIG_PATH="/opt/homebrew/Cellar/libxml2/$(brew list --versions libxml2 | awk '{print $2}')/lib/pkgconfig"
```

### Build and run

```bash
cargo build
cargo run
curl http://127.0.0.1:3000/health
curl -F "file=@your_file.xml" http://127.0.0.1:3000/validate
```

### Running `index_pdfs`

```bash
# with .env file present in the project root:
cargo run --bin index_pdfs -- --dir /path/to/pdfs

# or with env vars inline:
OPENAI_API_KEY=sk-... EMBEDDING_MODEL=text-embedding-3-small \
  cargo run --bin index_pdfs -- --dir /path/to/pdfs
```

The binary writes a SQLite database to `DB_PATH` (default `chunks.db`). Each row in the `pdf_chunks` table stores the file name, page number, chunk index, text content, and the corresponding embedding vector.

## Developer Workflow

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo run
```

When adding features:
- add handlers in `src/handlers` (new module per handler, re-export from `mod.rs`)
- register routes in `src/routes`
- keep config updates in `src/config.rs`
- reuse `AppError` for API errors
- add new CLI tools as separate files under `src/bin/`

### Adding a new XSD schema

Place the `.xsd` file in `schemas/` and define a constant for its filename in the relevant handler module (following the `DP_PAKET_EIS_01_00` pattern in `src/handlers/validate.rs`).

## Coding Guidelines

- Keep modules separated by concern (`routes`, `handlers`, `middleware`, `config`, `error`).
- Use typed request/response structs.
- Prefer `AppError` for failures returned to clients.
- Use `tracing` macros instead of `println!`.

## Commit and PR Guidelines

- Prefer small, focused PRs with one primary intent.
- Before committing or opening a PR, run: `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.
- In the PR description, include what changed, why, and how you validated it.