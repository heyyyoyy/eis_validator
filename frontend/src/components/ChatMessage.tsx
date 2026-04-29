
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p style={{ margin: "0 0 0.55rem" }}>{children}</p>,
              h1: ({ children }) => <h1 style={{ margin: "0 0 0.5rem", lineHeight: 1.35, fontSize: "1.05rem" }}>{children}</h1>,
              h2: ({ children }) => <h2 style={{ margin: "0 0 0.5rem", lineHeight: 1.35, fontSize: "0.98rem" }}>{children}</h2>,
              h3: ({ children }) => <h3 style={{ margin: "0 0 0.5rem", lineHeight: 1.35, fontSize: "0.92rem" }}>{children}</h3>,
              h4: ({ children }) => <h4 style={{ margin: "0 0 0.5rem", lineHeight: 1.35, fontSize: "0.92rem" }}>{children}</h4>,
              ul: ({ children }) => <ul style={{ margin: "0 0 0.55rem", paddingLeft: "1rem" }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ margin: "0 0 0.55rem", paddingLeft: "1.25rem" }}>{children}</ol>,
              li: ({ children }) => <li style={{ marginBottom: "0.35rem" }}>{children}</li>,
              code: ({ children }) => (
                <code
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.75rem",
                    background: "rgba(255,255,255,0.06)",
                    padding: "0.05rem 0.3rem",
                    borderRadius: 4,
                  }}
                >
                  {children}
                </code>
              ),
              table: ({ children }) => (
                <div style={{ overflow: "auto", margin: "0 0 0.55rem" }}>
                  <table
                    style={{
                      borderCollapse: "collapse",
                      width: "100%",
                      fontSize: "0.78rem",
                      lineHeight: 1.45,
                    }}
                  >
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th style={{ textAlign: "left", border: "1px solid var(--border)", padding: "0.35rem 0.5rem" }}>{children}</th>
              ),
              td: ({ children }) => (
                <td style={{ border: "1px solid var(--border)", padding: "0.35rem 0.5rem", verticalAlign: "top" }}>{children}</td>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
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
