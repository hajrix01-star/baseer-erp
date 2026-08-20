import './workspace-legacy.css';
import './workspace-foundation.css';

/**
 * Deliberately lazy: these styles belong to authenticated workspaces, not to
 * the launcher or sign-in screen. The gate in App waits for this module before
 * it mounts a workspace, so navigation never flashes unstyled controls.
 */
export default function WorkspaceStyles() {
  return null;
}
