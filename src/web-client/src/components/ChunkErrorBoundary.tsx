import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n";
import { isChunkLoadError } from "../lib/chunkReload";

/** The notice when a page's code could not be loaded even after the automatic reload. */
function NewVersionNotice() {
    const t = useT();
    return (
        <div className="empty app-notice" role="alert">
            <p><strong>{t("shell.app.newVersionTitle")}</strong></p>
            <p>{t("shell.app.newVersionText")}</p>
            <button type="button" className="btn" onClick={() => window.location.reload()}>{t("shell.app.newVersionReload")}</button>
        </div>
    );
}

/**
 * Catches a chunk that could not be loaded (#530, lib/chunkReload.ts) and shows
 * the reload notice in place of a white page. Every other error is thrown on,
 * exactly as without this boundary. A new `resetKey` (another page) tries again.
 */
export default class ChunkErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
    state = { error: null as unknown };

    static getDerivedStateFromError(error: unknown) {
        return { error };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        if (isChunkLoadError(error)) console.error("Chunk load error", error, info.componentStack);
    }

    componentDidUpdate(prev: { resetKey?: string }) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
    }

    render() {
        const { error } = this.state;
        if (error) {
            if (isChunkLoadError(error)) return <NewVersionNotice />;
            throw error;
        }
        return this.props.children;
    }
}
