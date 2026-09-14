import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
    createChannel, duplicateChannel, saveChannelPurpose,
    type ApiError, type Channel, type ChannelPurpose, type ChannelsData,
} from "../../api";
import { Badge, Button, Modal } from "../ui";
import { CopyIcon, SearchIcon } from "../icons";
import { useToast } from "../Jobs";
import { ChannelTypeIcon, PurposeBadge, PurposeChip, StatusBadge } from "./channelBits";
import {
    groupByCategory, isTextLike, rightsStatus,
    TYPE_ANNOUNCEMENT, TYPE_FORUM, TYPE_STAGE, TYPE_TEXT, TYPE_VOICE,
} from "../../lib/channels";

// The four dialogs of the Kanäle page (design issue #216): purpose → channels,
// channel → purposes, create a channel, duplicate a channel. Each reports back
// through the toast and asks the page to reload.

function settingsLink(purpose: ChannelPurpose) {
    return `/settings?section=${encodeURIComponent(purpose.section)}`;
}

// ---------------------------------------------------------------------------
// Purpose → channels
// ---------------------------------------------------------------------------

export function PurposeDialog({ purpose, data, csrfToken, onClose, onSaved }: {
    purpose: ChannelPurpose;
    data: ChannelsData;
    csrfToken: string | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [selected, setSelected] = useState<string[]>(purpose.ids);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const isCategory = purpose.kind === "category";
    const q = query.trim().toLowerCase();

    const toggle = (id: string) => {
        if (purpose.multiple) setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
        else setSelected([id]);
    };

    const candidates = useMemo(() => {
        const channels = data.channels.filter(isTextLike).filter((c) => !q || c.name.toLowerCase().includes(q));
        return groupByCategory(data, channels).filter((g) => g.channels.length);
    }, [data, q]);
    const categories = data.categories.filter((c) => !q || c.name.toLowerCase().includes(q));
    // Stored ids this server does not know — another server's channel, or a deleted
    // one. Listed so saving never drops them silently; unticking removes them.
    const foreign = purpose.items.filter((i) => !i.found);

    const save = async () => {
        setBusy(true);
        try {
            await saveChannelPurpose(csrfToken, purpose, selected);
            toast(`${purpose.label}: Zuordnung gespeichert.`);
            onSaved();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const inputType = purpose.multiple ? "checkbox" : "radio";
    const row = (id: string, label: string, extra: { type?: number; channel?: Channel; category?: boolean }) => {
        const status = extra.channel ? rightsStatus(extra.channel, purpose.need, data.connected) : null;
        return (
            <label key={id} className="kn-pick-row">
                <input type={inputType} name={`purpose-${purpose.id}`} checked={selected.includes(id)} onChange={() => toggle(id)} />
                <span className="kn-type">{extra.category ? null : <ChannelTypeIcon type={extra.type ?? TYPE_TEXT} />}</span>
                <span className="kn-pick-name">{label}</span>
                {status && <StatusBadge status={status} />}
            </label>
        );
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={purpose.icon}
            tone="channels"
            kicker="Kanäle › Zwecke"
            title={`${purpose.label} zuordnen`}
            width={620}
            initialFocus=".kn-search input"
            hint={<><Badge tone="accent" count>{selected.length}</Badge> ausgewählt</>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon={purpose.icon} running={busy} onClick={save}>Zuordnung speichern</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-dlg-toolbar">
                    <label className="kn-search">
                        <SearchIcon />
                        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isCategory ? "Kategorie suchen…" : "Kanal suchen…"} aria-label="Suchen" />
                    </label>
                    <Badge tone="accent" tip={purpose.multiple ? "Mehrere möglich" : "Genau einer"} tipSub={purpose.hint}>
                        {purpose.multiple ? "mehrere möglich" : isCategory ? "eine Kategorie" : "ein Kanal"}
                    </Badge>
                </div>
                <div className="kn-pick">
                    {!purpose.multiple && (
                        <label className="kn-pick-row none">
                            <input type={inputType} name={`purpose-${purpose.id}`} checked={!selected.length} onChange={() => setSelected([])} />
                            <span className="kn-type" />
                            <span className="kn-pick-name">kein Kanal</span>
                        </label>
                    )}
                    {isCategory
                        ? categories.map((c) => row(c.id, c.name, { category: true }))
                        : candidates.map((g) => (
                            <div key={g.id || "loose"}>
                                <div className="kn-pick-cat">{g.name}</div>
                                {g.channels.map((c) => row(c.id, c.name, { type: c.type, channel: c }))}
                            </div>
                        ))}
                    {foreign.length > 0 && (
                        <div>
                            <div className="kn-pick-cat">Nicht auf diesem Server</div>
                            {foreign.map((i) => (
                                <label key={i.id} className="kn-pick-row">
                                    <input type={inputType} name={`purpose-${purpose.id}`} checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
                                    <span className="kn-type" />
                                    <span className="kn-pick-name mono">{i.id}</span>
                                    <StatusBadge status={i.status} />
                                </label>
                            ))}
                        </div>
                    )}
                    {!isCategory && !candidates.length && !foreign.length && <div className="kn-empty">Kein Kanal passt.</div>}
                    {isCategory && !categories.length && <div className="kn-empty">Keine Kategorie passt.</div>}
                </div>
                <div className="kn-dlg-note">
                    Gespeichert als Einstellung — auch unter <Link to={settingsLink(purpose)}>Einstellungen</Link> zu ändern.
                </div>
            </div>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Channel → purposes (the row's "Zweck zuordnen")
// ---------------------------------------------------------------------------

export function AssignChannelDialog({ channel, data, csrfToken, onClose, onSaved }: {
    channel: Channel;
    data: ChannelsData;
    csrfToken: string | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const channelPurposes = data.purposes.filter((p) => p.kind === "channel");
    const initial = channelPurposes.filter((p) => p.ids.includes(channel.id)).map((p) => p.id);
    const [on, setOn] = useState<string[]>(initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const save = async () => {
        const changed = channelPurposes.filter((p) => on.includes(p.id) !== initial.includes(p.id));
        if (!changed.length) { onClose(); return; }
        setBusy(true);
        try {
            for (const p of changed) {
                const ids = on.includes(p.id)
                    ? (p.multiple ? [...p.ids, channel.id] : [channel.id])
                    : p.ids.filter((id) => id !== channel.id);
                await saveChannelPurpose(csrfToken, p, ids);
            }
            toast(`#${channel.name}: Zwecke gespeichert.`);
            onSaved();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_note_02"
            tone="channels"
            kicker={`Kanäle › ${channel.name}`}
            title="Zweck zuordnen"
            width={560}
            initialFocus=".kn-zweck"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon="inv_misc_note_02" running={busy} onClick={save}>Zuordnung speichern</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <SourceCard channel={channel} data={data} />
                <div className="kn-zwecke">
                    {channelPurposes.map((p) => {
                        const replaces = !p.multiple && p.items.find((i) => i.id !== channel.id);
                        return (
                            <PurposeChip
                                key={p.id}
                                purpose={p}
                                on={on.includes(p.id)}
                                onToggle={() => setOn((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                                tipSub={replaces ? `${p.hint}\nErsetzt #${replaces.name || replaces.id}.` : p.hint}
                            />
                        );
                    })}
                </div>
                {(() => {
                    const status = rightsStatus(channel, "send", data.connected);
                    return status && status.tone === "mid" ? <div><StatusBadge status={status} /></div> : null;
                })()}
            </div>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const TYPE_OPTIONS = [
    { value: "text", label: "Text", type: TYPE_TEXT },
    { value: "voice", label: "Voice", type: TYPE_VOICE },
    { value: "announcement", label: "Ankündigung", type: TYPE_ANNOUNCEMENT },
    { value: "forum", label: "Forum", type: TYPE_FORUM },
    { value: "stage", label: "Stage", type: TYPE_STAGE },
];

/**
 * The type switch with line icons. The shared <Segment> only takes WoW icons,
 * and a channel type has no game meaning — so the same classes, locally.
 */
function TypeSegment({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="seg kn-type-seg" role="radiogroup" aria-label="Typ">
            {TYPE_OPTIONS.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={o.value === value}
                    className={`seg-opt${o.value === value ? " active" : ""}`}
                    onClick={() => onChange(o.value)}
                >
                    <ChannelTypeIcon type={o.type} />
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function CreateChannelDialog({ data, csrfToken, canAssign, onClose, onDone }: {
    data: ChannelsData;
    csrfToken: string | null;
    /** Write access to Einstellungen — the purposes are settings. */
    canAssign: boolean;
    onClose: () => void;
    onDone: () => void;
}) {
    const [name, setName] = useState("");
    const [type, setType] = useState("text");
    const [parentId, setParentId] = useState("");
    const [purposeId, setPurposeId] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const textLike = type === "text" || type === "announcement";
    const purposes = data.purposes.filter((p) => p.kind === "channel");

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const created = await createChannel(csrfToken, { name, type, parentId });
            const purpose = canAssign && textLike ? purposes.find((p) => p.id === purposeId) : undefined;
            if (purpose) {
                try {
                    await saveChannelPurpose(csrfToken, purpose, purpose.multiple ? [...purpose.ids, created.id] : [created.id]);
                    toast(`Kanal #${created.name} erstellt und als ${purpose.label} zugeordnet.`);
                } catch (err) {
                    toast(`Kanal #${created.name} erstellt, Zuordnung fehlgeschlagen: ${(err as ApiError).message}`, "err");
                }
            } else {
                toast(`Kanal #${created.name} erstellt.`);
            }
            onDone();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker="Kanäle"
            title="Kanal erstellen"
            width={600}
            initialFocus="#kn-create-name"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-create" icon="inv_letter_15" running={busy}>Kanal erstellen</Button>
                </>
            )}
        >
            <form id="kn-create" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-create-name">Name</label>
                    <div className="kn-input"><span>#</span><input id="kn-create-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. kara-anmeldung" required /></div>
                </div>
                <div className="kn-field">
                    <label>Typ</label>
                    <TypeSegment value={type} onChange={setType} />
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-create-cat">Kategorie</label>
                    <select id="kn-create-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                        <option value="">— keine Kategorie —</option>
                        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                {canAssign && textLike && (
                    <div className="kn-field">
                        <label>
                            <span className="tipped" tabIndex={0} data-tip="Gleich zuordnen" data-tip-sub="Der neue Kanal übernimmt gleich einen Zweck. Bei Zwecken mit nur einem Kanal ersetzt er den bisherigen.">Gleich zuordnen</span>
                            <span className="kn-opt">optional</span>
                        </label>
                        <div className="kn-zwecke">
                            {purposes.map((p) => (
                                <PurposeChip key={p.id} purpose={p} on={purposeId === p.id} onToggle={() => setPurposeId((cur) => (cur === p.id ? "" : p.id))} />
                            ))}
                        </div>
                    </div>
                )}
            </form>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

function SourceCard({ channel, data }: { channel: Channel; data: ChannelsData }) {
    const purposes = data.purposes.filter((p) => p.ids.includes(channel.id));
    return (
        <div className="kn-source">
            <span className="kn-type"><ChannelTypeIcon type={channel.type} /></span>
            <div className="kn-source-text">
                <b>{channel.name}</b>
                <span className="kicker">{channel.category || "Ohne Kategorie"}</span>
            </div>
            {purposes.map((p) => <PurposeBadge key={p.id} purpose={p} />)}
        </div>
    );
}

export function DuplicateChannelDialog({ source, data, csrfToken, onClose, onDone }: {
    source: Channel;
    data: ChannelsData;
    csrfToken: string | null;
    onClose: () => void;
    onDone: () => void;
}) {
    const [name, setName] = useState(source.name);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const created = await duplicateChannel(csrfToken, { channelId: source.id, name });
            toast(`Kanal #${created.name} dupliziert.`);
            onDone();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="channels"
            kicker={`Kanäle › ${source.name}`}
            title="Kanal duplizieren"
            width={560}
            initialFocus="#kn-dup-name"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-dup" icon={<CopyIcon />} running={busy}>Duplizieren</Button>
                </>
            )}
        >
            <form id="kn-dup" className="kn-dlg-stack" onSubmit={submit}>
                <SourceCard channel={source} data={data} />
                <div className="kn-field">
                    <label htmlFor="kn-dup-name">Name des Duplikats</label>
                    <div className="kn-input"><span>#</span><input id="kn-dup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={source.name} /></div>
                </div>
                <div className="kn-field">
                    <label>Wird übernommen</label>
                    <div className="badge-row">
                        <Badge tone="ok" tip="Rechte" tipSub="Die Berechtigungen des Originals, Rolle für Rolle.">Rechte</Badge>
                        <Badge tone="ok" tip="Thema" tipSub="Die Kanalbeschreibung.">Thema</Badge>
                        <Badge tone="ok" tip="Slowmode">Slowmode</Badge>
                        <Badge tone="ok" tip="Kategorie" tipSub={`Das Duplikat landet in ${source.category ? `„${source.category}“` : "keiner Kategorie"}, wie das Original.`}>Kategorie</Badge>
                        <Badge className="dashed" tip="Zweck nicht" tipSub="Wofür der Bot das Original nutzt, geht nicht mit — das Duplikat danach über „Zweck zuordnen“ einsetzen.">Zweck nicht</Badge>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
