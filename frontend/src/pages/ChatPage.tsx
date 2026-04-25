import { useEffect, useRef, useState } from "react";
import { streamQuery } from "../api";
import { ChatMessage, type Message } from "../components/ChatMessage";

let nextId = 1;
function uid() {
  return String(nextId++);
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handleSubmit = () => {
    const query = input.trim();
    if (!query || streaming) return;

    const userMsg: Message = { id: uid(), role: "user", content: query };
    const assistantId = uid();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    abortRef.current = streamQuery(query, {
      onChunk(text) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + text } : m,
          ),
        );
      },
      onDone() {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
        setStreaming(false);
      },
      onError(errMsg) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, streaming: false, error: errMsg }
              : m,
          ),
        );
        setStreaming(false);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    );
    setStreaming(false);
  };

  const canSend = input.trim().length > 0 && !streaming;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 8rem)",
        minHeight: "400px",
      }}
    >
      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1.25rem 0",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.75rem",
              color: "var(--text-dim)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem",
              textAlign: "center",
              paddingTop: "3rem",
            }}
          >
            <svg
              style={{ width: 36, height: 36, color: "var(--border)" }}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
              />
            </svg>
            <p>Ask a question about the EIS documents</p>
            <p style={{ fontSize: "0.65rem", color: "var(--muted)" }}>
              Shift+Enter for a new line · Enter to send
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          overflow: "hidden",
          marginTop: "0.75rem",
          flexShrink: 0,
        }}
      >
        <div
          style={{
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
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: streaming ? "var(--accent)" : "var(--muted)",
              display: "inline-block",
              transition: "background 0.2s",
              boxShadow: streaming ? "0 0 6px var(--accent)" : "none",
            }}
          />
          {streaming ? "streaming…" : "query"}
        </div>

        <div style={{ padding: "0.75rem 1rem 1rem" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about EIS packages, validation rules, document structure…"
            disabled={streaming}
            rows={1}
            style={{
              width: "100%",
              resize: "none",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "'Syne', sans-serif",
              fontSize: "0.9rem",
              lineHeight: 1.6,
              caretColor: "var(--accent)",
              overflow: "hidden",
              minHeight: "1.5rem",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              marginTop: "0.75rem",
              gap: "0.5rem",
            }}
          >
            {streaming && (
              <button
                type="button"
                onClick={handleAbort}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "0.5rem 1rem",
                  borderRadius: "5px",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--text-dim)",
                }}
              >
                Stop
              </button>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSend}
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
                cursor: canSend ? "pointer" : "not-allowed",
                background: canSend ? "var(--accent)" : "var(--border)",
                color: canSend ? "#0d0f14" : "var(--muted)",
                transition: "opacity 0.15s",
                opacity: canSend ? 1 : 0.6,
              }}
            >
              {streaming ? (
                <>
                  <svg
                    style={{ width: 14, height: 14, animation: "spin 0.8s linear infinite" }}
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending…
                </>
              ) : (
                <>
                  <svg
                    style={{ width: 14, height: 14 }}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
