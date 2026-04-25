import { useState, useMemo, useRef, useEffect } from "react";
import type { ValidationError } from "../api";
import { extractMissingName } from "../utils/validation";

interface GhostEntry {
  err: ValidationError;
  idx: number;
}

interface XmlPanelProps {
  label: string;
  content: string;
  errorLines?: Map<number, ValidationError>;
  ghostRows?: Map<number, GhostEntry>;  // insertAfterLine → { err, idx }
  activeErrorLine?: number | null;
  activeGhostLine?: number | null;      // insertAfterLine of the active ghost row
  onLineClick?: (line: number) => void;
  onGhostClick?: (insertAfterLine: number) => void;
}

type CopyState = "idle" | "copied" | "error";

// ── Lightweight XML syntax tokeniser ────────────────────────────────────────

type TokenKind =
  | "decl"       // <?xml ... ?>
  | "comment"    // <!-- ... -->
  | "tag-open"   // < or </ or >  or />
  | "tag-name"   // element name
  | "attr-name"  // attribute name
  | "attr-eq"    // =
  | "attr-val"   // "..." value
  | "text"       // text content
  | "cdata"      // <![CDATA[ ... ]]>
  | "plain";     // fallback

interface Token {
  kind: TokenKind;
  value: string;
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  function push(kind: TokenKind, value: string) {
    if (value) tokens.push({ kind, value });
  }

  while (i < xml.length) {
    // XML declaration  <?xml ... ?>
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end === -1) { push("decl", xml.slice(i)); i = xml.length; continue; }
      push("decl", xml.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    // Comment  <!-- ... -->
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) { push("comment", xml.slice(i)); i = xml.length; continue; }
      push("comment", xml.slice(i, end + 3));
      i = end + 3;
      continue;
    }

    // CDATA  <![CDATA[ ... ]]>
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end === -1) { push("cdata", xml.slice(i)); i = xml.length; continue; }
      push("cdata", xml.slice(i, end + 3));
      i = end + 3;
      continue;
    }

    // Opening/closing tag  < ... >
    if (xml[i] === "<") {
      let j = i + 1;
      while (j < xml.length && xml[j] !== ">") {
        if (xml[j] === '"') {
          j++;
          while (j < xml.length && xml[j] !== '"') j++;
          if (j < xml.length) j++;
        } else if (xml[j] === "'") {
          j++;
          while (j < xml.length && xml[j] !== "'") j++;
          if (j < xml.length) j++;
        } else {
          j++;
        }
      }
      const raw = xml.slice(i, j + 1);
      i = j + 1;
      tokenizeTag(raw, tokens);
      continue;
    }

    // Text content — gather until next <
    const nextTag = xml.indexOf("<", i);
    const end = nextTag === -1 ? xml.length : nextTag;
    push("text", xml.slice(i, end));
    i = end;
  }

  return tokens;
}

function tokenizeTag(raw: string, out: Token[]) {
  const isClose = raw.startsWith("</");
  const selfClose = raw.endsWith("/>");

  function push(kind: TokenKind, value: string) {
    if (value) out.push({ kind, value });
  }

  push("tag-open", isClose ? "</" : "<");

  let inner = raw.slice(isClose ? 2 : 1, selfClose ? raw.length - 2 : raw.length - 1);

  const nameMatch = inner.match(/^[^\s/>=]+/);
  if (!nameMatch) {
    push("tag-open", inner + (selfClose ? "/>" : ">"));
    return;
  }
  push("tag-name", nameMatch[0]);
  inner = inner.slice(nameMatch[0].length);

  let k = 0;
  while (k < inner.length) {
    const wsMatch = inner.slice(k).match(/^\s+/);
    if (wsMatch) { push("text", wsMatch[0]); k += wsMatch[0].length; continue; }

    const attrMatch = inner.slice(k).match(/^[^\s=/>]+/);
    if (!attrMatch) { k++; continue; }
    push("attr-name", attrMatch[0]);
    k += attrMatch[0].length;

    const ws2 = inner.slice(k).match(/^\s*/);
    if (ws2?.[0]) { push("text", ws2[0]); k += ws2[0].length; }

    if (inner[k] === "=") {
      push("attr-eq", "=");
      k++;

      const ws3 = inner.slice(k).match(/^\s*/);
      if (ws3?.[0]) { push("text", ws3[0]); k += ws3[0].length; }

      const q = inner[k];
      if (q === '"' || q === "'") {
        const valEnd = inner.indexOf(q, k + 1);
        if (valEnd !== -1) {
          push("attr-val", inner.slice(k, valEnd + 1));
          k = valEnd + 1;
        } else {
          push("attr-val", inner.slice(k));
          k = inner.length;
        }
      }
    }
  }

  push("tag-open", selfClose ? "/>" : ">");
}

// ── Colour map ───────────────────────────────────────────────────────────────

const TOKEN_COLORS: Record<TokenKind, string> = {
  decl:       "#6b7491",
  comment:    "#4a5068",
  "tag-open": "#79b8ff",
  "tag-name": "#79b8ff",
  "attr-name":"#ffcf6b",
  "attr-eq":  "#c8cfdf",
  "attr-val": "#9ecbff",
  text:       "#c8cfdf",
  cdata:      "#6b7491",
  plain:      "#c8cfdf",
};

function HighlightedLine({ line }: { line: string }) {
  const tokens = useMemo(() => tokenize(line), [line]);

  return (
    <>
      {tokens.map((tok, i) => (
        <span key={i} style={{ color: TOKEN_COLORS[tok.kind] }}>
          {tok.value}
        </span>
      ))}
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ── Inline error icon with hover tooltip ────────────────────────────────────

function ErrorIcon({ err }: { err: ValidationError }) {
  const isWarn = err.level.toLowerCase() === "warning";
  const color = isWarn ? "var(--warn)" : "var(--err)";
  const msg = err.message != null ? truncate(err.message, 80) : err.level;

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      marginLeft: "0.5rem",
      cursor: "pointer",
      position: "relative",
      verticalAlign: "middle",
    }}
      className="err-icon-wrap"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: "block", flexShrink: 0 }}>
        <circle cx="7" cy="7" r="6.5" stroke={color} />
        <line x1="7" y1="4" x2="7" y2="8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.75" fill={color} />
      </svg>
      <span style={{
        display: "none",
        position: "absolute",
        left: "1.5rem",
        top: "-0.25rem",
        background: "#1c1f2e",
        border: `1px solid ${color}`,
        borderRadius: "6px",
        padding: "0.45rem 0.75rem",
        fontSize: "0.72rem",
        whiteSpace: "nowrap",
        color: isWarn ? "#ffe0b0" : "#ffd0d8",
        zIndex: 10,
        pointerEvents: "none",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        fontFamily: "'JetBrains Mono', monospace",
      }}
        className="err-tooltip"
      >
        {msg}
      </span>
    </span>
  );
}

// ── Ghost row ────────────────────────────────────────────────────────────────

interface GhostRowProps {
  err: ValidationError;
  indent: string;
  isActive: boolean;
  insertAfterLine: number;
  onGhostClick?: (insertAfterLine: number) => void;
}

function GhostRow({ err, indent, isActive, insertAfterLine, onGhostClick }: GhostRowProps) {
  const missingName = extractMissingName(err);
  const label = missingName ?? "…";
  const isAttr = label.startsWith("@");

  const ghostText = isAttr
    ? `${indent}${label}="…"`
    : `${indent}<${label}>…</${label}>`;

  return (
    <div
      data-ghost-after={insertAfterLine}
      role="button"
      tabIndex={0}
      onClick={() => onGhostClick?.(insertAfterLine)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGhostClick?.(insertAfterLine); } }}
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: "1.6rem",
        paddingLeft: "calc(1.25rem - 2px)",
        paddingRight: "1.25rem",
        borderLeft: isActive ? "2px dashed var(--accent)" : "2px dashed var(--err)",
        background: isActive
          ? "rgba(232,255,90,0.06)"
          : "repeating-linear-gradient(-45deg, rgba(255,77,109,0.04), rgba(255,77,109,0.04) 4px, transparent 4px, transparent 10px)",
        cursor: "pointer",
        transition: "background 0.15s",
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.8rem",
        color: isActive ? "rgba(232,255,90,0.7)" : "rgba(255,77,109,0.55)",
        fontStyle: "italic",
        flex: 1,
        whiteSpace: "pre",
      }}>
        {ghostText}
      </span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.6rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--err)",
        background: "rgba(255,77,109,0.12)",
        border: "1px dashed rgba(255,77,109,0.35)",
        padding: "1px 6px",
        borderRadius: "3px",
        marginLeft: "0.75rem",
        flexShrink: 0,
      }}>
        missing
      </span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function XmlPanel({ label, content, errorLines, ghostRows, activeErrorLine, activeGhostLine, onLineClick, onGhostClick }: XmlPanelProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const codeRef = useRef<HTMLPreElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

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

  const ghostCount = ghostRows?.size ?? 0;
  const hasErrors = (errorLines != null && errorLines.size > 0) || ghostCount > 0;
  const errorCount = (errorLines != null ? [...errorLines.values()].filter((e) => e.level.toLowerCase() === "error").length : 0) + ghostCount;
  const warnCount = errorLines != null ? [...errorLines.values()].filter((e) => e.level.toLowerCase() === "warning").length : 0;
  const allValid = errorLines != null && errorLines.size === 0 && ghostCount === 0;

  // Sync scroll between line numbers and code pane
  const handleCodeScroll = () => {
    if (codeRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = codeRef.current.scrollTop;
    }
  };

  // Scroll active line or ghost into view
  useEffect(() => {
    if (!codeRef.current) return;
    if (activeErrorLine != null) {
      const lineEl = codeRef.current.querySelector(`[data-line="${activeErrorLine}"]`);
      if (lineEl) lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (activeGhostLine != null) {
      const ghostEl = codeRef.current.querySelector(`[data-ghost-after="${activeGhostLine}"]`);
      if (ghostEl) ghostEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeErrorLine, activeGhostLine]);

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
        maxHeight: "75vh",
        overflow: "hidden",
        background: "rgba(0,0,0,0.2)",
      }}>
        {/* Line numbers column */}
        <div
          ref={lineNumRef}
          style={{
            padding: "1rem 0.75rem 1rem 1rem",
            userSelect: "none",
            textAlign: "right",
            minWidth: "3rem",
            borderRight: "1px solid var(--border)",
            background: "rgba(0,0,0,0.15)",
            flexShrink: 0,
            overflowY: "hidden",
          }}
        >
          {lines.map((_, i) => {
            const lineNum = i + 1;
            const err = errorLines?.get(lineNum);
            const isErr = err && err.level.toLowerCase() === "error";
            const isWarn = err && err.level.toLowerCase() === "warning";
            const isActive = activeErrorLine === lineNum;
            const hasGhost = ghostRows?.has(lineNum);
            const isGhostActive = activeGhostLine === lineNum;
            return (
              <span key={i}>
                <span
                  style={{
                    display: "block",
                    height: "1.6rem",
                    color: isActive
                      ? "var(--accent)"
                      : isErr
                        ? "var(--err)"
                        : isWarn
                          ? "var(--warn)"
                          : "var(--muted)",
                    transition: "color 0.15s",
                    cursor: err ? "pointer" : "default",
                  }}
                  onClick={() => { if (err) onLineClick?.(lineNum); }}
                >
                  {lineNum}
                </span>
                {hasGhost && (
                  <span
                    style={{
                      display: "block",
                      height: "1.6rem",
                      color: isGhostActive ? "var(--accent)" : "rgba(255,77,109,0.4)",
                      fontStyle: "italic",
                      fontSize: "0.7rem",
                      cursor: "pointer",
                      transition: "color 0.15s",
                    }}
                    onClick={() => onGhostClick?.(lineNum)}
                  >
                    ?
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {/* Highlighted code */}
        <pre
          ref={codeRef}
          onScroll={handleCodeScroll}
          style={{
            margin: 0,
            padding: "1rem 0",
            flex: 1,
            overflowX: "auto",
            overflowY: "auto",
            whiteSpace: "pre",
          }}
        >
          <code>
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const err = errorLines?.get(lineNum);
              const isErr = err && err.level.toLowerCase() === "error";
              const isWarn = err && err.level.toLowerCase() === "warning";
              const isActive = activeErrorLine === lineNum;
              const ghostEntry = ghostRows?.get(lineNum);
              const hasGhost = ghostEntry != null;
              const isGhostActive = activeGhostLine === lineNum;

              let bg = "transparent";
              let borderLeft = "2px solid transparent";
              let paddingLeft = "1.25rem";

              if (isActive) {
                bg = "rgba(232,255,90,0.06)";
                borderLeft = "2px solid var(--accent)";
                paddingLeft = "calc(1.25rem - 2px)";
              } else if (isErr) {
                bg = "rgba(255,77,109,0.10)";
                borderLeft = "2px solid var(--err)";
                paddingLeft = "calc(1.25rem - 2px)";
              } else if (isWarn) {
                bg = "rgba(255,179,71,0.08)";
                borderLeft = "2px solid var(--warn)";
                paddingLeft = "calc(1.25rem - 2px)";
              }

              // Derive the indent of the current line (used for ghost placeholder text)
              const lineIndent = line.match(/^(\s*)/)?.[1] ?? "";

              return (
                <span key={i}>
                  <div
                    data-line={lineNum}
                    onClick={() => { if (err) onLineClick?.(lineNum); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: "1.6rem",
                      paddingLeft,
                      paddingRight: "1.25rem",
                      background: bg,
                      borderLeft,
                      cursor: err ? "pointer" : "default",
                      transition: "background 0.15s",
                      boxSizing: "border-box",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <HighlightedLine line={line} />
                    </span>
                    {err && <ErrorIcon err={err} />}
                  </div>

                  {/* Ghost row inserted after this line */}
                  {hasGhost && ghostEntry && (
                    <GhostRow
                      err={ghostEntry.err}
                      indent={lineIndent + "  "}
                      isActive={isGhostActive}
                      insertAfterLine={lineNum}
                      onGhostClick={onGhostClick}
                    />
                  )}
                </span>
              );
            })}
          </code>
        </pre>
      </div>

      {/* Status bar — only shown when errorLines is provided */}
      {errorLines != null && (
        <div style={{
          padding: "0.6rem 1rem",
          borderTop: "1px solid var(--border)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.68rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          color: "var(--text-dim)",
        }}>
          {allValid ? (
            <>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "var(--ok)",
                boxShadow: "0 0 8px var(--ok)",
                display: "inline-block",
              }} />
              schema valid
            </>
          ) : (
            <>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "var(--err)",
                boxShadow: "0 0 8px var(--err)",
                display: "inline-block",
              }} />
              {hasErrors
                ? `validation failed · ${errorCount} error${errorCount !== 1 ? "s" : ""}${warnCount > 0 ? ` · ${warnCount} warning${warnCount !== 1 ? "s" : ""}` : ""}`
                : `${warnCount} warning${warnCount !== 1 ? "s" : ""}`
              }
            </>
          )}
        </div>
      )}

      {/* Tooltip hover CSS */}
      <style>{`
        .err-icon-wrap:hover .err-tooltip { display: block !important; }
      `}</style>
    </section>
  );
}
