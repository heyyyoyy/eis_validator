// ── Query / streaming ─────────────────────────────────────────────────────────

export interface StreamQueryCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
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
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          // SSE spec: strip only the single optional space after "data:"
          // Do NOT trim further — the payload may start with a space that is
          // part of the streamed token (e.g. " world" → word boundary).
          const line = part.trimEnd();
          if (!line.startsWith("data:")) continue;
          // Remove the fixed prefix "data:" and exactly one space if present.
          const payload = line[5] === " " ? line.slice(6) : line.slice(5);

          if (payload === "[DONE]") {
            onDone();
            return;
          }
          if (payload.startsWith("[ERROR]")) {
            onError(payload.slice(7).trim());
            return;
          }
          onChunk(payload);
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
