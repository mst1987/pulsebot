import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
    getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate,
    type ApiError, type NotifyTemplate,
} from "../api";
import { useDraftState } from "../lib/persistedState";
import { useCollectionEditor } from "../lib/collectionEditor";
import { useTableSort, type Dir } from "../lib/tableSort";
import type { ShellContext } from "../components/Shell";
import { ListSection } from "../components/ListSection";
import { SortTh } from "../components/SortTh";
import { TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";

type SortKey = "name" | "title";
const SORT_DEFAULTS: Record<SortKey, Dir> = { name: "asc", title: "asc" };

// Model closely on RecruitmentPage.tsx's TemplateForm — same create/edit-by-
// query-param pattern, including the form-reset-after-save fix: the legacy SSR
// page always redirects back to a fresh "Neue Aufruf-Vorlage anlegen" form
// after any save, so this clears its fields the same way instead of leaving
// them (still-editing-looking) filled in.
function NotifyTemplateForm({ csrfToken, editing, onSaved, onCancel }: {
    csrfToken: string | null;
    editing: NotifyTemplate | null;
    onSaved: (msg: string) => void;
    onCancel: () => void;
}) {
    // A written text, kept as a draft per template, so leaving the page (or a
    // detour into a raid) doesn't throw it away.
    const [draft, patch, clearDraft] = useDraftState(`notify-template:${editing?.id ?? "new"}`, {
        name: editing?.name ?? "", title: editing?.title ?? "", body: editing?.body ?? "",
    });
    const { name, title, body } = draft;
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveNotifyTemplate(csrfToken, { id: editing?.id, name, title, body });
            // Mirrors the SSR page: after any save (create or edit) it lands back on a
            // blank "Neue Aufruf-Vorlage anlegen" form, since the edit id is dropped either way.
            clearDraft();
            onSaved(editing ? "Gespeichert." : "Vorlage angelegt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            <div className="field">
                <label>Name (interne Bezeichnung)</label>
                <input type="text" value={name} onChange={(e) => patch({ name: e.target.value })} placeholder="z.B. Kara-Reminder" required />
                <div className="hint">Nur zur Auswahl — nicht Teil der geposteten Nachricht.</div>
            </div>
            <div className="field">
                <label>Titel der Nachricht (optional)</label>
                <input type="text" value={title} onChange={(e) => patch({ title: e.target.value })} placeholder="Anmeldung offen!" />
            </div>
            <div className="field">
                <label>Text</label>
                <textarea value={body} onChange={(e) => patch({ body: e.target.value })} placeholder="Bitte tragt euch für den Raid ein …" />
                <div className="hint">Discord-Markdown erlaubt. Die Rollen-Pings werden beim Posten pro Event ausgewählt.</div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{editing ? "Speichern" : "Vorlage anlegen"}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { clearDraft(); onCancel(); }}>Abbrechen</button>
            </div>
        </form>
    );
}

export default function NotifyTemplatesPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const editor = useCollectionEditor("edit");

    const [templates, setTemplates] = useState<NotifyTemplate[] | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const toast = useToast();
    const { sort, dir, onSort, apply } = useTableSort<SortKey>("notify-templates-sort", SORT_DEFAULTS, "name");

    const load = () => {
        getNotifyTemplates().then((r) => setTemplates(r.templates)).catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    const afterChange = (msg: string) => {
        toast(msg);
        // Back to the list after a save or a delete: the edited template is done
        // with, and the list is where the next one is picked.
        editor.close();
        load();
    };

    const remove = async (t: NotifyTemplate) => {
        if (!confirm("Vorlage wirklich löschen?")) return;
        try {
            await deleteNotifyTemplate(csrfToken, t.id);
            afterChange("Gelöscht.");
        } catch (err) {
            // A failed delete changed nothing — report it as the error it is
            // instead of running it through the success path (which reloaded the
            // list and coloured the message green).
            toast((err as ApiError).message, "err");
        }
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!templates) return <div className="empty">Lade…</div>;

    const sorted = apply(templates, (t, key) => (key === "name" ? (t.name || "") : (t.title || "")).toLowerCase());

    return (
        <>
            <p className="note"><Link className="mlink" to="/raids">← Zurück zur Event-Übersicht</Link></p>
            <h1 className="page-title">Aufruf-Vorlagen</h1>
            <ListSection
                editor={editor}
                entries={templates}
                idOf={(t) => t.id}
                note="Nachrichten-Vorlagen, die der Bot pro Event mit Rollen-Ping postet."
                newLabel="Neue Vorlage"
                editorTitle={(t) => (t ? `Vorlage „${t.name || ""}" bearbeiten` : "Neue Aufruf-Vorlage")}
                editorFor={(t) => (
                    <NotifyTemplateForm
                        key={t?.id ?? "new"} csrfToken={csrfToken} editing={t}
                        onSaved={afterChange} onCancel={editor.close}
                    />
                )}
            >
                {templates.length
                    ? (
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="title" label="Titel" sort={sort} dir={dir} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((t) => (
                                    <tr key={t.id}>
                                        <td><strong>{t.name || "(ohne Name)"}</strong></td>
                                        <td className="sub" style={{ margin: 0 }}>{t.title || ""}</td>
                                        <td className="row-actions">
                                            <button className="btn btn-ghost" type="button" onClick={() => editor.startEdit(t.id)}>Bearbeiten</button>
                                            <button className="btn btn-danger" type="button" onClick={() => remove(t)}><TrashIcon />Löschen</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                    : <p className="sub">Noch keine Aufruf-Vorlagen angelegt.</p>}
            </ListSection>
        </>
    );
}
