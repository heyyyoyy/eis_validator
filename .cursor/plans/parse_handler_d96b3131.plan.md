---
name: Parse Handler
overview: Add a `POST /parse` endpoint that accepts an EIS package XML file (a SOAP envelope), extracts the two Base64-encoded XML payloads from `Документ/Контент` and `Прилож/Контент`, decodes them, pretty-prints them, and returns both as JSON.
todos:
  - id: deps
    content: Add quick-xml, encoding_rs, and base64 dependencies to Cargo.toml
    status: completed
  - id: handler
    content: Create src/handlers/parse.rs with parse_handler logic and unit tests
    status: completed
  - id: mod
    content: Declare pub mod parse and re-export parse_handler in src/handlers/mod.rs
    status: completed
  - id: routes
    content: Register POST /parse route in src/routes/mod.rs
    status: completed
  - id: agents
    content: Update AGENTS.md to document the new endpoint
    status: completed
isProject: false
---

# Parse Handler Plan

## Overview

Add a `POST /parse` endpoint following the same pattern as `POST /validate`. The uploaded file is a Windows-1251 encoded SOAP envelope. Two child elements each contain a Base64 string that decodes to a Windows-1251 XML file.

## Key observations from the test file

- The outer file is `<?xml ... encoding="windows-1251">` — must be read as raw bytes, not as UTF-8.
- `Документ/Контент` → first XML payload (the main EIS document).
- `Прилож/Контент` → second XML payload (the attachment/appendix document).
- Both decoded payloads are also Windows-1251 XML — must be re-encoded to UTF-8 for display.
- Pretty-printing can be done with `quick-xml` (indent the byte stream) without needing a full DOM tree.

## New dependency

Add `quick-xml` to `Cargo.toml`:
```toml
quick-xml = { version = "0.39", features = [] }
```

Also add `encoding_rs` for Windows-1251 → UTF-8 transcoding (it's a common, lightweight crate):
```toml
encoding_rs = "0.8"
```

## Files to change

- [`Cargo.toml`](Cargo.toml) — add `quick-xml` and `encoding_rs` dependencies.
- [`src/handlers/parse.rs`](src/handlers/parse.rs) — new handler module.
- [`src/handlers/mod.rs`](src/handlers/mod.rs) — declare `pub mod parse` and re-export `parse_handler`.
- [`src/routes/mod.rs`](src/routes/mod.rs) — register `POST /parse`.
- [`AGENTS.md`](AGENTS.md) — document the new endpoint.

## Response shape

```json
{
  "document": "<pretty-printed XML string>",
  "attachment": "<pretty-printed XML string>"
}
```

Both fields are `String`. On error (missing field, missing element, bad Base64, etc.) the handler returns `400 Bad Request` via `AppError::BadRequest`.

## Handler logic (`src/handlers/parse.rs`)

```
parse_handler(multipart)
  1. Read the uploaded file bytes from multipart.
  2. Decode bytes as Windows-1251 → UTF-8 string (using encoding_rs).
  3. Parse the outer XML with quick-xml, walking the element tree to find:
       - text inside Документ > Контент  → base64_document
       - text inside Прилож  > Контент   → base64_attachment
  4. base64::decode each string (using Rust std or the `base64` crate).
     (quick-xml bundles no base64; use the `base64` crate.)
  5. Each decoded byte slice is Windows-1251 → transcode to UTF-8 with encoding_rs.
  6. Pretty-print each UTF-8 XML string with quick-xml's indent writer.
  7. Return ParseResponse { document, attachment }.
```

Note: `base64` is not yet a dependency — add it:
```toml
base64 = "0.22"
```

## Route

```
POST /parse   multipart/form-data, single file field
```

## Unit tests (inline in `src/handlers/parse.rs`)

The core extraction and pretty-print logic will be split into a pure function `extract_and_pretty_print(bytes: &[u8]) -> Result<ParseResponse, AppError>` (mirroring `run_validation` in `validate.rs`), making it directly testable without a live server.

Tests use minimal synthetic SOAP envelopes constructed inline as `&[u8]` — no fixture files needed. The inner XML payloads are UTF-8 (Base64-encoded inline) to keep helper functions simple.

Helper used in tests:
```rust
fn make_package(doc_content: Option<&str>, att_content: Option<&str>) -> Vec<u8> {
    // Builds a minimal SOAP envelope byte string with optional
    // <Документ><Контент>...</Контент></Документ> and
    // <Прилож><Контент>...</Контент></Прилож> elements.
}
```

The inner XML for the valid cases is a trivial UTF-8 XML string, Base64-encoded inline:
```
<?xml version="1.0" encoding="UTF-8"?><root><child>value</child></root>
```

Tests to include:

- **`test_extract_valid_package`** — synthetic envelope with both elements present; assert `document` and `attachment` are non-empty strings starting with `<?xml`.
- **`test_missing_document_content`** — envelope with no `Документ/Контент` → expect `Err(AppError::BadRequest(...))`.
- **`test_missing_attachment_content`** — envelope with `Документ/Контент` present but no `Прилож/Контент` → expect `Err(AppError::BadRequest(...))`.
- **`test_invalid_base64`** — `Контент` contains `!!!not-base64!!!` → expect `Err(AppError::BadRequest(...))`.
- **`test_pretty_print_indents_output`** — assert the `document` field contains a newline character (i.e. is actually indented, not a single-line blob).
