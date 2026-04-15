# AGENTS.md

## Project Overview

`eis_validator` is a Rust API service built with Axum and Tokio. It currently provides a health endpoint and a modular base for adding validation features.

## Tech Stack

- Rust (2021), Axum, Tokio
- Serde / `serde_json`
- Tower / `tower-http` (CORS, trace)
- `thiserror`, `tracing`, `tracing-subscriber`

## Repository Structure

```text
.
├── Cargo.toml
├── Cargo.lock
├── .gitignore
└── src
    ├── main.rs
    ├── config.rs
    ├── error.rs
    ├── handlers
    │   └── mod.rs
    ├── middleware
    │   └── mod.rs
    └── routes
        └── mod.rs
```

### Module Responsibilities

- `src/main.rs`: bootstraps config, middleware, and server startup/shutdown
- `src/config.rs`: environment-based app config
- `src/routes/mod.rs`: route registration
- `src/handlers/mod.rs`: request handlers
- `src/middleware/mod.rs`: middleware layers
- `src/error.rs`: application error type and HTTP response mapping

## API Surface

- `GET /health` returns `{"status":"ok","timestamp":"<ms>"}`.

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

```bash
cargo build
cargo run
curl http://127.0.0.1:3000/health
```

## Developer Workflow

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo run
```

When adding features:
- add handlers in `src/handlers`
- register routes in `src/routes`
- keep config updates in `src/config.rs`
- reuse `AppError` for API errors

## Coding Guidelines

- Keep modules separated by concern (`routes`, `handlers`, `middleware`, `config`, `error`).
- Use typed request/response structs.
- Prefer `AppError` for failures returned to clients.
- Use `tracing` macros instead of `println!`.

## Commit and PR Guidelines

- Prefer small, focused PRs with one primary intent.
- Before opening a PR, run: `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.
- In the PR description, include what changed, why, and how you validated it.