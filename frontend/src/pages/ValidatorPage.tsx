import { useState } from "react";
import {
  parseEisPackage,
  validateAttachment,
  type ParseResponse,
  type ValidationError,
  type ValidationResponse,
} from "../api";
import { FileUpload } from "../components/FileUpload";
import { XmlPanel } from "../components/XmlPanel";
import { StatusBanner } from "../components/StatusBanner";
import { ValidationPanel } from "../components/ValidationPanel";
import { isMissingError } from "../utils/validation";

type PageState =
  | { status: "idle" }
  | { status: "ready"; file: File }
  | { status: "loading"; file: File }
  | { status: "success"; file: File; result: ParseResponse; validation: ValidationResponse | null; validating: boolean }
  | { status: "error"; file: File; message: string };

export function ValidatorPage() {
  const [state, setState] = useState<PageState>({ status: "idle" });
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const handleFileSelect = (file: File) => {
    setState({ status: "ready", file });
    setActiveIdx(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.status !== "ready" && state.status !== "success" && state.status !== "error") return;

    const file = state.file;
    setState({ status: "loading", file });
    setActiveIdx(null);

    try {
      const result = await parseEisPackage(file);

      setState({ status: "success", file, result, validation: null, validating: true });

      try {
        const validation = await validateAttachment(result.attachment);
        setState((prev) =>
          prev.status === "success"
            ? { ...prev, validation, validating: false }
            : prev,
        );
      } catch {
        setState((prev) =>
          prev.status === "success"
            ? { ...prev, validating: false }
            : prev,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setState({ status: "error", file, message });
    }
  };

  const hasFile = state.status !== "idle";
  const isLoading = state.status === "loading";
  const canSubmit = hasFile && !isLoading;

  const errorLines = (() => {
    if (state.status !== "success" || state.validation == null) return undefined;
    const map = new Map<number, ValidationError>();
    for (const err of state.validation.errors) {
      if (err.line != null && !isMissingError(err)) {
        map.set(err.line, err);
      }
    }
    return map;
  })();

  const ghostRows = (() => {
    if (state.status !== "success" || state.validation == null) return undefined;
    const map = new Map<number, { err: ValidationError; idx: number }>();
    state.validation.errors.forEach((err, idx) => {
      if (isMissingError(err) && err.line != null) {
        const insertAfter = Math.max(1, err.line - 1);
        map.set(insertAfter, { err, idx });
      }
    });
    return map;
  })();

  const activeErrorLine = (() => {
    if (activeIdx == null || state.status !== "success" || state.validation == null) return null;
    const err = state.validation.errors[activeIdx];
    if (err == null || isMissingError(err)) return null;
    return err.line ?? null;
  })();

  const activeGhostLine = (() => {
    if (activeIdx == null || state.status !== "success" || state.validation == null) return null;
    const err = state.validation.errors[activeIdx];
    if (err == null || !isMissingError(err) || err.line == null) return null;
    return Math.max(1, err.line - 1);
  })();

  const handleLineClick = (line: number) => {
    if (state.status !== "success" || state.validation == null) return;
    const idx = state.validation.errors.findIndex((e) => e.line === line && !isMissingError(e));
    if (idx !== -1) setActiveIdx(idx);
  };

  const handleGhostClick = (insertAfterLine: number) => {
    const entry = ghostRows?.get(insertAfterLine);
    if (entry == null) return;
    setActiveIdx(entry.idx === activeIdx ? null : entry.idx);
  };

  return (
    <>
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

          <div style={{
            display: "grid",
            gridTemplateColumns: state.validation != null || state.validating ? "1fr 320px" : "1fr",
            gap: "1.25rem",
            alignItems: "start",
          }}>
            <XmlPanel
              label="attachment"
              content={state.result.attachment}
              errorLines={errorLines}
              ghostRows={ghostRows}
              activeErrorLine={activeErrorLine}
              activeGhostLine={activeGhostLine}
              onLineClick={handleLineClick}
              onGhostClick={handleGhostClick}
            />

            {(state.validation != null || state.validating) && (
              <ValidationPanel
                response={state.validation}
                validating={state.validating}
                activeIdx={activeIdx}
                onActivate={(idx) => setActiveIdx(idx === activeIdx ? null : idx)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
