import { useState, useMemo } from "react";

interface XmlPanelProps {
  label: string;
  content: string;
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
      // find matching >
      let j = i + 1;
      // skip past any quoted strings inside the tag
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
      const raw = xml.slice(i, j + 1); // includes >
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
  // self-close or close bracket characters
  const isClose = raw.startsWith("</");
  const selfClose = raw.endsWith("/>");

  function push(kind: TokenKind, value: string) {
    if (value) out.push({ kind, value });
  }

  // opening <  or  </
  push("tag-open", isClose ? "</" : "<");

  // strip < </ > />
  let inner = raw.slice(isClose ? 2 : 1, selfClose ? raw.length - 2 : raw.length - 1);

  // tag name (first token before whitespace or /)
  const nameMatch = inner.match(/^[^\s/>=]+/);
  if (!nameMatch) {
    push("tag-open", inner + (selfClose ? "/>" : ">"));
    return;
  }
  push("tag-name", nameMatch[0]);
  inner = inner.slice(nameMatch[0].length);

  // attributes
  let k = 0;
  while (k < inner.length) {
    // skip whitespace
    const wsMatch = inner.slice(k).match(/^\s+/);
    if (wsMatch) { push("text", wsMatch[0]); k += wsMatch[0].length; continue; }

    // attr-name
    const attrMatch = inner.slice(k).match(/^[^\s=/>]+/);
    if (!attrMatch) { k++; continue; }
    push("attr-name", attrMatch[0]);
    k += attrMatch[0].length;

    // skip whitespace
    const ws2 = inner.slice(k).match(/^\s*/);
    if (ws2?.[0]) { push("text", ws2[0]); k += ws2[0].length; }

    // =
    if (inner[k] === "=") {
      push("attr-eq", "=");
      k++;

      // skip whitespace
      const ws3 = inner.slice(k).match(/^\s*/);
      if (ws3?.[0]) { push("text", ws3[0]); k += ws3[0].length; }

      // quoted value
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
  decl:      "#6b7491",   // var(--text-dim) — muted declaration
  comment:   "#4a5068",   // var(--muted)
  "tag-open":"#79b8ff",   // bracket / slash in blue
  "tag-name":"#79b8ff",   // element name in blue
  "attr-name":"#ffcf6b",  // attribute name in warm yellow
  "attr-eq": "#c8cfdf",   // = in default text
  "attr-val":"#9ecbff",   // attribute value in light blue
  text:      "#c8cfdf",   // var(--text)
  cdata:     "#6b7491",
  plain:     "#c8cfdf",
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

// ── Component ────────────────────────────────────────────────────────────────

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

        {/* Highlighted code */}
        <pre style={{
          margin: 0,
          padding: "1rem 1.25rem",
          flex: 1,
          overflowX: "auto",
          overflowY: "auto",
          whiteSpace: "pre",
        }}>
          <code>
            {lines.map((line, i) => (
              <div key={i} style={{ minHeight: "1.6rem" }}>
                <HighlightedLine line={line} />
              </div>
            ))}
          </code>
        </pre>
      </div>
    </section>
  );
}
