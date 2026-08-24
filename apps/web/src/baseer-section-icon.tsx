export type SectionGlyph = "dashboard" | "target" | "bell" | "activity" | "trend" | "cart" | "truck" | "boxes" | "clipboard" | "receipt" | "bank" | "wallet" | "ledger" | "users" | "calendar" | "hand" | "badge" | "chart" | "tax" | "print" | "building" | "shield" | "palette" | "backup" | "mail";

export function BaseerSectionIcon({ glyph }: { glyph: SectionGlyph }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (glyph === "dashboard") return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  if (glyph === "mail") return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6M5 17l4.5-4M19 17l-4.5-4" /></svg>;
  if (glyph === "target") return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></svg>;
  if (glyph === "bell") return <svg viewBox="0 0 24 24" {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
  if (glyph === "activity") return <svg viewBox="0 0 24 24" {...common}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
  if (glyph === "trend") return <svg viewBox="0 0 24 24" {...common}><path d="M4 17 10 11l4 4 6-8M15 7h5v5" /></svg>;
  if (glyph === "cart") return <svg viewBox="0 0 24 24" {...common}><path d="M3 4h2l2.4 11h10.7l2-7H7" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>;
  if (glyph === "truck") return <svg viewBox="0 0 24 24" {...common}><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></svg>;
  if (glyph === "boxes") return <svg viewBox="0 0 24 24" {...common}><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9zM4 6.5 12 11l8-4.5M12 11v9" /></svg>;
  if (glyph === "clipboard") return <svg viewBox="0 0 24 24" {...common}><path d="M8 4h8v3H8zM6 6H4v15h16V6h-2M8 12h8M8 16h5" /></svg>;
  if (glyph === "receipt" || glyph === "tax") return <svg viewBox="0 0 24 24" {...common}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-3-2zM8 8h8M8 12h6M8 16h4" /></svg>;
  if (glyph === "bank") return <svg viewBox="0 0 24 24" {...common}><path d="m3 9 9-5 9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></svg>;
  if (glyph === "wallet") return <svg viewBox="0 0 24 24" {...common}><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 12h5v4h-5a2 2 0 1 1 0-4z" /></svg>;
  if (glyph === "ledger") return <svg viewBox="0 0 24 24" {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
  if (glyph === "users") return <svg viewBox="0 0 24 24" {...common}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 15c3.4 0 6 2 6 5" /></svg>;
  if (glyph === "calendar") return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h6" /></svg>;
  if (glyph === "hand") return <svg viewBox="0 0 24 24" {...common}><path d="M5 13V8a1.5 1.5 0 0 1 3 0v3V5a1.5 1.5 0 0 1 3 0v5V6a1.5 1.5 0 0 1 3 0v4V8a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-1c-3 0-5-2-5-5z" /></svg>;
  if (glyph === "badge") return <svg viewBox="0 0 24 24" {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="9" r="2" /><path d="M8 17c.8-2 2-3 4-3s3.2 1 4 3" /></svg>;
  if (glyph === "chart") return <svg viewBox="0 0 24 24" {...common}><path d="M4 20V4M4 20h17" /><rect x="7" y="12" width="3" height="5" rx=".5" /><rect x="12" y="8" width="3" height="9" rx=".5" /><rect x="17" y="5" width="3" height="12" rx=".5" /></svg>;
  if (glyph === "print") return <svg viewBox="0 0 24 24" {...common}><path d="M6 9V3h12v6M6 17H4V10h16v7h-2M7 14h10v7H7z" /></svg>;
  if (glyph === "building") return <svg viewBox="0 0 24 24" {...common}><path d="M5 21V4h10v17M15 9h4v12M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1M3 21h18" /></svg>;
  if (glyph === "shield") return <svg viewBox="0 0 24 24" {...common}><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6zM8.5 12l2.2 2.2 4.8-5" /></svg>;
  if (glyph === "palette") return <svg viewBox="0 0 24 24" {...common}><path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2a7 7 0 0 0 7-7c0-2.2-4-4-9-4z" /><circle cx="7.5" cy="10" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="8" r="1" /></svg>;
  return <svg viewBox="0 0 24 24" {...common}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></svg>;
}
