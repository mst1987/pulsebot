import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getRecruitmentData, saveRecruitmentTemplate, deleteRecruitmentTemplate,
    postRecruitmentTemplate, updateRecruitmentPost, deleteRecruitmentPost, scanRecruitmentPosts,
    type ApiError, type RecruitmentData, type RecruitmentTemplate, type RecruitmentPost,
} from "../api";
import { usePersistedSearchParam, useDraftState } from "../lib/persistedState";
import { useCollectionEditor, type CollectionEditor } from "../lib/collectionEditor";
import { useTableSort, type Dir } from "../lib/tableSort";
import EmojiPicker from "../components/EmojiPicker";
import SpecPicker from "../components/SpecPicker";
import type { ShellContext } from "../components/Shell";
import { ListSection } from "../components/ListSection";
import { SortTh } from "../components/SortTh";
import { TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";

type View = "posts" | "templates" | "applications";
const VIEWS: View[] = ["posts", "templates", "applications"];

// Both tables sort by their text columns; the trailing button column has
// nothing to order by.
type TemplateSortKey = "name" | "preview";
const TEMPLATE_SORT_DEFAULTS: Record<TemplateSortKey, Dir> = { name: "asc", preview: "asc" };
type PostSortKey = "channel" | "preview" | "source";
const POST_SORT_DEFAULTS: Record<PostSortKey, Dir> = { channel: "asc", preview: "asc", source: "asc" };

function textPreview(s: string, max = 60): string {
    const clean = String(s || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const messageUrl = (p: { guildId: string; channelId: string; messageId: string }) =>
    `https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId}`;

function SubNav({ view, counts, onChange }: { view: View; counts: Record<View, number | null>; onChange: (v: View) => void }) {
    const tabs: { id: View; label: string }[] = [
        { id: "posts", label: "Nachrichten" },
        { id: "templates", label: "Vorlagen" },
        { id: "applications", label: "Bewerbungen" },
    ];
    return (
        <div className="subnav">
            {tabs.map((t) => (
                <button
                    key={t.id} type="button" className={`subnav-item${view === t.id ? " active" : ""}`}
                    onClick={() => onChange(t.id)}
                >
                    {t.label}
                    {!!counts[t.id] && <span className="subnav-count">{counts[t.id]}</span>}
                </button>
            ))}
        </div>
    );
}

function TemplateForm({ data, csrfToken, editing, onSaved, onCancel }: {
    data: RecruitmentData;
    csrfToken: string | null;
    editing: RecruitmentTemplate | null;
    onSaved: (msg: string) => void;
    onCancel: () => void;
}) {
    // A recruitment text is written, not filled in — so it is kept as a draft,
    // per template (the "new" form and each edited template have their own).
    const [draft, patch, clearDraft] = useDraftState(`recruitment-template:${editing?.id ?? "new"}`, {
        name: editing?.name ?? "", content: editing?.content ?? "", buttonLabel: editing?.buttonLabel ?? "",
    });
    const { name, content, buttonLabel } = draft;
    const setContent = (v: string) => patch({ content: v });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const contentRef = useRef<HTMLTextAreaElement>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveRecruitmentTemplate(csrfToken, { id: editing?.id, name, content, buttonLabel });
            // Mirrors the SSR page: after any save (create or edit) it lands back on a
            // blank "Neue Vorlage anlegen" form, since the edit id is dropped either way.
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
                <input type="text" value={name} onChange={(e) => patch({ name: e.target.value })} placeholder="z.B. Heiler-Recruitment" required />
                <div className="hint">Nur zur Auswahl — nicht Teil der geposteten Nachricht.</div>
            </div>
            <div className="field">
                <label>Nachrichtentext</label>
                <textarea ref={contentRef} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Nachrichtentext …" style={{ minHeight: 380 }} />
                <div className="hint">Der eigentliche Nachrichtentext — inkl. Emojis. Custom-Emojis als &lt;:name:id&gt;, Discord-Markdown erlaubt.</div>
                <EmojiPicker emojis={data.emojis} textareaRef={contentRef} value={content} onChange={setContent} />
            </div>
            <div className="field">
                <label>Gesuchte Klassen/Specs</label>
                <SpecPicker value={content} onChange={setContent} specCatalog={data.specCatalog} emojis={data.emojis} />
                <div className="hint">Wird automatisch im Nachrichtentext oben ein-/ausgetragen (Zeile „## Icon Spec-Name") — dort weiterhin frei editierbar.</div>
            </div>
            <div className="field">
                <label>Button-Beschriftung (optional)</label>
                <input type="text" value={buttonLabel} onChange={(e) => patch({ buttonLabel: e.target.value })} placeholder="Jetzt bewerben" />
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{editing ? "Speichern" : "Vorlage anlegen"}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { clearDraft(); onCancel(); }}>Abbrechen</button>
            </div>
        </form>
    );
}

function TemplatesTab({ data, csrfToken, editing, editor, onChanged }: {
    data: RecruitmentData;
    csrfToken: string | null;
    /** The template the server loaded for `?edit=<id>`; null while creating. */
    editing: RecruitmentTemplate | null;
    editor: CollectionEditor;
    onChanged: (msg: string) => void;
}) {
    const { sort, dir, onSort, apply } = useTableSort<TemplateSortKey>("recruitment-templates-sort", TEMPLATE_SORT_DEFAULTS, "name");
    const toast = useToast();
    const templates = apply(data.templates, (t, key) => (
        key === "name" ? (t.name || "").toLowerCase() : textPreview(t.content || t.title).toLowerCase()
    ));

    const remove = async (t: RecruitmentTemplate) => {
        if (!confirm("Vorlage wirklich löschen?")) return;
        try {
            await deleteRecruitmentTemplate(csrfToken, t.id);
            onChanged("Gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <ListSection
            editor={editor}
            entries={data.templates}
            idOf={(t) => t.id}
            title="Recruitment-Vorlagen"
            note={<>Vorlagen-Texte, die der Bot beim Posten nutzt (auch via Discord-Befehl <code>/recruitment</code>).</>}
            newLabel="Neue Vorlage"
            // The entry comes from the server (data.editing), not from the list,
            // since only that one carries the full text.
            editorTitle={() => (editing ? `Vorlage „${editing.name || ""}" bearbeiten` : "Neue Recruitment-Vorlage")}
            editorFor={() => (
                <TemplateForm
                    key={editing?.id ?? "new"} data={data} csrfToken={csrfToken} editing={editing}
                    onSaved={onChanged} onCancel={editor.close}
                />
            )}
        >
            {data.templates.length
                ? (
                    <table className="idx">
                        <thead>
                            <tr>
                                <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="preview" label="Vorschau" sort={sort} dir={dir} onSort={onSort} />
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {templates.map((t) => (
                                <tr key={t.id}>
                                    <td><strong>{t.name || "(ohne Name)"}</strong></td>
                                    <td className="sub" style={{ margin: 0 }}>{textPreview(t.content || t.title)}</td>
                                    <td className="row-actions">
                                        <button className="btn btn-ghost" type="button" onClick={() => editor.startEdit(t.id)}>Bearbeiten</button>
                                        <button className="btn btn-danger" type="button" onClick={() => remove(t)}><TrashIcon />Löschen</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
                : <p className="sub">Noch keine Vorlagen angelegt.</p>}
        </ListSection>
    );
}

function PostEditForm({ data, csrfToken, post, onSaved, onCancel }: {
    data: RecruitmentData;
    csrfToken: string | null;
    post: RecruitmentPost;
    onSaved: (msg: string) => void;
    onCancel: () => void;
}) {
    // Draft per post, so edits to a live message survive a detour to another tab.
    const [draft, patch, clearDraft] = useDraftState(`recruitment-post:${post.id}`, {
        content: post.content, buttonLabel: post.buttonLabel,
    });
    const { content, buttonLabel } = draft;
    const setContent = (v: string) => patch({ content: v });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const contentRef = useRef<HTMLTextAreaElement>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await updateRecruitmentPost(csrfToken, { id: post.id, content, buttonLabel });
            clearDraft();
            onSaved("Nachricht aktualisiert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <h2>Gepostete Nachricht bearbeiten</h2>
            <p className="note">
                In #{post.channelName || post.channelId} ·{" "}
                <a className="mlink" href={messageUrl(post)} target="_blank" rel="noopener noreferrer">Nachricht öffnen</a>.
                {" "}Änderungen werden direkt in Discord aktualisiert.
            </p>
            <form className="card-form" onSubmit={submit}>
                <div className="field">
                    <label>Nachrichtentext</label>
                    <textarea ref={contentRef} value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: 380 }} />
                    <div className="hint">Der eigentliche Nachrichtentext — inkl. Emojis. Custom-Emojis als <code>&lt;:name:id&gt;</code>, Discord-Markdown erlaubt.</div>
                    <EmojiPicker emojis={data.emojis} textareaRef={contentRef} value={content} onChange={setContent} />
                </div>
                <div className="field">
                    <label>Gesuchte Klassen/Specs</label>
                    <SpecPicker value={content} onChange={setContent} specCatalog={data.specCatalog} emojis={data.emojis} />
                    <div className="hint">Wird automatisch im Nachrichtentext oben ein-/ausgetragen — dort weiterhin frei editierbar.</div>
                </div>
                <div className="field">
                    <label>Button-Beschriftung</label>
                    <input type="text" value={buttonLabel} onChange={(e) => patch({ buttonLabel: e.target.value })} placeholder="Jetzt bewerben" />
                </div>
                <div className="row-actions">
                    <button className="btn" type="submit" disabled={busy}>Speichern &amp; in Discord aktualisieren</button>
                    <button className="btn btn-ghost" type="button" onClick={() => { clearDraft(); onCancel(); }}>Abbrechen</button>
                </div>
            </form>
        </>
    );
}

function PostsTab({ data, csrfToken, editingPost, editor, onChanged }: {
    data: RecruitmentData;
    csrfToken: string | null;
    /** The post the server loaded for `?editpost=<id>`; null while posting a new one. */
    editingPost: RecruitmentPost | null;
    editor: CollectionEditor;
    onChanged: (msg: string) => void;
}) {
    const [target, patchTarget] = useDraftState("recruitment-post-target", {
        templateId: data.templates[0]?.id ?? "", channelId: "",
    });
    const { templateId, channelId } = target;
    const [posting, setPosting] = useState(false);
    const [scanning, setScanning] = useState(false);
    const toast = useToast();
    const postSort = useTableSort<PostSortKey>("recruitment-posts-sort", POST_SORT_DEFAULTS, "channel");
    const posts = postSort.apply(data.posts, (p, key) => {
        switch (key) {
            case "channel": return (p.channelName || p.channelId || "").toLowerCase();
            case "preview": return textPreview(p.content || p.title).toLowerCase();
            case "source": return (p.source || "").toLowerCase();
            default: return "";
        }
    });

    const submitPost = async (e: React.FormEvent) => {
        e.preventDefault();
        setPosting(true);
        try {
            await postRecruitmentTemplate(csrfToken, { templateId, channelId });
            onChanged("Nachricht gepostet.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    const scan = async () => {
        setScanning(true);
        try {
            const r = await scanRecruitmentPosts(csrfToken);
            onChanged(`${r.count} Nachricht(en) gefunden/aktualisiert.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setScanning(false);
        }
    };

    const removePost = async (p: RecruitmentPost) => {
        if (!confirm("Aus der Verwaltung entfernen? (Die Discord-Nachricht bleibt bestehen.)")) return;
        try {
            await deleteRecruitmentPost(csrfToken, p.id);
            onChanged("Gelöscht.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // The "post a message" form, shown when the new-editor is open. It is a
    // creation form like any other here: the list is what the tab opens on.
    const postForm = (
        <>
            {!data.activeGuildId && <p className="sub">Wähle oben einen Server, um eine Nachricht zu posten.</p>}
            {data.activeGuildId && !data.templates.length && <p className="sub">Lege zuerst eine Vorlage an, um sie posten zu können.</p>}
            {data.activeGuildId && data.templates.length > 0 && (
                <form className="card-form" onSubmit={submitPost}>
                    <div className="field">
                        <label>Vorlage</label>
                        <select value={templateId} onChange={(e) => patchTarget({ templateId: e.target.value })} required>
                            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label>Ziel-Channel</label>
                        {data.channels.length
                            ? (
                                <select value={channelId} onChange={(e) => patchTarget({ channelId: e.target.value })} required>
                                    <option value="">— Channel wählen —</option>
                                    {data.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                </select>
                            )
                            : (
                                <input
                                    type="text" value={channelId} onChange={(e) => patchTarget({ channelId: e.target.value })}
                                    placeholder="Channel-ID (kein Server gewählt)" required
                                />
                            )}
                    </div>
                    <div className="row-actions">
                        <button className="btn" type="submit" disabled={posting}>{posting ? "Wird gepostet…" : "In Channel posten"}</button>
                        <button className="btn btn-ghost" type="button" onClick={editor.close}>Abbrechen</button>
                    </div>
                </form>
            )}
        </>
    );

    return (
        <ListSection
            editor={editor}
            entries={data.posts}
            idOf={(p) => p.id}
            title="Gepostete Nachrichten"
            note="Vom Bot gepostete Recruitment-Nachrichten. Bearbeiten ändert die Nachricht direkt in Discord."
            newLabel="Nachricht posten"
            editorTitle={() => (editingPost ? `Nachricht in #${editingPost.channelName || editingPost.channelId} bearbeiten` : "Nachricht posten")}
            editorFor={() => (editingPost
                ? <PostEditForm data={data} csrfToken={csrfToken} post={editingPost} onSaved={onChanged} onCancel={editor.close} />
                : postForm)}
        >
            {data.activeGuildId && (
                <div className="row-actions" style={{ marginBottom: 14 }}>
                    <button className="btn btn-ghost" type="button" disabled={scanning} onClick={scan}>
                        {scanning ? "Suche läuft …" : "Server nach Bot-Nachrichten durchsuchen"}
                    </button>
                </div>
            )}
            {data.posts.length
                ? (
                    <table className="idx">
                        <thead>
                            <tr>
                                <SortTh sortKey="channel" label="Channel" sort={postSort.sort} dir={postSort.dir} onSort={postSort.onSort} />
                                <SortTh sortKey="preview" label="Vorschau" sort={postSort.sort} dir={postSort.dir} onSort={postSort.onSort} />
                                <SortTh sortKey="source" label="Quelle" sort={postSort.sort} dir={postSort.dir} onSort={postSort.onSort} />
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {posts.map((p) => (
                                <tr key={p.id}>
                                    <td>#{p.channelName || p.channelId}</td>
                                    <td>
                                        {textPreview(p.content || p.title) || "(kein Text)"} ·{" "}
                                        <a className="mlink" href={messageUrl(p)} target="_blank" rel="noopener noreferrer">öffnen</a>
                                    </td>
                                    <td className="small">{p.source}</td>
                                    <td className="row-actions">
                                        <button className="btn btn-ghost" type="button" onClick={() => editor.startEdit(p.id)}>Bearbeiten</button>
                                        <button className="btn btn-danger" type="button" onClick={() => removePost(p)}><TrashIcon />Entfernen</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
                : <p className="sub">Noch keine geposteten Nachrichten getrackt. Poste eine Vorlage oder durchsuche den Server.</p>}
        </ListSection>
    );
}

function ApplicationLinkCell({ value }: { value: string }) {
    const v = (value || "").trim();
    if (!v) return <span className="sub">—</span>;
    if (/^https?:\/\//i.test(v)) return <a className="mlink" href={v} target="_blank" rel="noopener noreferrer">{v}</a>;
    return <>{v}</>;
}

function ApplicationsTab({ data }: { data: RecruitmentData }) {
    if (!data.applicationChannelId) {
        return <p className="sub">Es ist noch kein Bewerbungs-Channel konfiguriert. Lege ihn in den <a className="mlink" href="/settings">Einstellungen</a> fest, damit die Bewerbungen hier erscheinen.</p>;
    }
    if (data.applicationsError) {
        return <div className="sub" style={{ color: "var(--high)" }}>{data.applicationsError}</div>;
    }
    const apps = data.applications || [];
    if (!apps.length) return <p className="sub">Noch keine Bewerbungen im Bewerbungs-Channel gefunden.</p>;

    return (
        <div className="applist">
            {apps.map((a) => {
                const title = a.character || a.name || "Bewerbung";
                const who = a.displayName || a.discordName || (a.applicantId ? "Discord-Mitglied" : "");
                const whoExtra = a.discordName && a.discordName !== a.displayName ? ` (${a.discordName})` : "";
                const rows = ([
                    ["Bewerber", who ? `${who}${whoExtra}` : ""],
                    ["Charakter", a.character || ""],
                    ["Armory", a.armory ? <ApplicationLinkCell value={a.armory} /> : ""],
                    ["WarcraftLogs", a.wcl ? <ApplicationLinkCell value={a.wcl} /> : ""],
                    ["Über den Bewerber", a.description || ""],
                    ["Eingereicht", a.date || ""],
                ] as [string, React.ReactNode][]).filter(([, v]) => v);
                return (
                    <div className="sheetcard" key={a.threadId}>
                        <div className="app-card-head">
                            <span className="app-name">{title}</span>
                            {a.classSpec && <span className="cat-badge">{a.classSpec}</span>}
                            {a.archived && <span className="lbadge">archiviert</span>}
                            <a className="mlink" style={{ marginLeft: "auto" }} href={a.url} target="_blank" rel="noopener noreferrer">Thread öffnen ↗</a>
                        </div>
                        <dl className="app-meta">
                            {rows.map(([k, v]) => (
                                <div key={k} style={{ display: "contents" }}>
                                    <dt>{k}</dt><dd>{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                );
            })}
        </div>
    );
}

export default function RecruitmentPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const templateEditor = useCollectionEditor("edit");
    const postEditor = useCollectionEditor("editpost");
    const [storedView, setStoredView] = usePersistedSearchParam<View>("recruitment-view", "view", "posts", VIEWS);
    // An open editor forces its own tab: a link to ?edit=<id> lands on the
    // template it names, whichever tab was last open.
    const view: View = templateEditor.open ? "templates" : postEditor.open ? "posts" : storedView;

    const [data, setData] = useState<RecruitmentData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const toast = useToast();

    const load = () => {
        // editId is "" while creating, so the server loads no entry to edit.
        getRecruitmentData({ view, edit: templateEditor.editId, editpost: postEditor.editId })
            .then(setData)
            .catch((err: ApiError) => setError(err));
    };

    // Opening and closing an editor reloads too: coming back from a save has to
    // show the changed list, and that is the same transition.
    useEffect(load, [view, templateEditor.open, templateEditor.editId, postEditor.open, postEditor.editId]);

    // Switching the tab always leaves whichever editor was open — otherwise it
    // would keep forcing its own tab back on.
    const switchView = (v: View) => setStoredView(v, (p) => { p.delete("edit"); p.delete("editpost"); });

    const afterChange = (msg: string) => {
        toast(msg);
        // Back to the list, which reloads it through the effect above. A change
        // made from the list itself (a delete) has to ask for the reload.
        if (templateEditor.open) templateEditor.close();
        else if (postEditor.open) postEditor.close();
        else load();
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <h1 className="page-title">Recruitment</h1>
            <SubNav
                view={view}
                counts={{ posts: data.posts.length, templates: data.templates.length, applications: data.applications ? data.applications.length : null }}
                onChange={switchView}
            />
            {view === "applications"
                ? (
                    <>
                        <h2>Bewerbungen</h2>
                        <p className="note">Bewerbungen aus den Threads im Bewerbungs-Channel — mit allen Details aus dem Bewerbungsformular. Es werden die letzten 10 Bewerbungen der vergangenen 6 Wochen angezeigt (neueste zuerst).</p>
                        <ApplicationsTab data={data} />
                    </>
                )
                : view === "templates"
                    ? (
                        <TemplatesTab
                            data={data} csrfToken={csrfToken} editing={data.editing}
                            editor={templateEditor} onChanged={afterChange}
                        />
                    )
                    : (
                        <PostsTab
                            data={data} csrfToken={csrfToken} editingPost={data.editingPost}
                            editor={postEditor} onChanged={afterChange}
                        />
                    )}
        </>
    );
}
