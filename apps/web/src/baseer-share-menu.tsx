import type { ReactNode } from 'react';

import { BaseerMenu } from './baseer-menu';

function ShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="2.25" /><circle cx="6" cy="12" r="2.25" /><circle cx="18" cy="19" r="2.25" /><path d="m8.1 10.9 7.7-4.7M8.1 13.1l7.7 4.7" /></svg>;
}

/** One contextual share surface for every server-produced print or export action. */
export function BaseerShareMenu({ label, children, message, className = '' }: { label: string; children: ReactNode; message?: ReactNode; className?: string }) {
  return <div className={`baseer-share-menu ${className}`.trim()}><BaseerMenu label={label} trigger={<ShareIcon />} triggerClassName="baseer-share-menu__trigger" menuClassName="baseer-share-menu__list">{children}</BaseerMenu>{message ? <p className="baseer-share-menu__message" role="status">{message}</p> : null}</div>;
}
