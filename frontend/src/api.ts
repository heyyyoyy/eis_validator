// ── Query / streaming ─────────────────────────────────────────────────────────

export interface StreamQueryCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

type JsonStreamEvent =
  | { type: "delta"; text?: string }
  | { type: "done" }
  | { type: "error"; message?: string };

type ParsedStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function extractSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : "";
  return {
    events: parts.slice(0, -1),
    rest: lastPart ?? "",
  };
}

export function decodeSseEvent(eventBlock: string): ParsedStreamEvent | null {
  const dataLines: string[] = [];

  for (const rawLine of eventBlock.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    dataLines.push(line[5] === " " ? line.slice(6) : line.slice(5));
  }

  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n");
  if (payload === "[DONE]") return { kind: "done" };
  if (payload.startsWith("[ERROR]")) {
    return { kind: "error", message: payload.slice(7).trim() || "Stream error" };
  }

  try {
    const json = JSON.parse(payload) as JsonStreamEvent;
    if (json.type === "delta") {
      return { kind: "delta", text: json.text ?? "" };
    }
    if (json.type === "done") {
      return { kind: "done" };
    }
    if (json.type === "error") {
      return { kind: "error", message: json.message ?? "Stream error" };
    }
  } catch {
    // Backward compatible mode: non-JSON payload is treated as a text delta.
  }

  return { kind: "delta", text: payload };
}

/**
 * POST /query and consume the SSE stream.
 * Returns an AbortController — call `.abort()` to cancel mid-stream.
 */
export function streamQuery(
  query: string,
  { onChunk, onDone, onError }: StreamQueryCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Network error");
      }
      return;
    }

    if (!res.ok) {
      let message = `Server error ${res.status}`;
      try {
        const json = (await res.json()) as { error?: string; message?: string };
        message = json.error ?? json.message ?? message;
      } catch {
        // ignore
      }
      onError(message);
      return;
    }

    if (!res.body) {
      onError("No response body");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = extractSseEvents(buffer);
        buffer = rest;

        for (const eventBlock of events) {
          const event = decodeSseEvent(eventBlock);
          if (!event) continue;

          if (event.kind === "done") {
            onDone();
            return;
          }
          if (event.kind === "error") {
            onError(event.message);
            return;
          }
          onChunk(event.text);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Stream error");
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return controller;
}

// ── Parse / validate ──────────────────────────────────────────────────────────

export interface ParseResponse {
  document: string;
  attachment: string;
}

export interface ValidationError {
  message: string | null;
  level: string;
  line: number | null;
  column: number | null;
  filename: string | null;
}

export interface ValidationResponse {
  valid: boolean;
  errors: ValidationError[];
}

export async function parseEisPackage(file: File): Promise<ParseResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/parse", { method: "POST", body: form });

  if (!res.ok) {
    const text = await res.text();
    let message = `Server error ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string; message?: string };
      message = json.error ?? json.message ?? text;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }

  return res.json() as Promise<ParseResponse>;
}

export async function validateAttachment(xmlText: string): Promise<ValidationResponse> {
  const form = new FormData();
  form.append("file", new Blob([xmlText], { type: "text/xml" }), "attachment.xml");

  const res = await fetch("/validate", { method: "POST", body: form });

  if (!res.ok) {
    const text = await res.text();
    let message = `Server error ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string; message?: string };
      message = json.error ?? json.message ?? text;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }

  return res.json() as Promise<ValidationResponse>;
}
