# AGENTS.md

Rust service (Axum/Tokio): EIS package **parse** and XSD **validate** HTTP APIs; CLI **`index_pdfs`** embeds PDF chunks into SQLite (`rig-core`, `sqlite-vec`, `lopdf`). XSD via **libxml2** (`libxml` crate).

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

Handlers live under `src/handlers` (re-export from `mod.rs`); routes in `src/routes`; config in `src/config.rs`; HTTP errors via `AppError` in `error.rs`.

## API (multipart `file` field)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{"status":"ok","timestamp":...}` |
| POST | `/parse` | SOAP envelope (Windows-1251): decode Base64 from `Документ/Контент` and `Прилож/Контент` → JSON `{document, attachment}` (pretty-printed UTF-8 XML). **400** if missing/invalid. |
| POST | `/validate` | Validate against `schemas/DP_PAKET_EIS_01_00.xsd` → `{valid, errors[]}`. **200** even when invalid; **400** without file; **500** on I/O. |

Plain HTTP only (TLS at reverse proxy).

## Config

Copy `.env.example` → `.env`. `index_pdfs` auto-loads `.env` via `dotenvy`.

**Server:** `HOST` (default `0.0.0.0`), `PORT` (`3000`), `LOG_LEVEL` (`info`).

**`index_pdfs`:** `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (`https://api.openai.com/v1`), `EMBEDDING_MODEL` (`text-embedding-3-small`), `EMBEDDING_NDIMS` (required for non-OpenAI models; auto for `text-embedding-3-small`→1536, `text-embedding-3-large`→3072, `text-embedding-ada-002`→1536), `CHUNK_SIZE`/`CHUNK_OVERLAP`/`BATCH_SIZE` (512/64/50; keep batch ≤100), `DB_PATH` (`chunks.db` → `pdf_chunks` rows).

## Prerequisites and build

```bash
# macOS
brew install libxml2 pkgconf
export PKG_CONFIG_PATH="/opt/homebrew/Cellar/libxml2/$(brew list --versions libxml2 | awk '{print $2}')/lib/pkgconfig"

# Debian/Ubuntu
sudo apt install libxml2-dev pkg-config

cargo build
cargo run
curl http://127.0.0.1:3000/health
curl -F "file=@your_file.xml" http://127.0.0.1:3000/validate
```

**`index_pdfs`:** `cargo run --bin index_pdfs -- --dir /path/to/pdfs` (or set `OPENAI_API_KEY` etc. inline; see `.env.example`).

## Coding Guidelines

- Keep modules separated by concern (`routes`, `handlers`, `middleware`, `config`, `error`).
- Use typed request/response structs.
- Prefer `AppError` for failures returned to clients.
- Use `tracing` macros instead of `println!`.

## Commit and PR Guidelines

- Prefer small, focused PRs with one primary intent.
- Before committing or opening a PR, run: `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.
- In the PR description, include what changed, why, and how you validated it.
