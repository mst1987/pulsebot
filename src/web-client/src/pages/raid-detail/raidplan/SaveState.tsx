import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Save } from "lucide-react";
import { useT } from "../../../i18n";

/** The save state of an editor: "clean" (saved), "dirty" (unsaved changes) or "conflict" (somebody saved meanwhile: 409). */
export type SaveStateKind = "clean" | "dirty" | "conflict";

/**
 * Guards unsaved work of the plan and template editors: Ctrl+S (Cmd+S) saves instead of the browser's "save page", the tab title gets a
 * "● " in front while there are unsaved changes, and leaving the page (reload, close, another address) asks first. Returns whether the
 * state just turned from unsaved to saved (for a short confirmation flash).
 */
export function useUnsavedGuard(state: SaveStateKind, busy: boolean, onSave: () => void): boolean {
    const save = useRef(onSave);
    save.current = onSave;
    const dirty = state !== "clean";
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (state === "dirty" && !busy) save.current();
            }
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [state, busy]);
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; return ""; };
        window.addEventListener("beforeunload", warn);
        const title = document.title;
        if (title.indexOf("● ") !== 0) document.title = `● ${title}`;
        return () => {
            window.removeEventListener("beforeunload", warn);
            if (document.title.indexOf("● ") === 0) document.title = document.title.slice(2);
        };
    }, [dirty]);
    const [flash, setFlash] = useState(false);
    const was = useRef(state);
    useEffect(() => {
        if (was.current === "dirty" && state === "clean") {
            setFlash(true);
            const id = window.setTimeout(() => setFlash(false), 1600);
            was.current = state;
            return () => window.clearTimeout(id);
        }
        was.current = state;
        return undefined;
    }, [state]);
    return flash;
}

/**
 * The save button of the tool bar: saved = calm, a green check "Gespeichert" (a short flash right after saving); unsaved = amber with a
 * dot, a soft glow that pulses (static with reduced motion) and the text "Speichern"; a conflict = red. Never colour alone: text and icon
 * say it too.
 */
export function SaveButton({ state, busy, flash, onSave, disabled }: { state: SaveStateKind; busy: boolean; flash: boolean; onSave: () => void; disabled?: boolean }) {
    const t = useT();
    const label = busy ? t("raidBoard.bar.saving") : state === "conflict" ? t("raidBoard.save.conflict") : state === "dirty" ? t("raidBoard.bar.save") : t("raidBoard.bar.savedState");
    return (
        <button
            type="button" className={`rp-save rp-savebtn is-${state}${flash ? " is-flash" : ""}`} disabled={disabled || busy || state !== "dirty"} onClick={onSave}
            data-tip={state === "dirty" ? `${t("raidBoard.bar.save")} (Strg+S)` : undefined} aria-keyshortcuts="Control+S"
        >
            {state === "dirty" && <span className="rp-savebtn-dot" aria-hidden="true" />}
            {state === "conflict" ? <AlertTriangle size={15} aria-hidden="true" /> : state === "dirty" ? <Save size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
            <span>{label}</span>
        </button>
    );
}

/**
 * The narrow strip at the top of the sticky tool bar while there are unsaved changes: "Ungespeicherte Änderungen" (with how many
 * sections), "Jetzt speichern" and the Ctrl+S hint; red for a conflict. aria-live, so a screen reader hears it once.
 */
export function UnsavedBar({ state, sections, busy, onSave, conflictText }: { state: SaveStateKind; sections: number; busy: boolean; onSave: () => void; conflictText?: string }) {
    const t = useT();
    return (
        <div className={`rp-unsaved is-${state}`} role="status" aria-live="polite">
            {state !== "clean" && (
                <>
                    <AlertTriangle size={15} aria-hidden="true" />
                    <b>{state === "conflict" ? conflictText || t("raidBoard.save.conflictText") : t("raidBoard.save.unsaved")}</b>
                    {state === "dirty" && sections > 0 && <span className="rp-unsaved-n">{sections === 1 ? t("raidBoard.save.oneSection") : t("raidBoard.save.sections", { n: sections })}</span>}
                    {state === "dirty" && <button type="button" className="rp-unsaved-btn" disabled={busy} onClick={onSave}><Save size={14} aria-hidden="true" />{t("raidBoard.save.now")}</button>}
                    {state === "dirty" && <span className="rp-unsaved-key"><kbd>Strg</kbd>+<kbd>S</kbd></span>}
                </>
            )}
        </div>
    );
}
