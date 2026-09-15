import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getRecruitmentData, saveRecruitmentTemplate, deleteRecruitmentTemplate,
    postRecruitmentTemplate, updateRecruitmentPost, deleteRecruitmentPost, scanRecruitmentPosts,
    type ApiError, type Application, type RecruitmentData, type RecruitmentTemplate, type RecruitmentPost, type TextChannel,
} from "../api";
import { usePersistedSearchParam, useDraftState } from "../lib/persistedState";
import { useCollectionEditor, type CollectionEditor } from "../lib/collectionEditor";
import { useTableSort, type Dir } from "../lib/tableSort";
import { specsInContent, specEmojiUrl } from "../lib/recruitmentSpecs";
import { DISCORD_CONTENT_LIMIT } from "../lib/discordMarkdown";
import { channelUrl, messageLink } from "../lib/discordLinks";
import EmojiPicker from "../components/EmojiPicker";
import SpecPicker, { SpecImg } from "../components/SpecPicker";
import DiscordPreview from "../components/DiscordPreview";
import type { ShellContext } from "../components/Shell";
import { SortTh } from "../components/SortTh";
import { CheckIcon, ExternalIcon, TrashIcon } from "../components/icons";
import { classColorProps } from "../components/ClassSpec";
import { useJobs, useToast } from "../components/Jobs";
import { Modal, useConfirm } from "../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Expand from "../components/ui/Expand";
import PageHead from "../components/ui/PageHead";
import { PartHead } from "../components/ui/PartHead";
import WowIcon from "../components/ui/WowIcon";
import "../styles/recruitment.css";

// Recruitment (design issue #215): three tabs of compact tables — posted
// messages, templates, applications — and everything that is more than a row
// in a modal: the template/post editor with its live Discord preview, the
// "post a message" dialog and an application's details. The editors stay in the
// url (?edit=<id|new>, ?editpost=<id|new>), so a link to a template still opens
// it; "new" on editpost is the posting dialog.

type View = "posts" | "templates" | "applications";
const VIEWS: View[] = ["posts", "templates", "applications"];

const ICONS = {
    page: "inv_misc_grouplooking",
    post: "ability_warrior_battleshout",
    posts: "inv_letter_15",
    templates: "inv_scroll_03",
    applications: "inv_misc_note_01",
    scan: "inv_misc_spyglass_02",
    armory: "inv_misc_book_09",
    wcl: "inv_misc_pocketwatch_01",
};

type TemplateSortKey = "name" | "wanted" | "button" | "posted";
const TEMPLATE_SORT_DEFAULTS: Record<TemplateSortKey, Dir> = { name: "asc", wanted: "asc", button: "asc", posted: "desc" };
type PostSortKey = "channel" | "wanted" | "template" | "source" | "updated";
const POST_SORT_DEFAULTS: Record<PostSortKey, Dir> = { channel: "asc", wanted: "asc", template: "asc", source: "asc", updated: "desc" };
type AppSortKey = "character" | "discord" | "date" | "status";
const APP_SORT_DEFAULTS: Record<AppSortKey, Dir> = { character: "asc", discord: "asc", date: "desc", status: "asc" };
const STATUS_ORDER: Record<string, number> = { neu: 0, offen: 1, archiviert: 2 };

/** "13.09. 22:41" — the lists' compact timestamp. */
function shortStamp(ms: number | undefined): string {
    if (!ms) return "—";
    const d = new Date(ms);
    const date = d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });
    const time = d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
}

const isUrl = (v: string) => /^https?:\/\//i.test((v || "").trim());
const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/** The pencil — a pure UI function, so a line icon. */
function EditIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4z" />
            <path d="m13.5 6.5 4 4" />
        </svg>
    );
}

/** A form label whose explanation sits in the tooltip instead of a hint line under the field. */
function TipLabel({ label, tip, tipSub, htmlFor, extra }: { label: string; tip?: string; tipSub?: string; htmlFor?: string; extra?: ReactNode }) {
    return (
        <label className="rc-label" htmlFor={htmlFor}>
            {tip
                ? <span className="tipped" data-tip={tip} data-tip-sub={tipSub} tabIndex={0}>{label}</span>
                : <span>{label}</span>}
            {extra}
        </label>
    );
}

/** The spec icons a message asks for, named in the tooltip. */
function WantedIcons({ content, data }: { content: string; data: RecruitmentData }) {
    const specs = specsInContent(content, data.specCatalog);
    if (!specs.length) return <span className="csub" data-tip="Keine Specs angegeben" data-tip-sub="Der Text hat keine „## Icon Spec“-Zeilen.">—</span>;
    return (
        <span
            className="rc-specs" tabIndex={0}
            data-tip={specs.map((s) => s.name).join(" · ")}
            data-tip-sub="Aus den „##“-Zeilen des Nachrichtentexts. Ein Klick auf die Zeile öffnet Text und Discord-Vorschau."
        >
            {specs.map((s, i) => {
                const spec = data.specCatalog.find((c) => c.name === s.name);
                return <SpecImg key={i} url={specEmojiUrl(s.iconId, spec ? spec.icon : s.iconName, data.emojis)} />;
            })}
        </span>
    );
}

function SubNav({ view, data, onChange }: { view: View; data: RecruitmentData; onChange: (v: View) => void }) {
    const apps = data.applications;
    const fresh = apps ? apps.filter((a) => a.status === "neu").length : 0;
    const tabs: { id: View; label: string; icon: string; count: ReactNode; accent?: boolean }[] = [
        { id: "posts", label: "Nachrichten", icon: ICONS.posts, count: data.posts.length },
        { id: "templates", label: "Vorlagen", icon: ICONS.templates, count: data.templates.length },
        { id: "applications", label: "Bewerbungen", icon: ICONS.applications, count: apps ? (fresh ? `${apps.length} · ${fresh} neu` : apps.length) : null, accent: fresh > 0 },
    ];
    return (
        <div className="subnav rc-subnav" role="tablist">
            {tabs.map((t) => (
                <button
                    key={t.id} type="button" role="tab" aria-selected={view === t.id}
                    className={`subnav-item${view === t.id ? " active" : ""}`}
                    onClick={() => onChange(t.id)}
                >
                    <WowIcon name={t.icon} size={22} />
                    {t.label}
                    {t.count !== null && t.count !== 0 && <span className={`subnav-count${t.accent ? " accent" : ""}`}>{t.count}</span>}
                </button>
            ))}
        </div>
    );
}

// ---- the editor: fields on the left, the Discord preview on the right ----

/** Wraps the textarea's selection in `before`/`after` (or prefixes its lines). */
function applyFormat(el: HTMLTextAreaElement | null, value: string, kind: "bold" | "italic" | "heading"): { next: string; start: number; end: number } {
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    if (kind === "heading") {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const line = value.slice(lineStart);
        const has = line.startsWith("## ");
        const next = has ? value.slice(0, lineStart) + line.slice(3) : `${value.slice(0, lineStart)}## ${line}`;
        const shift = has ? -3 : 3;
        return { next, start: Math.max(lineStart, start + shift), end: Math.max(lineStart, end + shift) };
    }
    const mark = kind === "bold" ? "**" : "*";
    const next = value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end);
    return { next, start: start + mark.length, end: end + mark.length };
}

function MessageFields({ data, content, setContent, buttonLabel, setButtonLabel, children }: {
    data: RecruitmentData;
    content: string;
    setContent: (v: string) => void;
    buttonLabel: string;
    setButtonLabel: (v: string) => void;
    /** Fields above the specs (the template's name). */
    children?: ReactNode;
}) {
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const format = (kind: "bold" | "italic" | "heading") => {
        const el = contentRef.current;
        const { next, start, end } = applyFormat(el, content, kind);
        setContent(next);
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start, end); });
    };
    const over = content.length > DISCORD_CONTENT_LIMIT;

    return (
        <div className="rc-editor">
            <div className="rc-fields">
                {children}
                <div className="field">
                    <TipLabel
                        label="Gesuchte Specs" tip="Gesuchte Specs"
                        tipSub="Werden oben im Text als „## Icon Spec-Name“ ein- und ausgetragen und bleiben dort frei editierbar."
                    />
                    <SpecPicker value={content} onChange={setContent} specCatalog={data.specCatalog} emojis={data.emojis} />
                </div>
                <div className="field">
                    <TipLabel
                        label="Nachrichtentext" htmlFor="rc-content" tip="Nachrichtentext"
                        tipSub="Der eigentliche Text der Nachricht. Server-Emojis als <:name:id>, Discord-Markdown erlaubt."
                        extra={(
                            <span className={`rc-count mono${over ? " over" : ""}`} data-tip="Zeichen" data-tip-sub={`Discord nimmt höchstens ${DISCORD_CONTENT_LIMIT} Zeichen je Nachricht.`}>
                                {content.length} / {DISCORD_CONTENT_LIMIT}
                            </span>
                        )}
                    />
                    <div className="rc-ta-bar">
                        <EmojiPicker emojis={data.emojis} textareaRef={contentRef} value={content} onChange={setContent} />
                        <IconButton size="sm" icon={<b>B</b>} tip="Fett" tipSub="**Text**" onClick={() => format("bold")} />
                        <IconButton size="sm" icon={<i>I</i>} tip="Kursiv" tipSub="*Text*" onClick={() => format("italic")} />
                        <IconButton size="sm" icon={<span className="mono">##</span>} tip="Überschrift" tipSub="## am Zeilenanfang" onClick={() => format("heading")} />
                    </div>
                    <textarea
                        id="rc-content" ref={contentRef} className="rc-ta" value={content}
                        onChange={(e) => setContent(e.target.value)} placeholder="Nachrichtentext …"
                    />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                    <TipLabel label="Button-Beschriftung" htmlFor="rc-button" tip="Button-Beschriftung" tipSub="Leer lassen für „Jetzt bewerben“." />
                    <input id="rc-button" type="text" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Jetzt bewerben" />
                </div>
            </div>
            <div className="rc-preview">
                <div className="kicker rc-preview-head">
                    Vorschau in Discord
                    <Badge tone="ok" tip="Live" tipSub="Folgt jeder Eingabe links.">live</Badge>
                </div>
                <DiscordPreview content={content} buttonLabel={buttonLabel} emojis={data.emojis} channels={data.channels} />
            </div>
        </div>
    );
}

function DraftBadge({ dirty }: { dirty: boolean }) {
    if (!dirty) return null;
    return (
        <Badge icon={<CheckIcon />} tip="Entwurf gesichert" tipSub="Ungespeicherte Änderungen bleiben in diesem Tab erhalten, bis du speicherst oder abbrichst.">
            Entwurf gesichert
        </Badge>
    );
}

function TemplateEditor({ data, csrfToken, template, postedIn, onSaved, onClose }: {
    data: RecruitmentData;
    csrfToken: string | null;
    /** null while creating. */
    template: RecruitmentTemplate | null;
    postedIn: number;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
    // A recruitment text is written, not filled in — so it is kept as a draft,
    // per template (the "new" form and each edited template have their own).
    const initial = { name: template?.name ?? "", content: template?.content ?? "", buttonLabel: template?.buttonLabel ?? "" };
    const [draft, patch, clearDraft] = useDraftState(`recruitment-template:${template?.id ?? "new"}`, initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const dirty = draft.name !== initial.name || draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveRecruitmentTemplate(csrfToken, { id: template?.id, ...draft });
            clearDraft();
            onSaved(template ? "Vorlage gespeichert." : "Vorlage angelegt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const cancel = () => { clearDraft(); onClose(); };

    return (
        <Modal
            open onClose={onClose} width={1120} icon={ICONS.templates} tone="recruitment" initialFocus="#rc-name"
            kicker={template ? "Vorlage bearbeiten" : "Neue Vorlage"}
            title={draft.name.trim() || template?.name || "Neue Vorlage"}
            hint={(
                <span className="rc-foot-badges">
                    {postedIn > 0 && <Badge tone="accent" icon={ICONS.posts}>in {postedIn} {postedIn === 1 ? "Channel" : "Channels"} gepostet</Badge>}
                    <DraftBadge dirty={dirty} />
                </span>
            )}
            footer={(
                <>
                    <Button variant="ghost" onClick={cancel}>Abbrechen</Button>
                    <Button type="submit" form="rc-template-form" running={busy}>{template ? "Speichern" : "Vorlage anlegen"}</Button>
                </>
            )}
        >
            <form id="rc-template-form" onSubmit={submit}>
                <MessageFields
                    data={data} content={draft.content} setContent={(v) => patch({ content: v })}
                    buttonLabel={draft.buttonLabel} setButtonLabel={(v) => patch({ buttonLabel: v })}
                >
                    <div className="field">
                        <TipLabel label="Name" htmlFor="rc-name" tip="Name" tipSub="Nur zur Auswahl in der Verwaltung — nicht Teil der geposteten Nachricht." />
                        <input id="rc-name" type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="z.B. Heiler für Hyjal & BT" required />
                    </div>
                </MessageFields>
            </form>
        </Modal>
    );
}

function PostEditor({ data, csrfToken, post, templateName, onSaved, onClose }: {
    data: RecruitmentData;
    csrfToken: string | null;
    post: RecruitmentPost;
    templateName: string;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
    // Draft per post, so edits to a live message survive a detour to another tab.
    const initial = { content: post.content, buttonLabel: post.buttonLabel };
    const [draft, patch, clearDraft] = useDraftState(`recruitment-post:${post.id}`, initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const dirty = draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await updateRecruitmentPost(csrfToken, { id: post.id, ...draft });
            clearDraft();
            onSaved("Nachricht in Discord aktualisiert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open onClose={onClose} width={1120} icon={ICONS.posts} tone="recruitment" initialFocus="#rc-content"
            kicker="Gepostete Nachricht bearbeiten"
            title={`#${post.channelName || post.channelId}`}
            hint={(
                <span className="rc-foot-badges">
                    {templateName && <Badge tone="accent" icon={ICONS.templates}>{templateName}</Badge>}
                    <DraftBadge dirty={dirty} />
                </span>
            )}
            footer={(
                <>
                    <Button variant="ghost" icon={<ExternalIcon />} onClick={() => openExternal(messageLink(post.guildId, post.channelId, post.messageId))}>In Discord öffnen</Button>
                    <Button variant="ghost" onClick={() => { clearDraft(); onClose(); }}>Abbrechen</Button>
                    <Button type="submit" form="rc-post-form" running={busy}>Speichern &amp; in Discord aktualisieren</Button>
                </>
            )}
        >
            <form id="rc-post-form" onSubmit={submit}>
                <MessageFields
                    data={data} content={draft.content} setContent={(v) => patch({ content: v })}
                    buttonLabel={draft.buttonLabel} setButtonLabel={(v) => patch({ buttonLabel: v })}
                />
            </form>
        </Modal>
    );
}

function PostDialog({ data, csrfToken, presetTemplateId, onPosted, onClose }: {
    data: RecruitmentData;
    csrfToken: string | null;
    presetTemplateId: string;
    onPosted: (msg: string) => void;
    onClose: () => void;
}) {
    const [target, patchTarget] = useDraftState("recruitment-post-target", { templateId: data.templates[0]?.id ?? "", channelId: "" });
    const [posting, setPosting] = useState(false);
    const toast = useToast();

    // "Posten" on a template row picks that template.
    useEffect(() => {
        if (presetTemplateId) patchTarget({ templateId: presetTemplateId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presetTemplateId]);

    const template = data.templates.find((t) => t.id === target.templateId) || data.templates[0] || null;
    const byCategory = useMemo(() => {
        const groups = new Map<string, TextChannel[]>();
        for (const c of data.channels) {
            const key = c.category || "Ohne Kategorie";
            groups.set(key, [...(groups.get(key) || []), c]);
        }
        return [...groups.entries()];
    }, [data.channels]);

    const ready = !!(data.activeGuildId && template && target.channelId);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!template) return;
        setPosting(true);
        try {
            await postRecruitmentTemplate(csrfToken, { templateId: template.id, channelId: target.channelId });
            onPosted("Nachricht gepostet.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    let body: ReactNode;
    if (!data.activeGuildId) {
        body = <div className="rc-empty"><Badge tone="mid">Kein Server gewählt</Badge><span>Wähle oben einen Server, um eine Nachricht zu posten.</span></div>;
    } else if (!data.templates.length) {
        body = <div className="rc-empty"><Badge tone="mid">Keine Vorlage</Badge><span>Lege zuerst eine Vorlage an, um sie posten zu können.</span></div>;
    } else {
        body = (
            <form id="rc-postdlg-form" onSubmit={submit} className="rc-editor">
                <div className="rc-fields">
                    <div className="field">
                        <TipLabel label="Vorlage" htmlFor="rc-pick-template" />
                        <select id="rc-pick-template" value={template?.id || ""} onChange={(e) => patchTarget({ templateId: e.target.value })} required>
                            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <TipLabel label="Ziel-Channel" htmlFor="rc-pick-channel" tip="Ziel-Channel" tipSub="Der Bot postet die Nachricht dort mit Bewerben-Button und merkt sie sich zum späteren Bearbeiten." />
                        {data.channels.length
                            ? (
                                <select id="rc-pick-channel" value={target.channelId} onChange={(e) => patchTarget({ channelId: e.target.value })} required>
                                    <option value="">— Channel wählen —</option>
                                    {byCategory.map(([cat, list]) => (
                                        <optgroup key={cat} label={cat}>
                                            {list.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            )
                            : (
                                <input
                                    id="rc-pick-channel" type="text" value={target.channelId}
                                    onChange={(e) => patchTarget({ channelId: e.target.value })} placeholder="Channel-ID" required
                                />
                            )}
                    </div>
                    {template && (
                        <div className="rc-postdlg-meta">
                            <span className="kicker">Gesucht</span>
                            <WantedIcons content={template.content} data={data} />
                        </div>
                    )}
                </div>
                <div className="rc-preview">
                    <div className="kicker rc-preview-head">Vorschau in Discord</div>
                    {template && <DiscordPreview content={template.content} buttonLabel={template.buttonLabel} emojis={data.emojis} channels={data.channels} />}
                </div>
            </form>
        );
    }

    return (
        <Modal
            open onClose={onClose} width={data.activeGuildId && data.templates.length ? 1040 : 520}
            icon={ICONS.post} tone="recruitment" kicker="Recruitment" title="Nachricht posten" initialFocus="select, .btn-ghost"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    {data.activeGuildId && data.templates.length > 0 && (
                        <Button type="submit" form="rc-postdlg-form" icon={ICONS.post} running={posting} disabled={!ready}>In Channel posten</Button>
                    )}
                </>
            )}
        >
            {body}
        </Modal>
    );
}

// ---- the three tabs ----

function PostsTab({ data, csrfToken, editor, onChanged, reload }: {
    data: RecruitmentData;
    csrfToken: string | null;
    editor: CollectionEditor;
    onChanged: (msg: string) => void;
    reload: () => void;
}) {
    const ask = useConfirm();
    const { run } = useJobs();
    const toast = useToast();
    const [scanning, setScanning] = useState(false);
    const templateName = (id: string | undefined) => data.templates.find((t) => t.id === id)?.name || "";
    const channelOf = (id: string) => data.channels.find((c) => c.id === id);
    const { sort, dir, onSort, apply } = useTableSort<PostSortKey>("recruitment-posts-sort", POST_SORT_DEFAULTS, "updated");
    const posts = apply(data.posts, (p, key) => {
        switch (key) {
            case "channel": return (p.channelName || p.channelId || "").toLowerCase();
            case "wanted": return specsInContent(p.content, data.specCatalog).map((s) => s.name).join(" ").toLowerCase();
            case "template": return templateName(p.templateId).toLowerCase();
            case "source": return p.source || "";
            default: return p.updatedAt || p.postedAt || 0;
        }
    });

    const scan = async () => {
        setScanning(true);
        const r = await run(
            { label: "Server durchsuchen", icon: ICONS.scan, detail: "Sucht Bot-Nachrichten mit Bewerben-Button", describe: (x: { count: number }) => ({ message: `${x.count} Nachricht(en) gefunden oder aktualisiert.` }) },
            () => scanRecruitmentPosts(csrfToken),
        );
        setScanning(false);
        if (r) reload();
    };

    const removePost = async (p: RecruitmentPost) => {
        if (!(await ask({ title: "Aus der Verwaltung entfernen?", text: `Die Nachricht in #${p.channelName || p.channelId} bleibt in Discord bestehen — sie wird hier nur nicht mehr geführt.`, action: "Entfernen" }))) return;
        try {
            await deleteRecruitmentPost(csrfToken, p.id);
            onChanged("Aus der Verwaltung entfernt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.posts} tone="recruitment" title="Gepostete Nachrichten" crumb="Recruitment › Nachrichten"
                tip="Vom Bot gepostete Nachrichten"
                tipSub="Bearbeiten ändert die Nachricht direkt in Discord. Entfernen nimmt sie nur aus der Verwaltung – die Discord-Nachricht bleibt."
                action={data.activeGuildId
                    ? <Button variant="run" size="sm" icon={ICONS.scan} running={scanning} onClick={scan}>Server durchsuchen</Button>
                    : undefined}
            />
            {data.posts.length
                ? (
                    <div className="rc-tbl">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="channel" label="Channel" sort={sort} dir={dir} onSort={onSort} style={{ width: 230 }} />
                                    <SortTh sortKey="wanted" label="Gesucht" sort={sort} dir={dir} onSort={onSort} tip="Gesuchte Specs" tipSub="Aus den „##“-Zeilen des Texts." style={{ width: 150 }} />
                                    <SortTh sortKey="template" label="Vorlage" sort={sort} dir={dir} onSort={onSort} tip="Vorlage" tipSub="Aus welcher Vorlage gepostet. Per Scan gefundene Nachrichten haben keine." />
                                    <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} tip="Quelle" tipSub="Gepostet = über dieses Menü. Gefunden = beim Durchsuchen des Servers entdeckt." style={{ width: 130 }} />
                                    <SortTh sortKey="updated" label="Aktualisiert" sort={sort} dir={dir} onSort={onSort} style={{ width: 130 }} />
                                    <th style={{ width: 130 }} />
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map((p) => {
                                    const ch = channelOf(p.channelId);
                                    const tpl = templateName(p.templateId);
                                    return (
                                        <tr key={p.id} className="rc-row" onClick={() => editor.startEdit(p.id)}>
                                            <td>
                                                <div className="cname">#{p.channelName || ch?.name || p.channelId}</div>
                                                {ch?.category && <div className="csub">{ch.category}</div>}
                                            </td>
                                            <td><WantedIcons content={p.content} data={data} /></td>
                                            <td>{tpl || <span className="csub">—</span>}</td>
                                            <td>
                                                {p.source === "scan"
                                                    ? <Badge icon={ICONS.scan}>Gefunden</Badge>
                                                    : <Badge tone="accent" icon={ICONS.post}>Gepostet</Badge>}
                                            </td>
                                            <td className="mono csub">{shortStamp(p.updatedAt || p.postedAt)}</td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <div className="rc-acts">
                                                    <IconButton size="sm" icon={<ExternalIcon />} tip="In Discord öffnen" onClick={() => openExternal(messageLink(p.guildId, p.channelId, p.messageId))} />
                                                    <IconButton size="sm" icon={<EditIcon />} tip="Bearbeiten" tipSub="Text und Button — wird direkt in Discord geändert." onClick={() => editor.startEdit(p.id)} />
                                                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Entfernen" tipSub="Nur aus der Verwaltung; die Discord-Nachricht bleibt." onClick={() => removePost(p)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
                : (
                    <div className="rc-empty rc-empty-panel">
                        <Badge>Noch keine Nachrichten</Badge>
                        <span>Poste eine Vorlage oder durchsuche den Server nach Bot-Nachrichten.</span>
                    </div>
                )}
        </>
    );
}

function TemplatesTab({ data, csrfToken, editor, onPost, onChanged }: {
    data: RecruitmentData;
    csrfToken: string | null;
    editor: CollectionEditor;
    onPost: (templateId: string) => void;
    onChanged: (msg: string) => void;
}) {
    const ask = useConfirm();
    const toast = useToast();
    const postedCount = (id: string) => data.posts.filter((p) => p.templateId === id).length;
    const { sort, dir, onSort, apply } = useTableSort<TemplateSortKey>("recruitment-templates-sort", TEMPLATE_SORT_DEFAULTS, "name");
    const templates = apply(data.templates, (t, key) => {
        switch (key) {
            case "name": return (t.name || "").toLowerCase();
            case "wanted": return specsInContent(t.content, data.specCatalog).map((s) => s.name).join(" ").toLowerCase();
            case "button": return (t.buttonLabel || "").toLowerCase();
            default: return postedCount(t.id);
        }
    });

    const remove = async (t: RecruitmentTemplate) => {
        if (!(await ask({ title: "Vorlage löschen?", text: `„${t.name || "(ohne Name)"}" wird gelöscht. Bereits gepostete Nachrichten bleiben bestehen.`, action: "Löschen" }))) return;
        try {
            await deleteRecruitmentTemplate(csrfToken, t.id);
            onChanged("Vorlage gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.templates} tone="recruitment" title="Recruitment-Vorlagen" crumb="Recruitment › Vorlagen"
                tip="Vorlagen-Texte" tipSub="Der Bot nutzt sie beim Posten — hier und über den Discord-Befehl /recruitment."
                action={<Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>Neue Vorlage</Button>}
            />
            {data.templates.length
                ? (
                    <div className="rc-tbl">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="wanted" label="Gesucht" sort={sort} dir={dir} onSort={onSort} tip="Gesuchte Specs" tipSub="Aus den „##“-Zeilen des Texts." style={{ width: 150 }} />
                                    <SortTh sortKey="button" label="Button" sort={sort} dir={dir} onSort={onSort} tip="Button-Beschriftung" tipSub="Leer = „Jetzt bewerben“." style={{ width: 150 }} />
                                    <SortTh sortKey="posted" label="Gepostet" sort={sort} dir={dir} onSort={onSort} tip="Gepostet" tipSub="In wie vielen Channels dieses Servers die Vorlage gerade steht." style={{ width: 110 }} />
                                    <th style={{ width: 200 }} />
                                </tr>
                            </thead>
                            <tbody>
                                {templates.map((t) => {
                                    const n = postedCount(t.id);
                                    return (
                                        <tr key={t.id} className="rc-row" onClick={() => editor.startEdit(t.id)}>
                                            <td><div className="cname">{t.name || "(ohne Name)"}</div></td>
                                            <td><WantedIcons content={t.content} data={data} /></td>
                                            <td className="csub">{t.buttonLabel || "—"}</td>
                                            <td><Badge count tone={n ? "accent" : undefined}>{n}</Badge></td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <div className="rc-acts">
                                                    <Button variant="run" size="sm" icon={ICONS.post} onClick={() => onPost(t.id)}>Posten</Button>
                                                    <IconButton size="sm" icon={<EditIcon />} tip="Bearbeiten" onClick={() => editor.startEdit(t.id)} />
                                                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Löschen" onClick={() => remove(t)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
                : (
                    <div className="rc-empty rc-empty-panel">
                        <Badge>Noch keine Vorlagen</Badge>
                        <Button variant="ghost" size="sm" icon={ICONS.templates} onClick={editor.startNew}>Neue Vorlage</Button>
                    </div>
                )}
        </>
    );
}

function StatusBadge({ status }: { status: string }) {
    if (status === "neu") return <Badge tone="accent" tip="Neu" tipSub="Jünger als 7 Tage.">neu</Badge>;
    if (status === "archiviert") return <Badge tip="Archiviert" tipSub="Der Thread ist in Discord archiviert.">archiviert</Badge>;
    return <Badge tip="Offen" tipSub="Thread aktiv, älter als 7 Tage.">offen</Badge>;
}

/** The class icon on a tile tinted in the class colour (IconTile only knows the area tones). */
function ClassTile({ app }: { app: Application }) {
    const cc = app.classColor ? ({ "--cls": app.classColor } as React.CSSProperties) : undefined;
    return (
        <span className={`itile rc-cls${app.classColor ? " tinted" : " t-none"}`} style={cc} aria-hidden="true">
            <WowIcon name={app.classIcon || "inv_misc_questionmark"} size={22} />
        </span>
    );
}

function ApplicationDetails({ app, onClose }: { app: Application; onClose: () => void }) {
    const who = app.displayName || app.discordName || (app.applicantId ? "Discord-Mitglied" : "—");
    const link = (value: string, icon: string) => {
        const v = (value || "").trim();
        if (!v) return <span className="csub">—</span>;
        return (
            <span className="rc-link">
                <WowIcon name={icon} size={20} />
                {isUrl(v) ? <a className="mlink" href={v} target="_blank" rel="noopener noreferrer">{v.replace(/^https?:\/\//, "")}</a> : v}
            </span>
        );
    };
    return (
        <Modal
            open onClose={onClose} width={680}
            icon={app.classIcon || "inv_misc_questionmark"} tone="none"
            kicker={`Bewerbung · ${shortStamp(app.createdAt)}`}
            title={app.character || app.name || "Bewerbung"}
            hint="Aus dem Thread im Bewerbungs-Channel"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    <a className={buttonClass("primary", "md", true)} href={app.url} target="_blank" rel="noopener noreferrer">
                        <ExternalIcon />Thread in Discord öffnen
                    </a>
                </>
            )}
        >
            <div className="rc-app-badges">
                {app.className && <b className="rc-app-class"><span {...classColorProps(app.classColor)}>{app.className}</span></b>}
                {app.spec && <Badge tone="accent" icon={app.specIcon || undefined}>{app.spec}</Badge>}
                <StatusBadge status={app.status} />
            </div>
            <dl className="rc-meta">
                <dt>Bewerber</dt>
                <dd>{who}{app.discordName && app.discordName !== who && <span className="csub"> (@{app.discordName})</span>}</dd>
                <dt>Armory</dt><dd>{link(app.armory, ICONS.armory)}</dd>
                <dt>WarcraftLogs</dt><dd>{link(app.wcl, ICONS.wcl)}</dd>
            </dl>
            <div className="kicker rc-about-head">Über den Bewerber</div>
            <div className="rc-about">{app.description || <span className="csub">Keine Angabe.</span>}</div>
        </Modal>
    );
}

function ApplicationsTab({ data }: { data: RecruitmentData }) {
    const [openId, setOpenId] = useState("");
    const apps = data.applications || [];
    const { sort, dir, onSort, apply } = useTableSort<AppSortKey>("recruitment-applications-sort", APP_SORT_DEFAULTS, "date");
    const rows = apply(apps, (a, key) => {
        switch (key) {
            case "character": return (a.character || a.name || "").toLowerCase();
            case "discord": return (a.discordName || a.displayName || "").toLowerCase();
            case "status": return STATUS_ORDER[a.status] ?? 9;
            default: return a.createdAt || 0;
        }
    });
    const channel = data.channels.find((c) => c.id === data.applicationChannelId);
    const opened = apps.find((a) => a.threadId === openId) || null;

    let content: ReactNode;
    if (!data.applicationChannelId) {
        content = (
            <div className="rc-empty rc-empty-panel">
                <Badge tone="mid">Kein Bewerbungs-Channel</Badge>
                <span>Lege ihn in den <a className="mlink" href="/settings">Einstellungen</a> fest, damit die Bewerbungen hier erscheinen.</span>
            </div>
        );
    } else if (data.applicationsError) {
        content = <div className="rc-empty rc-empty-panel"><Badge tone="bad">Fehler</Badge><span>{data.applicationsError}</span></div>;
    } else if (!apps.length) {
        content = <div className="rc-empty rc-empty-panel"><Badge>Keine Bewerbungen</Badge><span>In den letzten 6 Wochen kam keine Bewerbung.</span></div>;
    } else {
        content = (
            <div className="rc-tbl">
                <table className="idx">
                    <thead>
                        <tr>
                            <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                            <SortTh sortKey="discord" label="Discord" sort={sort} dir={dir} onSort={onSort} style={{ width: 170 }} />
                            <SortTh sortKey="date" label="Eingereicht" sort={sort} dir={dir} onSort={onSort} style={{ width: 140 }} />
                            <SortTh sortKey="status" label="Status" sort={sort} dir={dir} onSort={onSort} tip="Status" tipSub="neu = jünger als 7 Tage · offen = Thread aktiv · archiviert = Thread archiviert." style={{ width: 120 }} />
                            <th style={{ width: 210 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((a) => (
                            <tr key={a.threadId} className="rc-row" onClick={() => setOpenId(a.threadId)}>
                                <td>
                                    <div className="rc-char">
                                        <ClassTile app={a} />
                                        <div>
                                            <div className="cname"><span {...classColorProps(a.classColor)}>{a.character || a.name || "Bewerbung"}</span></div>
                                            <div className="csub">{a.spec || a.classSpec || "—"}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="csub">{a.discordName ? `@${a.discordName}` : a.displayName || "—"}</td>
                                <td className="mono csub">{shortStamp(a.createdAt)}</td>
                                <td><StatusBadge status={a.status} /></td>
                                <td onClick={(e) => e.stopPropagation()}>
                                    <div className="rc-acts">
                                        {isUrl(a.armory) && <IconButton size="sm" icon={ICONS.armory} tip="Armory" tipSub={a.armory} onClick={() => openExternal(a.armory)} />}
                                        {isUrl(a.wcl) && <IconButton size="sm" icon={ICONS.wcl} tip="WarcraftLogs" tipSub={a.wcl} onClick={() => openExternal(a.wcl)} />}
                                        <Expand open={openId === a.threadId} onToggle={() => setOpenId(openId === a.threadId ? "" : a.threadId)} />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <>
            <PartHead
                icon={ICONS.applications} tone="recruitment" title="Bewerbungen" crumb="Recruitment › Bewerbungen"
                tip="Die letzten 10 Bewerbungen der vergangenen 6 Wochen"
                tipSub="Aus den Threads im Bewerbungs-Channel, neueste zuerst."
                action={data.applicationChannelId && data.activeGuildId
                    ? (
                        <a className={buttonClass("ghost", "sm", true)} href={channelUrl(data.activeGuildId, data.applicationChannelId)} target="_blank" rel="noopener noreferrer">
                            <ExternalIcon />#{channel ? channel.name : "bewerbungen"} öffnen
                        </a>
                    )
                    : undefined}
            />
            {content}
            {opened && <ApplicationDetails app={opened} onClose={() => setOpenId("")} />}
        </>
    );
}

export default function RecruitmentPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const templateEditor = useCollectionEditor("edit");
    const postEditor = useCollectionEditor("editpost");
    const [storedView, setStoredView] = usePersistedSearchParam<View>("recruitment-view", "view", "posts", VIEWS);
    // An open editor forces its own tab: a link to ?edit=<id> lands on the
    // template it names, whichever tab was last open. The posting dialog
    // (?editpost=new) opens over whichever tab it was started from.
    const view: View = templateEditor.open ? "templates" : postEditor.editId ? "posts" : storedView;
    const [presetTemplateId, setPresetTemplateId] = useState("");

    const [data, setData] = useState<RecruitmentData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const toast = useToast();

    const load = () => {
        // The lists carry every template and post in full, so the editors take
        // their entry from there; the server is asked for none.
        getRecruitmentData({ view })
            .then(setData)
            .catch((err: ApiError) => setError(err));
    };

    // Closing an editor reloads too: coming back from a save has to show the
    // changed list, and that is the same transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(load, [view, templateEditor.open === "", postEditor.open === ""]);

    // Switching the tab always leaves whichever editor was open — otherwise it
    // would keep forcing its own tab back on.
    const switchView = (v: View) => setStoredView(v, (p) => { p.delete("edit"); p.delete("editpost"); });

    const afterChange = (msg: string) => {
        toast(msg);
        if (templateEditor.open) templateEditor.close();
        else if (postEditor.open) postEditor.close();
        else load();
    };

    const openPostDialog = (templateId = "") => {
        setPresetTemplateId(templateId);
        postEditor.startNew();
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    // An id that no longer exists (deleted in another tab, stale link) falls
    // back to the new-editor resp. the posting dialog rather than to nothing.
    const editingTemplate = templateEditor.editId ? data.templates.find((t) => t.id === templateEditor.editId) || null : null;
    const editingPost = postEditor.editId ? data.posts.find((p) => p.id === postEditor.editId) || null : null;

    return (
        <div className="rc-page">
            <PageHead
                icon={ICONS.page} tone="recruitment" kicker={data.guildName || "Discord-Server"} title="Recruitment"
                action={<Button icon={ICONS.post} onClick={() => openPostDialog()}>Nachricht posten</Button>}
            />
            <SubNav view={view} data={data} onChange={switchView} />
            {view === "applications" && <ApplicationsTab data={data} />}
            {view === "templates" && (
                <TemplatesTab data={data} csrfToken={csrfToken} editor={templateEditor} onPost={openPostDialog} onChanged={afterChange} />
            )}
            {view === "posts" && (
                <PostsTab data={data} csrfToken={csrfToken} editor={postEditor} onChanged={afterChange} reload={load} />
            )}

            {templateEditor.open && (
                <TemplateEditor
                    key={editingTemplate?.id ?? "new"} data={data} csrfToken={csrfToken} template={editingTemplate}
                    postedIn={editingTemplate ? data.posts.filter((p) => p.templateId === editingTemplate.id).length : 0}
                    onSaved={afterChange} onClose={templateEditor.close}
                />
            )}
            {postEditor.open && editingPost && (
                <PostEditor
                    key={editingPost.id} data={data} csrfToken={csrfToken} post={editingPost}
                    templateName={data.templates.find((t) => t.id === editingPost.templateId)?.name || ""}
                    onSaved={afterChange} onClose={postEditor.close}
                />
            )}
            {postEditor.open && !editingPost && (
                <PostDialog data={data} csrfToken={csrfToken} presetTemplateId={presetTemplateId} onPosted={afterChange} onClose={postEditor.close} />
            )}
        </div>
    );
}
