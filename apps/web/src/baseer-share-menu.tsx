import type { ReactNode } from 'react';

function ShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="2.25" /><circle cx="6" cy="12" r="2.25" /><circle cx="18" cy="19" r="2.25" /><path d="m8.1 10.9 7.7-4.7M8.1 13.1l7.7 4.7" /></svg>;
}

/** One contextual share surface for every server-produced print or export action. */
export function BaseerShareMenu({ label, children, message, className = '' }: { label: string; children: ReactNode; message?: ReactNode; className?: string }) {
  return <div className={`baseer-share-menu ${className}`.trim()}><details className="baseer-share-menu__details"><summary className="baseer-button baseer-button--secondary baseer-share-menu__trigger" aria-label={label} title={label}><ShareIcon /></summary><div className="baseer-share-menu__list" role="menu">{children}</div></details>{message ? <p className="baseer-share-menu__message">{message}</p> : null}</div>;
}
