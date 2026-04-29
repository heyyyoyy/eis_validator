import { useState } from "react";
import { ChatPage } from "./pages/ChatPage";
import { ValidatorPage } from "./pages/ValidatorPage";

type Tab = "chat" | "validator";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "validator", label: "Validator" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  return (
    <div style={{ minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "1.6rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}>
            EIS Assistant
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

        {/* Tab bar */}
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: "0",
            borderBottom: "1px solid var(--border)",
            marginBottom: "1.75rem",
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "0.6rem 1.25rem",
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  color: isActive ? "var(--accent)" : "var(--text-dim)",
                  cursor: "pointer",
                  marginBottom: "-1px",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Page content */}
        {activeTab === "chat" && <ChatPage />}
        {activeTab === "validator" && <ValidatorPage />}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes errFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
