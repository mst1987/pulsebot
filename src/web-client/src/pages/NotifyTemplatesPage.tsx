import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate,
    type ApiError, type NotifyTemplate } from "../api";
import { useApi } from "../hooks/useApi";
import { useDraftState } from "../lib/persistedState";
import { useCollectionEditor } from "../lib/collectionEditor";
import { useTableSort, type Dir } from "../lib/tableSort";
import { TrashIcon, CrestIcon, ChevronDownIcon } from "../components/icons";
import { useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import IconTile from "../components/ui/IconTile";
import Badge from "../components/ui/Badge";
import "../styles/raid-events.css";
import RaidLoader from "../components/ui/RaidLoader";

// Aufruf-Vorlagen: the list first, the editor as a dialog over it. The open
// editor stays in the url (?edit=<id|new>), like every collection editor
// (lib/collectionEditor.ts) — only it opens over the list instead of in its
// place, with the Discord message it will post next to the fields.

type SortKey = "name" | "title";
const SORT_DEFAULTS: Record<SortKey, Dir> = { name: "asc", title: "asc" };

const FORM_ID = "notify-template-form";

/** Pencil — a plain UI function, so a line icon rather than a WoW one. */
function PenIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
        </svg>
    );
}

// ---- Discord preview ----------------------------------------------------------

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|<@&\d+>|<#\d+>)/g;

/**
 * The inline Discord markdown a template uses — bold, italic, underline, strike,
 * code and role/channel mentions — as React nodes. No HTML is ever injected: an
 * unmatched marker simply stays text, as it would in Discord.
 */
function discordInline(text: string, keyPrefix = "m"): ReactNode[] {
    const out: ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(INLINE)) {
        const at = m.index ?? 0;
        if (at > last) out.push(text.slice(last, at));
        const tok = m[0];
        const key = `${keyPrefix}${i++}`;
        if (tok.startsWith("**")) out.push(<b key={key}>{discordInline(tok.slice(2, -2), key)}</b>);
        else if (tok.startsWith("__")) out.push(<u key={key}>{discordInline(tok.slice(2, -2), key)}</u>);
        else if (tok.startsWith("~~")) out.push(<s key={key}>{discordInline(tok.slice(2, -2), key)}</s>);
        else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
        else if (tok.startsWith("<@&")) out.push(<span key={key} className="dc-ping">@Rolle</span>);
        else if (tok.startsWith("<#")) out.push(<span key={key} className="dc-ping">#kanal</span>);
        else out.push(<i key={key}>{discordInline(tok.slice(1, -1), key)}</i>);
        last = at + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

function DiscordPreview({ title, body }: { title: string; body: string }) {
    const now = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const lines = body.split("\n");
    return (
        <div className="dc-msg" aria-label="Vorschau der Discord-Nachricht">
            <div className="dc-author">
                <span className="dc-avatar"><CrestIcon /></span>
                <div>
                    <b>EventHelper</b> <span className="dc-app">App</span>
                    <div className="dc-time">heute um {now}</div>
                </div>
            </div>
            <div className="dc-pings"><span className="dc-ping">@Rolle</span></div>
            {(title || body)
                ? (
                    <div className="dc-embed">
                        {title && <div className="dc-embed-title">{title}</div>}
                        {body && (
                            <div className="dc-embed-body">
                                {lines.map((line, n) => <span key={n}>{discordInline(line, `l${n}-`)}{n < lines.length - 1 && <br />}</span>)}
                            </div>
                        )}
                    </div>
                )
                : <div className="dc-empty">Noch kein Titel und kein Text.</div>}
        </div>
    );
}

// ---- editor ---------------------------------------------------------------------

function NotifyTemplateForm({ editing, onSaved, onDirty }: {
    editing: NotifyTemplate | null;
    onSaved: (msg: string) => void;
    onDirty: (dirty: boolean, clear: () => void) => void;
}) {
    // A written text, kept as a draft per template, so leaving the page (or a
    // detour into a raid) doesn't throw it away — the head's "Entwurf" badge says so.
    const initial = { name: editing?.name ?? "", title: editing?.title ?? "", body: editing?.body ?? "" };
    const [draft, patch, clearDraft] = useDraftState(`notify-template:${editing?.id ?? "new"}`, initial);
    const { name, title, body } = draft;
    const toast = useToast();
    const dirty = name !== initial.name || title !== initial.title || body !== initial.body;

    useEffect(() => { onDirty(dirty, clearDraft); });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await saveNotifyTemplate({ id: editing?.id, name, title, body });
            clearDraft();
            onSaved(editing ? "Gespeichert." : "Vorlage angelegt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <form id={FORM_ID} className="nt-grid" onSubmit={submit}>
            <div>
                <div className="field">
                    <label htmlFor="nt-name" className="re-label">
                        Name
                        <span className="re-info" tabIndex={0} data-tip="Name" data-tip-sub="Nur zur Auswahl beim Posten – steht nicht in der Nachricht.">i</span>
                    </label>
                    <input id="nt-name" type="text" value={name} onChange={(e) => patch({ name: e.target.value })} placeholder="z.B. Kara-Reminder" required />
                </div>
                <div className="field">
                    <label htmlFor="nt-title" className="re-label">Titel der Nachricht</label>
                    <input id="nt-title" type="text" value={title} onChange={(e) => patch({ title: e.target.value })} placeholder="Anmeldung offen!" />
                </div>
                <div className="field">
                    <label htmlFor="nt-body" className="re-label">
                        Text
                        <span className="re-info" tabIndex={0} data-tip="Text" data-tip-sub="Discord-Markdown erlaubt (**fett**, *kursiv*, __unterstrichen__). Die Rollen-Pings werden beim Posten je Event gewählt.">i</span>
                    </label>
                    <textarea id="nt-body" value={body} onChange={(e) => patch({ body: e.target.value })} placeholder="Bitte tragt euch für den Raid ein …" />
                </div>
            </div>
            <div>
                <div className="re-label">Vorschau in Discord</div>
                <DiscordPreview title={title} body={body} />
                <div className="nt-ping-note">
                    <Badge tone="accent" icon="ability_warrior_battleshout">Rollen-Ping</Badge>
                    <span>wird beim Posten je Event gewählt</span>
                </div>
            </div>
        </form>
    );
}

// ---- page -----------------------------------------------------------------------

export default function NotifyTemplatesPage() {
    const ask = useConfirm();
    const editor = useCollectionEditor("edit");

    const loaded = useApi(() => getNotifyTemplates().then((r) => r.templates), []);
    const templates = loaded.data;
    const [dirty, setDirty] = useState(false);
    // The open form's "drop the draft" — Abbrechen and closing the dialog throw it away.
    const clearDraftRef = useRef<(() => void) | null>(null);
    const toast = useToast();
    const { sort, dir, onSort, apply } = useTableSort<SortKey>("notify-templates-sort", SORT_DEFAULTS, "name");

    const afterChange = (msg: string) => {
        toast(msg);
        setDirty(false);
        editor.close();
        loaded.reload();
    };

    const remove = async (t: NotifyTemplate) => {
        if (!(await ask({ title: "Vorlage löschen?", text: `„${t.name}“ wird gelöscht.`, action: "Löschen" }))) return;
        try {
            await deleteNotifyTemplate(t.id);
            afterChange("Gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    if (loaded.error) return <div className="empty">Fehler beim Laden: {loaded.error.message}</div>;
    if (!templates) return <RaidLoader text="Vorlagen werden geladen" />;

    const sorted = apply(templates, (t, key) => (key === "name" ? (t.name || "") : (t.title || "")).toLowerCase());
    // An id that no longer exists opens the new-editor rather than nothing.
    const entry = editor.editId ? templates.find((t) => t.id === editor.editId) || null : null;
    // Esc, the backdrop and ✕ only close — a typed text stays as the draft the
    // badge announces next time. "Abbrechen" means it: the draft goes too.
    const close = () => {
        clearDraftRef.current = null;
        setDirty(false);
        editor.close();
    };
    const cancel = () => {
        clearDraftRef.current?.();
        close();
    };
    const sortHead = (key: SortKey, label: string) => (
        <button type="button" className={`re-sort${sort === key ? " on" : ""}${sort === key && dir === "asc" ? " up" : ""}`} onClick={() => onSort(key)}>
            {label}{sort === key && <ChevronDownIcon />}
        </button>
    );

    return (
        <div className="re-page">
            <div className="page-head">
                <IconTile icon="inv_misc_horn_01" size="lg" />
                <div className="ph-text">
                    <div className="kicker">Raid-Events › Vorlagen</div>
                    <h1 className="re-h1">
                        Aufruf-Vorlagen
                        <span className="re-info" tabIndex={0} data-tip="Aufruf-Vorlagen" data-tip-sub="Nachrichten, die der Bot im Event mit Rollen-Ping postet (Event → Anmeldung → Aufruf posten).">i</span>
                    </h1>
                </div>
                <div className="ph-act">
                    <Button icon="ability_warrior_battleshout" onClick={editor.startNew}>Neue Vorlage</Button>
                </div>
            </div>

            <div className="glist re-glist nt-list">
                <div className="re-head nt-row" role="row">
                    <span />
                    {sortHead("name", "Name")}
                    {sortHead("title", "Text")}
                    <span />
                </div>
                {sorted.length
                    ? sorted.map((t) => (
                        <div key={t.id} className="re-row nt-row" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) editor.startEdit(t.id); }}>
                            <IconTile icon="ability_warrior_battleshout" />
                            <div className="re-ev">
                                <span className="re-title">{t.name || "(ohne Name)"}</span>
                                <span className="re-sub">{t.title || "ohne Titel"}</span>
                            </div>
                            <div className="nt-body">{(t.body || "").split("\n")[0]}</div>
                            <div className="re-acts">
                                <IconButton icon={<PenIcon />} size="sm" tip="Bearbeiten" onClick={() => editor.startEdit(t.id)} />
                                <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip="Löschen" onClick={() => remove(t)} />
                            </div>
                        </div>
                    ))
                    : <div className="re-empty">Noch keine Aufruf-Vorlagen angelegt.</div>}
            </div>

            <Modal
                open={!!editor.open}
                onClose={close}
                icon="inv_misc_horn_01"

                kicker={entry ? "Aufruf-Vorlage bearbeiten" : "Neue Aufruf-Vorlage"}
                title={entry ? entry.name || "(ohne Name)" : "Neue Vorlage"}
                width={940}
                hint={entry
                    ? <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={() => remove(entry)}>Löschen</Button>
                    : undefined}
                footer={(
                    <>
                        {dirty && <Badge tone="mid" className="nt-draft" tip="Entwurf" tipSub="Ungespeicherte Änderungen – im Browser zwischengespeichert, bis du speicherst oder abbrichst.">Entwurf</Badge>}
                        <Button variant="ghost" onClick={cancel}>Abbrechen</Button>
                        <Button type="submit" form={FORM_ID}>Speichern</Button>
                    </>
                )}
            >
                {editor.open && (
                    <NotifyTemplateForm
                        key={entry?.id ?? "new"}
                        editing={entry}
                        onSaved={afterChange}
                        onDirty={(d, clear) => {
                            clearDraftRef.current = clear;
                            if (d !== dirty) setDirty(d);
                        }}
                    />
                )}
            </Modal>
        </div>
    );
}
