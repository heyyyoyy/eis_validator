export interface ParseResponse {
  document: string;
  attachment: string;
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
