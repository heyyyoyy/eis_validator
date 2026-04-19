interface LoadingBannerProps {
  type: "loading";
}

interface ErrorBannerProps {
  type: "error";
  message: string;
}

type StatusBannerProps = LoadingBannerProps | ErrorBannerProps;

export function StatusBanner(props: StatusBannerProps) {
  if (props.type === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.72rem",
          color: "var(--text-dim)",
        }}
      >
        <svg
          style={{ width: 14, height: 14, animation: "spin 0.8s linear infinite", flexShrink: 0, color: "var(--accent)" }}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path style={{ opacity: 0.9 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>parsing package…</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        background: "rgba(255,77,109,0.06)",
        border: "1px solid rgba(255,77,109,0.25)",
        borderRadius: "8px",
      }}
    >
      <svg
        style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0, color: "var(--err)" }}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--err)",
          marginBottom: "0.2rem",
        }}>
          parse failed
        </p>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.72rem",
          color: "var(--text-dim)",
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}>
          {props.message}
        </p>
      </div>
    </div>
  );
}
