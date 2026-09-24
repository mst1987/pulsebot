import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../../i18n";

/** The text of the fallback (a function component, because the class cannot use hooks). */
function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
    const t = useT();
    return (
        <div className="rp-crash" role="alert">
            <strong>{t("raidBoard.crash.title")}</strong>
            <p className="rp-muted">{t("raidBoard.crash.text")}</p>
            <div className="rp-crash-actions">
                <button type="button" className="rp-assign-btn" onClick={() => window.location.reload()}>{t("raidBoard.crash.reload")}</button>
                <button type="button" className="rp-assign-btn" onClick={onReset}>{t("raidBoard.crash.retry")}</button>
            </div>
            <details><summary>{t("raidBoard.crash.details")}</summary><pre>{error.message}{"\n"}{(error.stack || "").split("\n").slice(0, 6).join("\n")}</pre></details>
        </div>
    );
}

/** Catches a render error of the plan editor so the whole page does not go white; the error is logged. A new `resetKey` (another boss) tries again. */
export default class RaidplanBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Raidplan render error", error, info.componentStack);
    }

    componentDidUpdate(prev: { resetKey?: string }) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
    }

    render() {
        if (this.state.error) return <Fallback error={this.state.error} onReset={() => this.setState({ error: null })} />;
        return this.props.children;
    }
}
