# eis_validator

## Project Overview

A backend service built with **Rust** and **Axum**, designed for EIS (Единая Информационная Система) validation tasks. The project uses a modular architecture with clear separation of concerns.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Web framework | Axum 0.8 |
| Async runtime | Tokio 1 (full) |
| Serialization | Serde + serde_json |
| Middleware | Tower + tower-http (CORS, tracing, gzip) |
| Logging | tracing + tracing-subscriber (env-filter) |
| Errors | thiserror 2 |

### Architecture

```
src/
├── main.rs         # Server bootstrap, graceful shutdown (SIGTERM + Ctrl+C)
├── config.rs       # Env-based config (HOST, PORT, LOG_LEVEL)
├── error.rs        # AppError enum with IntoResponse
├── handlers/
│   └── mod.rs      # Request handlers (GET /health)
├── middleware/
│   └── mod.rs      # CORS layer (allow all origins)
└── routes/
    └── mod.rs      # Route definitions
```

## Building and Running

```bash
# Build
cargo build

# Run (development)
cargo run

# Run with custom port
PORT=8080 cargo run

# Release build
cargo build --release
cargo run --release
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `3000` | Bind port |
| `LOG_LEVEL` | `info` | Tracing log level (trace, debug, info, warn, error) |

### Endpoints

- `GET /health` — Health check. Returns `{"status": "ok", "timestamp": "..."}`

## Development Conventions

- **Module structure**: Each concern (handlers, routes, middleware, config, errors) lives in its own file or module under `src/`.
- **Error handling**: Use `AppError` (thiserror-based) with `IntoResponse` for JSON error responses.
- **Logging**: Use `tracing` macros (`info!`, `debug!`, `error!`, etc.) throughout.
- **Configuration**: Load settings from environment variables via `AppConfig::from_env()`.
- **Graceful shutdown**: Server handles both Ctrl+C and SIGTERM signals.
