import { useEffect, useState } from "react";

// Auto-dismissing post-action feedback (top-right), ported from the legacy
// admin's flash()/.toast-wrap (src/web/renderAdmin.js). Replaces the inline
// ".flash"/".flash-err" banner previously used for post-redirect-style
// messages on this page.
export type ToastFlash = { type: "ok" | "err"; text: string };

export default function Toast({ flash, onClose }: { flash: ToastFlash | null; onClose: () => void }) {
    const [hiding, setHiding] = useState(false);

    useEffect(() => {
        if (!flash) return undefined;
        setHiding(false);
        const dismiss = setTimeout(() => setHiding(true), 4500);
        return () => clearTimeout(dismiss);
    }, [flash]);

    useEffect(() => {
        if (!hiding) return undefined;
        const remove = setTimeout(onClose, 220);
        return () => clearTimeout(remove);
    }, [hiding, onClose]);

    if (!flash) return null;
    const ok = flash.type !== "err";

    return (
        <div className="toast-wrap">
            <div className={`toast ${ok ? "toast-ok" : "toast-err"}${hiding ? " hide" : ""}`} role="status" aria-live="polite">
                <span className="toast-ico" aria-hidden="true">{ok ? "✓" : "!"}</span>
                <span className="toast-msg">{flash.text}</span>
                <button className="toast-x" type="button" aria-label="Schließen" onClick={() => setHiding(true)}>&times;</button>
            </div>
        </div>
    );
}
