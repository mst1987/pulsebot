import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate,
    type ApiError, type NotifyTemplate,
} from "../api";
import { useDraftState } from "../lib/persistedState";
import type { ShellContext } from "../components/Shell";
import { TrashIcon } from "../components/icons";

type Flash = { type: "ok" | "err"; text: string };

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
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await saveNotifyTemplate(csrfToken, { id: editing?.id, name, title, body });
            // Mirrors the SSR page: after any save (create or edit) it lands back on a
            // blank "Neue Aufruf-Vorlage anlegen" form, since the edit id is dropped either way.
            clearDraft();
            onSaved(editing ? "Gespeichert." : "Vorlage angelegt.");
        } catch (err) {
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <h2>{editing ? `Vorlage bearbeiten: ${editing.name || ""}` : "Neue Aufruf-Vorlage anlegen"}</h2>
            <form className="card-form" onSubmit={submit}>
                {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
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
                    {editing && <button className="btn btn-ghost" type="button" onClick={() => { clearDraft(); onCancel(); }}>Abbrechen</button>}
                </div>
            </form>
        </>
    );
}

export default function NotifyTemplatesPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams, setSearchParams] = useSearchParams();
    const editId = searchParams.get("edit") || "";

    const [templates, setTemplates] = useState<NotifyTemplate[] | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<Flash | null>(null);

    const load = () => {
        getNotifyTemplates().then((r) => setTemplates(r.templates)).catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    const startEdit = (id: string) => setSearchParams({ edit: id });
    const cancelEdit = () => setSearchParams({});

    const afterChange = (msg: string) => {
        setFlash({ type: "ok", text: msg });
        if (editId) setSearchParams({});
        load();
    };

    const remove = async (t: NotifyTemplate) => {
        if (!confirm("Vorlage wirklich löschen?")) return;
        try {
            await deleteNotifyTemplate(csrfToken, t.id);
            afterChange("Gelöscht.");
        } catch (err) {
            afterChange((err as ApiError).message);
        }
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!templates) return <div className="empty">Lade…</div>;

    const editing = editId ? templates.find((t) => t.id === editId) || null : null;

    return (
        <>
            <p className="note"><Link className="mlink" to="/raids">← Zurück zur Event-Übersicht</Link></p>
            <h1 className="page-title">Aufruf-Vorlagen</h1>
            {flash && <p className="sub" style={{ color: flash.type === "err" ? "var(--high)" : "var(--good)" }}>{flash.text}</p>}
            <p className="note">Nachrichten-Vorlagen, die der Bot pro Event mit Rollen-Ping postet.</p>
            {templates.length
                ? (
                    <table className="idx" style={{ marginBottom: 18 }}>
                        <thead><tr><th>Name</th><th>Titel</th><th /></tr></thead>
                        <tbody>
                            {templates.map((t) => (
                                <tr key={t.id}>
                                    <td><strong>{t.name || "(ohne Name)"}</strong></td>
                                    <td className="sub" style={{ margin: 0 }}>{t.title || ""}</td>
                                    <td className="row-actions">
                                        <button className="btn btn-ghost" type="button" onClick={() => startEdit(t.id)}>Bearbeiten</button>
                                        <button className="btn btn-danger" type="button" onClick={() => remove(t)}><TrashIcon />Löschen</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
                : <p className="sub">Noch keine Aufruf-Vorlagen. Lege unten die erste an.</p>}
            <NotifyTemplateForm key={editing?.id ?? "new"} csrfToken={csrfToken} editing={editing} onSaved={afterChange} onCancel={cancelEdit} />
        </>
    );
}
