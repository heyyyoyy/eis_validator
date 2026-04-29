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
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.content}
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
