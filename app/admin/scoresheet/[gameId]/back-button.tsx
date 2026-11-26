"use client"

export function BackButton() {
  return (
    <div className="no-print" style={{ marginBottom: "8px" }}>
      <button type="button"
        onClick={() => {
          window.close()
          // Fallback if window.close() is blocked (not opened by script)
          setTimeout(() => history.back(), 100)
        }}
        style={{
          padding: "4px 12px",
          fontSize: "12px",
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "4px",
          background: "#f9f9f9",
        }}
      >
        ← Close
      </button>
    </div>
  )
}
