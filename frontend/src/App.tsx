import { useState } from "react";
import { parseEisPackage, type ParseResponse } from "./api";
import { FileUpload } from "./components/FileUpload";
import { XmlPanel } from "./components/XmlPanel";
import { StatusBanner } from "./components/StatusBanner";

type AppState =
  | { status: "idle" }
  | { status: "ready"; file: File }
  | { status: "loading"; file: File }
  | { status: "success"; file: File; result: ParseResponse }
  | { status: "error"; file: File; message: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: "idle" });

  const handleFileSelect = (file: File) => {
    setState({ status: "ready", file });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.status !== "ready" && state.status !== "success" && state.status !== "error") return;

    const file = state.file;
    setState({ status: "loading", file });

    try {
      const result = await parseEisPackage(file);
      setState({ status: "success", file, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setState({ status: "error", file, message });
    }
  };

  const hasFile = state.status !== "idle";
  const isLoading = state.status === "loading";
  const canSubmit = hasFile && !isLoading;

  return (
    <div style={{ minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "2.5rem" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "1.6rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}>
            EIS Package Parser
          </h1>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem",
            fontWeight: 700,
            background: "var(--accent)",
            color: "#0d0f14",
            padding: "2px 8px",
            borderRadius: "3px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            powered by rust
          </span>
        </header>

        {/* Upload panel */}
        <form onSubmit={handleSubmit} noValidate>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            overflow: "hidden",
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
              upload
            </div>

            <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
              <FileUpload onFileSelect={handleFileSelect} disabled={isLoading} />

              <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "0.55rem 1.25rem",
                    borderRadius: "5px",
                    border: "none",
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    background: canSubmit ? "var(--accent)" : "var(--border)",
                    color: canSubmit ? "#0d0f14" : "var(--muted)",
                    transition: "opacity 0.15s",
                    opacity: canSubmit ? 1 : 0.6,
                  }}
                >
                  {isLoading ? (
                    <>
                      <svg style={{ width: 14, height: 14, animation: "spin 0.8s linear infinite" }} fill="none" viewBox="0 0 24 24">
                        <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Parsing…
                    </>
                  ) : (
                    <>
                      <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                      </svg>
                      Run
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Status banners */}
        {state.status === "loading" && (
          <div style={{ marginTop: "1.25rem" }}>
            <StatusBanner type="loading" />
          </div>
        )}
        {state.status === "error" && (
          <div style={{ marginTop: "1.25rem" }}>
            <StatusBanner type="error" message={state.message} />
          </div>
        )}

        {/* Results */}
        {state.status === "success" && (
          <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* success status bar */}
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              color: "var(--text-dim)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "var(--ok)",
                boxShadow: "0 0 8px var(--ok)",
                display: "inline-block",
              }} />
              parsed successfully · {state.file.name}
            </div>

            <XmlPanel label="document" content={state.result.document} />
            <XmlPanel label="attachment" content={state.result.attachment} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
