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
