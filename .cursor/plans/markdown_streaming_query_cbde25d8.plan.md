---
name: markdown streaming query
overview: Refactor `/query` streaming so Markdown chunks are SSE-safe and progressively renderable in the frontend without breaking the existing RAG retrieval/completion flow.
todos:
  - id: backend-sse-json-contract
    content: Design and implement JSON-based SSE event payloads in query handler while preserving existing /query flow
    status: completed
  - id: frontend-parser-backcompat
    content: Refactor streamQuery SSE parser to support multiline data blocks and JSON events with legacy fallback
    status: completed
  - id: frontend-markdown-render
    content: Render assistant responses as progressive Markdown while keeping current streaming UX
    status: completed
  - id: streaming-tests
    content: Add focused backend/frontend tests for multiline Markdown chunk integrity and done/error handling
    status: completed
  - id: e2e-smoke-check
    content: Run end-to-end validation of progressive Markdown rendering and stream stability
    status: completed
isProject: false
---

# Refactor Markdown Streaming for Query

## Goal
Deliver Markdown-safe streaming from `POST /query` so headings/paragraphs/inline formatting survive transport and can be rendered progressively in the chat UI.

## Current Issues
- Backend currently emits raw chunk text as `data: <chunk>\n\n` in [`/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs`](/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs). If a chunk contains newlines, it can break SSE framing because each event line in SSE must be prefixed correctly.
- Frontend parser in [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts) assumes single-line payload events and splits by `\n\n`, which is fragile for structured Markdown.
- Chat rendering in [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/components/ChatMessage.tsx`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/components/ChatMessage.tsx) displays plain text (`whiteSpace: pre-wrap`) rather than Markdown rendering.

## Implementation Plan

### 1) Stabilize SSE event contract in backend
- In [`/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs`](/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs), switch from raw `data: {text}` payload to JSON payload per SSE event, for example:
  - delta event: `data: {"type":"delta","text":"..."}`
  - done event: `data: {"type":"done"}`
  - error event: `data: {"type":"error","message":"..."}`
- Serialize via `serde_json` (not manual string concatenation) so newlines and special Markdown characters are escaped at transport layer but reconstructed exactly on client.
- Keep endpoint (`/query`), RAG retrieval (`repository.search`), prompt build, and model streaming flow unchanged.

### 2) Make frontend SSE parser robust and backward-compatible
- Update [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts) to parse event blocks safely (multi-line `data:` support), then decode JSON payload.
- Support both protocols during transition:
  - New JSON event format (`type=delta|done|error`)
  - Legacy markers (`[DONE]`, `[ERROR] ...`) as fallback
- Continue invoking existing callbacks (`onChunk`, `onDone`, `onError`) so upstream chat state logic remains intact.

### 3) Render assistant output as progressive Markdown
- In [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/components/ChatMessage.tsx`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/components/ChatMessage.tsx), render assistant message content through a Markdown renderer (e.g., `react-markdown`) while keeping user messages plain text.
- Preserve streaming behavior by appending deltas in [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/pages/ChatPage.tsx`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/pages/ChatPage.tsx); each repaint should parse the current partial Markdown buffer.
- Add minimal style rules for Markdown blocks (`h1-h4`, `p`, `ul/ol`, `strong`, `em`, `code`) so partially streamed content remains readable.

### 4) Add targeted tests for streaming safety
- Backend tests in [`/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs`](/Users/heyyyoyy/projects/eis_assistant/src/handlers/query.rs):
  - Verify SSE event builder produces valid JSON `data:` payloads for multiline Markdown delta.
  - Verify done/error event serialization.
- Frontend tests (or parser unit helper) in [`/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts`](/Users/heyyyoyy/projects/eis_assistant/frontend/src/api.ts):
  - Parse chunked stream fragments that split in arbitrary byte boundaries.
  - Confirm Markdown text round-trips exactly (including `###`, blank lines, `**bold**`).

### 5) Validate end-to-end behavior
- Manual smoke flow:
  - Send query and confirm progressive rendering of sample Markdown:
    - `### Описание ЕИС`
    - blank line + paragraph text
  - Ensure no visible broken tokens from transport framing.
  - Ensure stream closes cleanly on done and errors still surface correctly.
- Keep existing RAG behavior unchanged (retrieval + prompt + model stream source remains as-is).