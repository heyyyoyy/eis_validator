export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  error?: string;
}

interface ChatMessageProps {
  message: Message;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text: string): string {
  // Apply inline formatting after HTML-escaping.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong style=\"font-weight:800;\">$1</strong>")
    .replace(/_(.+?)_/g, "<em style=\"font-style:italic;\">$1</em>")
    .replace(/\*(.+?)\*/g, "<em style=\"font-style:italic;\">$1</em>")
    .replace(
      /`(.+?)`/g,
      "<code style=\"font-family:'JetBrains Mono',monospace;font-size:0.75rem;background:rgba(255,255,255,0.06);padding:0.05rem 0.3rem;border-radius:4px;\">$1</code>",
    );
}

function renderMarkdownHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let currentListItemLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p style="margin:0 0 0.55rem;">${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushListItem = () => {
    if (currentListItemLines.length === 0) return;
    const html = currentListItemLines
      .map((line) => renderInlineMarkdown(line))
      .join("<br />");
    listItems.push(`<li style="margin-bottom:0.35rem;">${html}</li>`);
    currentListItemLines = [];
  };

  const flushList = () => {
    flushListItem();
    if (listItems.length === 0) return;
    const tag = listType ?? "ul";
    const padding = tag === "ol" ? "1.25rem" : "1rem";
    blocks.push(
      `<${tag} style="margin:0 0 0.55rem;padding-left:${padding};">${listItems.join("")}</${tag}>`,
    );
    listItems = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const style = "margin:0 0 0.5rem;line-height:1.35;";
      const size =
        level === 1 ? "font-size:1.05rem;" : level === 2 ? "font-size:0.98rem;" : "font-size:0.92rem;";
      blocks.push(`<h${level} style="${style}${size}">${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = rawLine.match(/^\s*[-*]\s+(.+)$/);
    const orderedMatch = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
    const nextListType = bulletMatch ? "ul" : orderedMatch ? "ol" : null;
    const listContent = bulletMatch?.[1] ?? orderedMatch?.[1] ?? null;
    if (nextListType && listContent) {
      flushParagraph();
      if (listType && listType !== nextListType) {
        flushList();
      }
      if (!listType) {
        listType = nextListType;
      }
      flushListItem();
      currentListItemLines.push(listContent.trim());
      continue;
    }

    if (currentListItemLines.length > 0 && /^\s+/.test(rawLine)) {
      currentListItemLines.push(line.trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushList();
  flushParagraph();
  return blocks.join("");
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "0.35rem",
      }}
    >
      {/* Role label */}
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.6rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: isUser ? "var(--accent)" : "var(--text-dim)",
          paddingInline: "0.25rem",
        }}
      >
        {isUser ? "you" : "EIS Assistant"}
      </span>

      {/* Bubble */}
      <div
        style={{
          maxWidth: "78%",
          padding: "0.7rem 1rem",
          borderRadius: isUser ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
          background: isUser ? "rgba(232,255,90,0.08)" : "var(--surface)",
          border: `1px solid ${isUser ? "rgba(232,255,90,0.2)" : "var(--border)"}`,
          fontFamily: isUser ? "'Syne', sans-serif" : "'JetBrains Mono', monospace",
          fontSize: isUser ? "0.9rem" : "0.82rem",
          lineHeight: 1.65,
          color: "var(--text)",
          wordBreak: "break-word",
        }}
      >
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
        ) : (
          <div
            style={{
              whiteSpace: "normal",
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(message.content) }}
          />
        )}
        {message.streaming && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: "2px",
              height: "0.85em",
              background: "var(--accent)",
              marginLeft: "2px",
              verticalAlign: "text-bottom",
              animation: "blink 0.9s step-end infinite",
            }}
          />
        )}
      </div>

      {/* Inline error */}
      {message.error && (
        <div
          role="alert"
          style={{
            maxWidth: "78%",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            padding: "0.55rem 0.85rem",
            background: "rgba(255,77,109,0.06)",
            border: "1px solid rgba(255,77,109,0.25)",
            borderRadius: "6px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.7rem",
            color: "var(--err)",
            lineHeight: 1.5,
          }}
        >
          <svg
            style={{ width: 12, height: 12, marginTop: 2, flexShrink: 0 }}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
              clipRule="evenodd"
            />
          </svg>
          {message.error}
        </div>
      )}
    </div>
  );
}
