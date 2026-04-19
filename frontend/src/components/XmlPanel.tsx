import { useState } from "react";

interface XmlPanelProps {
  label: string;
  content: string;
}

type CopyState = "idle" | "copied" | "error";

export function XmlPanel({ label, content }: XmlPanelProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  const lines = content.split("\n");

  return (
    <section style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      overflow: "hidden",
    }}>
      {/* Panel title bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", display: "inline-block" }} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
          }}>
            {label}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem",
            color: "var(--text-dim)",
          }}>
            {lines.length} lines
          </span>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: "3px",
              border: "none",
              cursor: "pointer",
              background: copyState === "copied"
                ? "rgba(77,255,180,0.15)"
                : copyState === "error"
                  ? "rgba(255,77,109,0.15)"
                  : "rgba(255,255,255,0.05)",
              color: copyState === "copied"
                ? "var(--ok)"
                : copyState === "error"
                  ? "var(--err)"
                  : "var(--text-dim)",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {copyState === "copied" ? (
              <>
                <svg style={{ width: 11, height: 11 }} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
                Copied
              </>
            ) : copyState === "error" ? (
              "Failed"
            ) : (
              <>
                <svg style={{ width: 11, height: 11 }} viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                  <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code viewer with line numbers */}
      <div style={{
        display: "flex",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.8rem",
        lineHeight: "1.6rem",
        maxHeight: "50vh",
        overflow: "hidden",
        background: "rgba(0,0,0,0.2)",
      }}>
        {/* Line numbers column */}
        <div style={{
          padding: "1rem 0.75rem 1rem 1rem",
          color: "var(--muted)",
          userSelect: "none",
          textAlign: "right",
          minWidth: "3rem",
          borderRight: "1px solid var(--border)",
          background: "rgba(0,0,0,0.15)",
          flexShrink: 0,
          overflowY: "hidden",
        }}>
          {lines.map((_, i) => (
            <span key={i} style={{ display: "block", height: "1.6rem" }}>
              {i + 1}
            </span>
          ))}
        </div>

        {/* Code content */}
        <pre style={{
          margin: 0,
          padding: "1rem 1.25rem",
          flex: 1,
          overflowX: "auto",
          overflowY: "auto",
          color: "var(--text)",
          whiteSpace: "pre",
        }}>
          <code>{content}</code>
        </pre>
      </div>
    </section>
  );
}
