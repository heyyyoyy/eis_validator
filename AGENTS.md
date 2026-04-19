# AGENTS.md

## Project Overview

`eis_validator` is a Rust API service built with Axum and Tokio. It provides a health endpoint and an XSD validation endpoint that validates uploaded XML files against the EIS transport package schema.

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

## Repository Structure

```text
.
├── Cargo.toml
├── Cargo.lock
├── .gitignore
├── schemas
│   └── DP_PAKET_EIS_01_00.xsd
└── src
    ├── main.rs
    ├── config.rs
    ├── error.rs
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

- `src/main.rs`: bootstraps config, middleware, and server startup/shutdown
- `src/config.rs`: environment-based app config
- `src/routes/mod.rs`: route registration
- `src/handlers/mod.rs`: handler module declarations and re-exports
- `src/handlers/parse.rs`: EIS package parse handler, `extract_and_pretty_print` core logic, and unit tests
- `src/handlers/validate.rs`: XSD validation handler, `run_validation` core logic, and unit tests
- `src/middleware/mod.rs`: middleware layers
- `src/error.rs`: application error type and HTTP response mapping
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

Environment variables:

- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `3000`)
- `LOG_LEVEL` (default: `info`)

Example:

```bash
HOST=127.0.0.1 PORT=8080 LOG_LEVEL=debug cargo run
```

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