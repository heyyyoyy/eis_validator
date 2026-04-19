import { useRef, useState, useCallback } from "react";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({ onFileSelect, disabled = false }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".xml") && file.type !== "text/xml" && file.type !== "application/xml") {
        setValidationError("Only .xml files are accepted.");
        setSelected(null);
        return;
      }
      setValidationError(null);
      setSelected(file);
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!disabled && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const borderColor = dragOver ? "var(--accent)" : selected ? "rgba(232,255,90,0.3)" : "var(--border)";
  const bgColor = dragOver ? "rgba(232,255,90,0.04)" : "rgba(0,0,0,0.15)";

  return (
    <div style={{ width: "100%" }}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload EIS package XML file"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "2rem 1.5rem",
          border: `1px dashed ${borderColor}`,
          borderRadius: "8px",
          background: bgColor,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          transition: "border-color 0.15s, background 0.15s",
          textAlign: "center",
          outline: "none",
        }}
      >
        {/* Upload icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: 32, height: 32, color: dragOver ? "var(--accent)" : "var(--muted)", transition: "color 0.15s" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>

        {selected ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem", color: "var(--accent)", fontWeight: 500 }}>
              {selected.name}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "var(--text-dim)" }}>
              {formatBytes(selected.size)}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
              click or drag to replace
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "0.9rem", fontWeight: 600, color: "var(--text)" }}>
              Drop your EIS package here
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "var(--text-dim)" }}>
              or{" "}
              <span style={{ color: "var(--accent)", textDecoration: "underline" }}>browse</span>
              {" "}— .xml files only
            </span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          tabIndex={-1}
          onChange={handleChange}
          disabled={disabled}
        />
      </div>

      {validationError && (
        <p role="alert" style={{
          marginTop: "0.5rem",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.72rem",
          color: "var(--err)",
        }}>
          {validationError}
        </p>
      )}
    </div>
  );
}
