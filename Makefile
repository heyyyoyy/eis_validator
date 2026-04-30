.PHONY: help
help:
	@echo "Available targets:"
	@echo "  make check           - Run fmt + lint + test"
	@echo "  make docker-dev      - Start full stack in dev mode"
	@echo "  make docker-prod     - Start production stack (detached)"
	@echo "  make index           - Recreate and index docs from external_docs"
	@echo "  make index-append    - Append docs to existing index"

.PHONY: check
check:
	cargo fmt
	cargo clippy --all-targets --all-features -- -D warnings
	cargo test

.PHONY: docker-dev
docker-dev:
	docker compose -f docker-compose.dev.yml up --build

.PHONY: docker-prod
docker-prod:
	docker compose -f docker-compose.prod.yml up --build -d

.PHONY: index
index:
	cargo run --bin index_mds -- --dir external_docs

.PHONY: index-append
index-append:
	cargo run --bin index_mds -- --dir external_docs --append
