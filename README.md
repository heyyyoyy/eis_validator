# eis_validator

A full-stack app for working with **EIS transport package** XML: a **Rust (Axum)** API validates XML against the bundled XSD, extracts payloads from SOAP envelopes, and answers natural-language questions via a **RAG pipeline** (hybrid vector search over Qdrant + LLM completion). A **React (Vite)** UI talks to that API through a dev proxy or Nginx in production.

## What it does

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check — `{"status":"ok","timestamp":...}` |
| `POST` | `/validate` | Upload an XML file (`multipart/form-data`, field `file`). Validates against `schemas/DP_PAKET_EIS_01_00.xsd`. Returns `{valid, errors[]}`. |
| `POST` | `/parse` | Upload an EIS SOAP envelope (Windows-1251). Extracts and Base64-decodes `Документ/Контент` and `Прилож/Контент`, returns pretty-printed UTF-8 XML for both. |
| `POST` | `/query` | RAG query: hybrid dense + BM25 sparse search (RRF merge) over Qdrant, streamed SSE answer from the LLM. Requires `OPENAI_API_KEY` and an indexed Qdrant collection. |

The backend serves **plain HTTP** only; TLS is handled by Nginx in the production Docker setup.

## Prerequisites

### Run locally (without Docker)

- **Rust** (stable) and **Cargo**
- **libxml2** and **pkg-config**
- **Node.js** 22+ and **npm** (frontend only)

```bash
# macOS
brew install libxml2 pkgconf
# if the linker cannot find libxml2:
export PKG_CONFIG_PATH="/opt/homebrew/opt/libxml2/lib/pkgconfig"

# Debian/Ubuntu
sudo apt install libxml2-dev pkg-config
```

### Run with Docker

- **Docker** with Compose v2

## Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

All variables are documented in `.env.example`. Key groups:

| Group | Variables |
|-------|-----------|
| Server | `PORT`, `LOG_LEVEL`, `HOST` |
| Production ports | `HTTP_PORT`, `HTTPS_PORT` |
| TLS (cert-gen) | `CERTS_DIR`, `CERT_DAYS`, `CERT_SUBJECT`, `CERT_SAN` |
| OpenAI / LLM | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_NDIMS`, `COMPLETION_MODEL` |
| Qdrant | `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` |
| index_mds | `CHUNK_SIZE`, `CHUNK_OVERLAP`, `BATCH_SIZE` |

Any OpenAI-compatible endpoint works (Azure, LM Studio, Ollama, LiteLLM, etc.) — set `OPENAI_BASE_URL` accordingly.

## How to run

### Option 1: Docker Compose — development (recommended for full stack)

Starts the **Vite dev server** (HMR), the Rust backend, and Qdrant. Source files are bind-mounted for live reload.

```bash
docker compose -f docker-compose.dev.yml up --build
```

| Service  | Host address |
|----------|-------------|
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:3000 |
| Qdrant REST | http://localhost:6333 |
| Qdrant gRPC | localhost:6334 |

API requests to `/health`, `/parse`, `/validate`, and `/query` are proxied by Vite to the backend.

### Option 2: Docker Compose — production (HTTPS + resource limits)

Builds the static frontend, runs Nginx with TLS (self-signed certs from the one-shot `cert-gen` service), and applies CPU/memory limits. Qdrant is internal-only (no host ports).

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Defaults: HTTP on **80**, HTTPS on **443**. Override in `.env`:

```env
HTTP_PORT=5115
HTTPS_PORT=5116
```

### Option 3: Backend only (`cargo`)

```bash
cargo run
```

Defaults: `HOST=0.0.0.0`, `PORT=3000`, `LOG_LEVEL=info`. Quick override:

```bash
HOST=127.0.0.1 PORT=8080 LOG_LEVEL=debug cargo run
```

Smoke test:

```bash
curl http://127.0.0.1:3000/health
curl -F "file=@path/to/file.xml" http://127.0.0.1:3000/validate
```

### Option 4: Frontend dev server + local API

Terminal 1 — backend:

```bash
cargo run
```

Terminal 2 — frontend:

```bash
cd frontend
npm ci
npm run dev
```

Open the URL Vite prints (typically http://localhost:5173). To point the proxy at a different backend, set `VITE_PROXY_TARGET` (see `frontend/vite.config.ts`).

## Indexing documents (RAG)

The `/query` endpoint requires the Qdrant collection to be populated first. Use the `index_mds` binary to embed and index Markdown files:

```bash
# Against the containerized Qdrant (dev compose running)
QDRANT_URL=http://localhost:6334 cargo run --bin index_mds -- --dir external_docs

# Append to an existing collection (skip recreation)
QDRANT_URL=http://localhost:6334 cargo run --bin index_mds -- --dir external_docs --append
```

See `.env.example` for all `index_mds` tunables (`CHUNK_SIZE`, `CHUNK_OVERLAP`, `BATCH_SIZE`, `EMBEDDING_MODEL`, etc.).

## Vector storage

Qdrant collection `eis_documents` — two named vectors per point:

| Vector | Type | Distance | Description |
|--------|------|----------|-------------|
| `dense` | Dense | Cosine | OpenAI-compatible embedding (default 1536-dim) |
| `sparse` | Sparse | — | BM25 term weights |

Search merges both lists via **Reciprocal Rank Fusion** (RRF, k=60).

## Development

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Frontend:

```bash
cd frontend
npm run build
```

## License / project metadata

See `Cargo.toml` for crate name and version. Schema files live under `schemas/`.
