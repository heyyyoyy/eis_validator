import type { ValidationError, ValidationResponse } from "../api";

interface ValidationPanelProps {
  response: ValidationResponse | null;
  validating: boolean;
  activeIdx: number | null;
  onActivate: (idx: number) => void;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function ValidationPanel({ response, validating, activeIdx, onActivate }: ValidationPanelProps) {
  const errors = response?.errors ?? [];
  const errorCount = errors.filter((e) => e.level.toLowerCase() === "error").length;
  const warnCount = errors.filter((e) => e.level.toLowerCase() === "warning").length;
  const isValid = response?.valid ?? false;

  return (
    <section style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
    }}>
      {/* Panel title bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}>
          errors
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
        {validating && !response && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.75rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.72rem",
            color: "var(--text-dim)",
          }}>
            <svg
              style={{ width: 13, height: 13, animation: "spin 0.8s linear infinite", flexShrink: 0, color: "var(--accent)" }}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path style={{ opacity: 0.9 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            validating…
          </div>
        )}

        {response && errors.length === 0 && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.75rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.72rem",
            color: "var(--ok)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: "var(--ok)",
              boxShadow: "0 0 8px var(--ok)",
              display: "inline-block",
              flexShrink: 0,
            }} />
            schema valid — no errors
          </div>
        )}

        {errors.map((err, i) => {
          const isError = err.level.toLowerCase() === "error";
          const isActive = i === activeIdx;

          return (
            <ErrorItem
              key={i}
              err={err}
              idx={i}
              isError={isError}
              isActive={isActive}
              onActivate={onActivate}
            />
          );
        })}
      </div>

      {/* Summary bar */}
      {response && (
        <div style={{
          padding: "0.75rem 1rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: "1rem",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.7rem",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontWeight: 700, color: errorCount > 0 ? "var(--err)" : "var(--text-dim)" }}>
              {errorCount}
            </span>
            <span style={{ color: "var(--text-dim)" }}>errors</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ fontWeight: 700, color: warnCount > 0 ? "var(--warn)" : "var(--text-dim)" }}>
              {warnCount}
            </span>
            <span style={{ color: "var(--text-dim)" }}>warnings</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontWeight: 700, color: isValid ? "var(--ok)" : "var(--err)" }}>
              {isValid ? "✓" : "✗"}
            </span>
            <span style={{ color: "var(--text-dim)" }}>{isValid ? "valid" : "invalid"}</span>
          </div>
        </div>
      )}
    </section>
  );
}

interface ErrorItemProps {
  err: ValidationError;
  idx: number;
  isError: boolean;
  isActive: boolean;
  onActivate: (idx: number) => void;
}

function ErrorItem({ err, idx, isError, isActive, onActivate }: ErrorItemProps) {
  const levelColor = isError ? "var(--err)" : "var(--warn)";
  const levelBg = isError ? "rgba(255,77,109,0.15)" : "rgba(255,179,71,0.15)";
  const dotShadow = isError ? "0 0 6px var(--err)" : "0 0 6px var(--warn)";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onActivate(idx)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(idx); } }}
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.7rem 0.75rem",
        borderRadius: "6px",
        cursor: "pointer",
        border: `1px solid ${isActive ? "rgba(232,255,90,0.2)" : "transparent"}`,
        background: isActive ? "rgba(232,255,90,0.05)" : "transparent",
        marginBottom: "0.25rem",
        transition: "background 0.12s, border-color 0.12s",
        animationDelay: `${Math.min(idx, 4) * 0.05}s`,
        animationFillMode: "both",
        animation: "errFadeIn 0.25s ease both",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
          (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
        }
      }}
    >
      {/* Level dot */}
      <span style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: levelColor,
        boxShadow: dotShadow,
        flexShrink: 0,
        marginTop: 5,
      }} />

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.65rem",
          color: "var(--text-dim)",
          marginBottom: "0.2rem",
        }}>
          {err.line != null
            ? <>line <span style={{ color: "var(--accent)" }}>{err.line}</span>{err.column != null ? <> · col <span style={{ color: "var(--accent)" }}>{err.column}</span></> : null}</>
            : "unknown location"
          }
        </div>
        <div style={{
          fontSize: "0.75rem",
          color: "var(--text)",
          lineHeight: 1.4,
          wordBreak: "break-word",
        }}>
          {err.message != null ? truncate(err.message, 160) : "—"}
        </div>
      </div>

      {/* Level badge */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.6rem",
        padding: "1px 6px",
        borderRadius: "3px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        alignSelf: "flex-start",
        flexShrink: 0,
        background: levelBg,
        color: levelColor,
      }}>
        {err.level}
      </span>
    </div>
  );
}
