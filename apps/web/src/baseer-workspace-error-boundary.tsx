import { Component, type ErrorInfo, type ReactNode } from "react";

type Language = "ar" | "en";

type Props = {
  language: Language;
  children: ReactNode;
};

type State = { failed: boolean };

/**
 * Suspense covers a pending dynamic import, but it does not catch an import or
 * render failure.  Keep a route-level boundary so a stale chunk, a brief proxy
 * interruption, or an unexpected page error never turns the application into
 * an unhelpful white screen.
 */
export class BaseerWorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics available to the browser console without exposing
    // implementation details or sensitive server responses in the UI.
    console.error("Baseer workspace render failure", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const ar = this.props.language === "ar";
    return <section className="module-page__placeholder baseer-workspace-error" role="alert">
      <h2>{ar ? "تعذر فتح هذه الصفحة" : "This page could not be opened"}</h2>
      <p>{ar ? "حدث خلل مؤقت أثناء تحميل الصفحة. أعد تحميل التطبيق ثم حاول مرة أخرى." : "A temporary error occurred while loading this page. Reload the application and try again."}</p>
      <button type="button" className="text-button" onClick={() => window.location.reload()}>{ar ? "إعادة تحميل التطبيق" : "Reload application"}</button>
    </section>;
  }
}
