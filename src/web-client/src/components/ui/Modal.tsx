import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import IconTile, { type TileTone } from "./IconTile";
import { Button, IconButton } from "./Button";
import { TrashIcon, XIcon } from "../icons";

// Modals on the native <dialog>: it brings the backdrop, the focus trap and Esc
// for free. Head with icon tile, kicker and title plus a close button; body;
// foot with a hint on the left, "Abbrechen" and the primary action.
//
// useConfirm() replaces the browser's native confirm box: same one-line use
// (`if (!(await ask({...}))) return;`), but the page's own dialog instead of
// the browser's grey box, with the destructive button never preselected.

export function Modal({ open, onClose, icon, tone, kicker, title, footer, hint, width = 640, children, initialFocus }: {
    open: boolean;
    /** Esc, the close button and a click on the backdrop all end up here. */
    onClose: () => void;
    icon?: string | ReactNode;
    tone?: TileTone;
    kicker?: string;
    title: string;
    /** The buttons of the foot (Abbrechen + primary action). */
    footer?: ReactNode;
    /** Short note on the left of the foot ("dauert ca. 2 min"). */
    hint?: ReactNode;
    width?: number;
    children?: ReactNode;
    /** CSS selector inside the dialog that gets the focus when it opens. */
    initialFocus?: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dlg = ref.current;
        if (!dlg) return;
        if (open && !dlg.open) {
            dlg.showModal();
            const target = initialFocus ? dlg.querySelector<HTMLElement>(initialFocus) : null;
            target?.focus();
        } else if (!open && dlg.open) {
            dlg.close();
        }
    }, [open, initialFocus]);

    return (
        <dialog
            ref={ref}
            className="dlg"
            style={{ width: `min(${width}px, calc(100vw - 32px))` }}
            // Esc fires "cancel": turn it into the caller's close instead of
            // letting the browser close the dialog behind React's back.
            onCancel={(e) => { e.preventDefault(); onClose(); }}
            // A click whose target is the dialog element itself landed on the
            // backdrop — the content always sits inside the inner wrapper.
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {open && (
                <div className="dlg-inner">
                    <div className="dlg-head">
                        {icon && <IconTile icon={icon} tone={tone} />}
                        <div className="dlg-titles">
                            {kicker && <div className="kicker">{kicker}</div>}
                            <div className="dlg-title">{title}</div>
                        </div>
                        <IconButton icon={<XIcon />} tip="Schließen" size="sm" onClick={onClose} />
                    </div>
                    {children && <div className="dlg-body">{children}</div>}
                    {(footer || hint) && (
                        <div className="dlg-foot">
                            {hint && <span className="dlg-hint">{hint}</span>}
                            {footer}
                        </div>
                    )}
                </div>
            )}
        </dialog>
    );
}

export type ConfirmOptions = {
    title: string;
    text?: ReactNode;
    /** Label of the confirming button, e.g. "Löschen". */
    action?: string;
    /** "danger" for destructive actions (trash icon, red button), "run" to start a job. */
    tone?: "danger" | "run" | "primary";
    /** A WoW icon name or line icon for the head tile. */
    icon?: string | ReactNode;
    cancelLabel?: string;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Ask before doing something: `const ask = useConfirm(); if (!(await ask({ title, text, action, tone }))) return;`.
 * Resolves true only on the confirming button; Esc, the backdrop, the close
 * button and "Abbrechen" all resolve false.
 */
export function useConfirm(): ConfirmFn {
    const fn = useContext(ConfirmContext);
    if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
    return fn;
}

/**
 * Holds the one confirm dialog. Sits above the router (App.tsx), like the job
 * toasts, so a question asked from inside a running job — the "Raid nicht
 * beendet" check — still has somewhere to appear after a navigation.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [queue, setQueue] = useState<Pending[]>([]);

    const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => {
        setQueue((q) => [...q, { ...options, resolve }]);
    }), []);

    const current = queue[0] || null;
    const answer = useCallback((ok: boolean) => {
        setQueue((q) => {
            if (q[0]) q[0].resolve(ok);
            return q.slice(1);
        });
    }, []);

    const value = useMemo(() => confirm, [confirm]);
    const tone = current?.tone || "danger";

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            <Modal
                open={!!current}
                onClose={() => answer(false)}
                icon={current?.icon ?? (tone === "danger" ? <TrashIcon /> : undefined)}
                tone={tone === "danger" ? "bad" : tone === "run" ? "mid" : undefined}
                title={current?.title || ""}
                width={460}
                // The destructive button is never preselected.
                initialFocus="[data-confirm-cancel]"
                footer={current && (
                    <>
                        <Button variant="ghost" data-confirm-cancel="" onClick={() => answer(false)}>
                            {current.cancelLabel || "Abbrechen"}
                        </Button>
                        <Button
                            variant={tone}
                            icon={tone === "danger" ? <TrashIcon /> : tone === "run" ? "spell_holy_borrowedtime" : undefined}
                            onClick={() => answer(true)}
                        >
                            {current.action || "OK"}
                        </Button>
                    </>
                )}
            >
                {current?.text && <div className="dlg-text">{current.text}</div>}
            </Modal>
        </ConfirmContext.Provider>
    );
}
