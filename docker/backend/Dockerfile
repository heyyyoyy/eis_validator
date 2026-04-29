# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM rust:1.88-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2-dev \
    pkg-config \
    clang \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependency compilation separately from application code
COPY Cargo.toml Cargo.lock ./
# Create a dummy main so `cargo build` can resolve and compile all deps
RUN mkdir -p src/bin && \
    echo 'fn main() {}' > src/main.rs && \
    echo 'fn main() {}' > src/bin/index_mds.rs && \
    echo 'fn main() {}' > src/bin/generate_certs.rs && \
    cargo build --release && \
    rm -rf src

# Build the real application
COPY src ./src
COPY schemas ./schemas
# Touch main.rs to force recompilation of the application crate
RUN touch src/main.rs && cargo build --release

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false -u 1001 appuser

WORKDIR /app

COPY --from=builder /build/target/release/eis_assistant /app/eis_assistant
COPY --from=builder /build/schemas /app/schemas

RUN chown -R appuser:appuser /app

USER appuser

ENV HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/eis_assistant"]
