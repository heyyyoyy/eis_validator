---
name: EIS Parse Frontend
overview: Build a React + TypeScript frontend (Vite) as a `frontend/` subfolder in the repo. It provides a single-page UI to upload an EIS package file, POST it to `POST /parse`, and display the returned `document` and `attachment` XML strings in scrollable, syntax-highlighted panels.
todos:
  - id: scaffold
    content: Scaffold frontend/ with package.json, vite.config.ts, tsconfig.json, index.html and install deps
    status: completed
  - id: api
    content: Create src/api.ts with typed fetch wrapper for POST /parse
    status: completed
  - id: file-upload
    content: Create FileUpload.tsx — drag-drop + click, .xml validation, filename/size display
    status: completed
  - id: xml-panel
    content: Create XmlPanel.tsx — scrollable pre block with label and copy button
    status: completed
  - id: status-banner
    content: Create StatusBanner.tsx — loading spinner and error message
    status: completed
  - id: app
    content: Create App.tsx composing all components with idle/loading/success/error state machine
    status: completed
  - id: verify
    content: Run npm run build in frontend/ and confirm zero TypeScript/lint errors
    status: completed
isProject: false
---

# EIS Parse Frontend

## Stack

- **Vite + React + TypeScript** — fast, modern, stable
- **Tailwind CSS v4** — minimal utility styling, no component library needed
- No extra runtime dependencies beyond Vite/React/Tailwind

## Project layout

New directory: `frontend/` at repo root

```
frontend/
├── index.html
├── package.json
├── vite.config.ts          # proxy /parse → http://localhost:3000
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx             # root: composes all sections
│   ├── api.ts              # typed fetch wrapper for POST /parse
│   └── components/
│       ├── FileUpload.tsx  # drag-drop + click upload, .xml only
│       ├── XmlPanel.tsx    # scrollable pre block with label
│       └── StatusBanner.tsx # loading spinner / error message
```

## API contract (from AGENTS.md)

- **Request:** `POST /parse` — `multipart/form-data`, single field (any name), value = EIS package XML file
- **200 Response:**
```json
{ "document": "<pretty XML>", "attachment": "<pretty XML>" }
```
- **400 Response:** plain text or JSON error message
- CORS is open (`allow_origin: Any`) so the dev proxy is optional but useful

## Key implementation details

### `api.ts`
```ts
export async function parseEisPackage(file: File): Promise<ParseResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/parse", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<ParseResponse>;
}
export interface ParseResponse { document: string; attachment: string; }
```

### `FileUpload.tsx`
- Accepts only `.xml` files (HTML `accept` + client-side type check)
- Shows selected filename and file size once chosen
- Drag-and-drop zone with visible border feedback

### `XmlPanel.tsx`
- Receives `label` and `content` (the XML string)
- Scrollable `<pre>` block, monospace, max-height ~50vh
- Copy-to-clipboard button

### `App.tsx` state machine
- `idle` → user selects file
- `loading` → fetch in-flight, spinner shown, submit disabled
- `success` → both `XmlPanel`s rendered
- `error` → `StatusBanner` with message, form still accessible

### Vite proxy (`vite.config.ts`)
```ts
server: { proxy: { "/parse": "http://localhost:3000" } }
```
Avoids CORS issues in dev; production can set `VITE_API_BASE` env var.

## Files to create

- [`frontend/package.json`](frontend/package.json)
- [`frontend/vite.config.ts`](frontend/vite.config.ts)
- [`frontend/tsconfig.json`](frontend/tsconfig.json)
- [`frontend/index.html`](frontend/index.html)
- [`frontend/src/main.tsx`](frontend/src/main.tsx)
- [`frontend/src/App.tsx`](frontend/src/App.tsx)
- [`frontend/src/api.ts`](frontend/src/api.ts)
- [`frontend/src/components/FileUpload.tsx`](frontend/src/components/FileUpload.tsx)
- [`frontend/src/components/XmlPanel.tsx`](frontend/src/components/XmlPanel.tsx)
- [`frontend/src/components/StatusBanner.tsx`](frontend/src/components/StatusBanner.tsx)

## No backend changes required

CORS is already open, `/parse` is registered, and the response shape is stable.