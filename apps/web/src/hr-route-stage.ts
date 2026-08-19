export function consumeHrRouteStage(section: number) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#module=hr&section=${section}`);
}
