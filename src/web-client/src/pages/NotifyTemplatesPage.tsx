import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    getNotifyTemplates, saveNotifyTemplate, deleteNotifyTemplate,
    type ApiError, type NotifyTemplate } from "../api";
import { useApi } from "../hooks/useApi";
import { formatTime } from "../lib/format";
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
import { t as tr, useT } from "../i18n";

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
        else if (tok.startsWith("<@&")) out.push(<span key={key} className="dc-ping">{tr("notifyTemplates.preview.role")}</span>);
        else if (tok.startsWith("<#")) out.push(<span key={key} className="dc-ping">{tr("notifyTemplates.preview.channel")}</span>);
        else out.push(<i key={key}>{discordInline(tok.slice(1, -1), key)}</i>);
        last = at + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

function DiscordPreview({ title, body }: { title: string; body: string }) {
    const t = useT();
    const now = formatTime(Date.now());
    const lines = body.split("\n");
    return (
        <div className="dc-msg" aria-label={t("notifyTemplates.preview.aria")}>
            <div className="dc-author">
                <span className="dc-avatar"><CrestIcon /></span>
                <div>
                    <b>EventHelper</b> <span className="dc-app">{t("notifyTemplates.preview.app")}</span>
                    <div className="dc-time">{t("notifyTemplates.preview.today", { time: now })}</div>
                </div>
            </div>
            <div className="dc-pings"><span className="dc-ping">{t("notifyTemplates.preview.role")}</span></div>
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
                : <div className="dc-empty">{t("notifyTemplates.preview.empty")}</div>}
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
    const t = useT();
    const dirty = name !== initial.name || title !== initial.title || body !== initial.body;

    useEffect(() => { onDirty(dirty, clearDraft); });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await saveNotifyTemplate({ id: editing?.id, name, title, body });
            clearDraft();
            onSaved(editing ? t("notifyTemplates.toast.saved") : t("notifyTemplates.toast.created"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <form id={FORM_ID} className="nt-grid" onSubmit={submit}>
            <div>
                <div className="field">
                    <label htmlFor="nt-name" className="re-label">
                        {t("common.name")}
                        <span className="re-info" tabIndex={0} data-tip={t("common.name")} data-tip-sub={t("notifyTemplates.form.nameSub")}>i</span>
                    </label>
                    <input id="nt-name" type="text" value={name} onChange={(e) => patch({ name: e.target.value })} placeholder={t("notifyTemplates.form.namePlaceholder")} required />
                </div>
                <div className="field">
                    <label htmlFor="nt-title" className="re-label">{t("notifyTemplates.form.title")}</label>
                    <input id="nt-title" type="text" value={title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("notifyTemplates.form.titlePlaceholder")} />
                </div>
                <div className="field">
                    <label htmlFor="nt-body" className="re-label">
                        {t("notifyTemplates.form.text")}
                        <span className="re-info" tabIndex={0} data-tip={t("notifyTemplates.form.text")} data-tip-sub={t("notifyTemplates.form.textSub")}>i</span>
                    </label>
                    <textarea id="nt-body" value={body} onChange={(e) => patch({ body: e.target.value })} placeholder={t("notifyTemplates.form.textPlaceholder")} />
                </div>
            </div>
            <div>
                <div className="re-label">{t("notifyTemplates.form.preview")}</div>
                <DiscordPreview title={title} body={body} />
                <div className="nt-ping-note">
                    <Badge tone="accent" icon="ability_warrior_battleshout">{t("notifyTemplates.form.ping")}</Badge>
                    <span>{t("notifyTemplates.form.pingNote")}</span>
                </div>
            </div>
        </form>
    );
}

// ---- page -----------------------------------------------------------------------

export default function NotifyTemplatesPage() {
    const t = useT();
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

    const remove = async (tpl: NotifyTemplate) => {
        if (!(await ask({ title: t("notifyTemplates.delete.title"), text: t("notifyTemplates.delete.text", { name: tpl.name }), action: t("common.delete") }))) return;
        try {
            await deleteNotifyTemplate(tpl.id);
            afterChange(t("notifyTemplates.toast.deleted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    if (loaded.error) return <div className="empty">{t("notifyTemplates.page.loadError", { message: loaded.error.message })}</div>;
    if (!templates) return <RaidLoader text={t("notifyTemplates.page.loading")} />;

    const sorted = apply(templates, (tpl, key) => (key === "name" ? (tpl.name || "") : (tpl.title || "")).toLowerCase());
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
                    <div className="kicker">{t("notifyTemplates.page.kicker")}</div>
                    <h1 className="re-h1">
                        {t("notifyTemplates.page.title")}
                        <span className="re-info" tabIndex={0} data-tip={t("notifyTemplates.page.title")} data-tip-sub={t("notifyTemplates.page.infoSub")}>i</span>
                    </h1>
                </div>
                <div className="ph-act">
                    <Button icon="ability_warrior_battleshout" onClick={editor.startNew}>{t("notifyTemplates.page.new")}</Button>
                </div>
            </div>

            <div className="glist re-glist nt-list">
                <div className="re-head nt-row" role="row">
                    <span />
                    {sortHead("name", t("common.name"))}
                    {sortHead("title", t("notifyTemplates.page.colText"))}
                    <span />
                </div>
                {sorted.length
                    ? sorted.map((tpl) => (
                        <div key={tpl.id} className="re-row nt-row" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) editor.startEdit(tpl.id); }}>
                            <IconTile icon="ability_warrior_battleshout" />
                            <div className="re-ev">
                                <span className="re-title">{tpl.name || t("notifyTemplates.page.noName")}</span>
                                <span className="re-sub">{tpl.title || t("notifyTemplates.page.noTitle")}</span>
                            </div>
                            <div className="nt-body">{(tpl.body || "").split("\n")[0]}</div>
                            <div className="re-acts">
                                <IconButton icon={<PenIcon />} size="sm" tip={t("common.edit")} onClick={() => editor.startEdit(tpl.id)} />
                                <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("common.delete")} onClick={() => remove(tpl)} />
                            </div>
                        </div>
                    ))
                    : <div className="re-empty">{t("notifyTemplates.page.empty")}</div>}
            </div>

            <Modal
                open={!!editor.open}
                onClose={close}
                icon="inv_misc_horn_01"

                kicker={entry ? t("notifyTemplates.modal.kickerEdit") : t("notifyTemplates.modal.kickerNew")}
                title={entry ? entry.name || t("notifyTemplates.page.noName") : t("notifyTemplates.page.new")}
                width={940}
                hint={entry
                    ? <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={() => remove(entry)}>{t("common.delete")}</Button>
                    : undefined}
                footer={(
                    <>
                        {dirty && <Badge tone="mid" className="nt-draft" tip={t("notifyTemplates.modal.draft")} tipSub={t("notifyTemplates.modal.draftSub")}>{t("notifyTemplates.modal.draft")}</Badge>}
                        <Button variant="ghost" onClick={cancel}>{t("common.cancel")}</Button>
                        <Button type="submit" form={FORM_ID}>{t("common.save")}</Button>
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
