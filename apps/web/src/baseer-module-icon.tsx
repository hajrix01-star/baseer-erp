import type { ModuleId } from "./modules";

export function BaseerModuleIcon({ moduleId }: { moduleId: ModuleId }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  if (moduleId === "command") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" {...common} /><circle cx="16" cy="16" r="3" fill="var(--module-alt)" /><path d="m19 13-7 7" {...common} /><path d="m21 10-2 5-4-4 6-1Z" fill="var(--module)" /></svg>;
  if (moduleId === "operations") return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="8" width="9" height="9" rx="2" fill="var(--module-alt)" /><rect x="18" y="15" width="9" height="9" rx="2" fill="var(--module)" /><path d="M13 21h5m-4-11h4" {...common} /></svg>;
  if (moduleId === "finance") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 24V13h6v11H6Z" fill="var(--module-alt)" /><path d="M13 24V8h6v16h-6Z" fill="var(--module)" /><path d="M20 24v-7h6v7h-6Z" fill="color-mix(in srgb, var(--module) 55%, #ffbd3d)" /><path d="M5 26h22" {...common} /></svg>;
  if (moduleId === "hr") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="10" r="4" fill="var(--module-alt)" /><path d="M8 26c.6-5 3.3-8 8-8s7.4 3 8 8" fill="var(--module)" /><circle cx="7" cy="15" r="2.5" fill="color-mix(in srgb, var(--module) 60%, #ffbd3d)" /><circle cx="25" cy="15" r="2.5" fill="var(--module-alt)" /></svg>;
  if (moduleId === "reports") return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="17" width="5" height="9" rx="1.5" fill="var(--module-alt)" /><rect x="13.5" y="11" width="5" height="15" rx="1.5" fill="var(--module)" /><rect x="22" y="6" width="5" height="20" rx="1.5" fill="color-mix(in srgb, var(--module) 58%, #ffbd3d)" /><path d="M5 5h10" {...common} /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 5 2.2 2.4 3.2-.5.9 3.1 3 1.2-1 3.1 2 2.5-2 2.5 1 3.1-3 1.2-.9 3.1-3.2-.5L16 27l-2.2-2.4-3.2.5-.9-3.1-3-1.2 1-3.1-2-2.5 2-2.5-1-3.1 3-1.2.9-3.1 3.2.5L16 5Z" fill="var(--module)" /><circle cx="16" cy="16" r="4" fill="var(--module-alt)" /></svg>;
}
