import type { ReactNode } from "react";
import type { CollectionEditor } from "../lib/collectionEditor";

// The two halves of a "list of things you can edit" section, so all of them
// look and behave the same: a heading row carrying the section's title and its
// one "new" button, and — when an editor is open — the editor in place of the
// list, headed by the way back.
//
// Keeping the editor *instead of* the list rather than below it is the point:
// the fields of the thing being edited start at the top of the page, not after
// scrolling past twenty rows.

/**
 * The list view's heading row: title, note, and the button that opens a new
 * editor. `title` is optional — a section that already sits under a heading
 * (an Einstellungen section, say) passes none and keeps just the button.
 */
export function ListHeader({ title, note, newLabel, onNew }: {
    title?: string;
    note?: ReactNode;
    newLabel: string;
    onNew: () => void;
}) {
    return (
        <div className="list-head">
            <div className="list-head-text">
                {title && <h2>{title}</h2>}
                {note && <p className="note">{note}</p>}
            </div>
            <button className="btn" type="button" onClick={onNew}>{newLabel}</button>
        </div>
    );
}

/** The editor view: a back link to the list, the editor's own title, then the form. */
export function EditorPanel({ title, backLabel = "Zurück zur Liste", onClose, children }: {
    title: string;
    backLabel?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    return (
        <>
            <div className="list-head">
                <div className="list-head-text"><h2>{title}</h2></div>
                <button className="btn btn-ghost" type="button" onClick={onClose}>← {backLabel}</button>
            </div>
            {children}
        </>
    );
}

/**
 * Renders the editor when one is open, the list otherwise. `editorTitle` gets
 * the entry being edited (null while creating), so a section can name it.
 */
export function ListSection<T>({ editor, entries, idOf, title, note, newLabel, editorTitle, editorFor, children }: {
    editor: CollectionEditor;
    entries: T[];
    idOf: (entry: T) => string;
    title?: string;
    note?: ReactNode;
    newLabel: string;
    editorTitle: (entry: T | null) => string;
    editorFor: (entry: T | null) => ReactNode;
    /** The list itself — a table, cards, whatever the section needs. */
    children: ReactNode;
}) {
    if (editor.open) {
        // An id that no longer exists (deleted in another tab, stale link) falls
        // back to the "new" editor rather than to a blank screen.
        const entry = editor.editId ? entries.find((e) => idOf(e) === editor.editId) || null : null;
        return (
            <EditorPanel title={editorTitle(entry)} onClose={editor.close}>
                {editorFor(entry)}
            </EditorPanel>
        );
    }
    return (
        <>
            <ListHeader title={title} note={note} newLabel={newLabel} onNew={editor.startNew} />
            {children}
        </>
    );
}
