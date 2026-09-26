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
    groupByCategory, groupName, isTextLike, purposeHint, purposeLabel, rightsStatus,
    TYPE_ANNOUNCEMENT, TYPE_FORUM, TYPE_STAGE, TYPE_TEXT, TYPE_VOICE,
} from "../../lib/channels";
import { useT } from "../../i18n";

// The four dialogs of the Kanäle page (design issue #216): purpose → channels,
// channel → purposes, create a channel, duplicate a channel. Each reports back
// through the toast and asks the page to reload.

function settingsLink(purpose: ChannelPurpose) {
    return `/settings?section=${encodeURIComponent(purpose.section)}`;
}

// ---------------------------------------------------------------------------
// Purpose → channels
// ---------------------------------------------------------------------------

export function PurposeDialog({ purpose, data, onClose, onSaved }: {
    purpose: ChannelPurpose;
    data: ChannelsData;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [selected, setSelected] = useState<string[]>(purpose.ids);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();
    const isCategory = purpose.kind === "category";
    const q = query.trim().toLowerCase();
    const label = purposeLabel(purpose);

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
            await saveChannelPurpose(purpose, selected);
            toast(t("channels.purposeDialog.saved", { label }));
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
            kicker={t("channels.purposeList.dialogKicker")}
            title={t("channels.purposeDialog.title", { label })}
            width={620}
            initialFocus=".kn-search input"
            hint={<><Badge tone="accent" count>{selected.length}</Badge>{` ${t("channels.purposeDialog.selected")}`}</>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={purpose.icon} running={busy} onClick={save}>{t("channels.purposeDialog.save")}</Button>
                </>
            )}
        >
            <div className="kn-dlg-stack">
                <div className="kn-dlg-toolbar">
                    <label className="kn-search">
                        <SearchIcon />
                        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isCategory ? t("channels.purposeDialog.searchCategory") : t("channels.purposeDialog.searchChannel")} aria-label={t("channels.purposeDialog.searchLabel")} />
                    </label>
                    <Badge tone="accent" tip={purpose.multiple ? t("channels.purposeDialog.multipleTip") : t("channels.purposeDialog.singleTip")} tipSub={purposeHint(purpose)}>
                        {purpose.multiple ? t("channels.purposeDialog.multiple") : isCategory ? t("channels.purposeDialog.oneCategory") : t("channels.purposeDialog.oneChannel")}
                    </Badge>
                </div>
                <div className="kn-pick">
                    {!purpose.multiple && (
                        <label className="kn-pick-row none">
                            <input type={inputType} name={`purpose-${purpose.id}`} checked={!selected.length} onChange={() => setSelected([])} />
                            <span className="kn-type" />
                            <span className="kn-pick-name">{t("channels.purposeDialog.noChannel")}</span>
                        </label>
                    )}
                    {isCategory
                        ? categories.map((c) => row(c.id, c.name, { category: true }))
                        : candidates.map((g) => (
                            <div key={g.id || "loose"}>
                                <div className="kn-pick-cat">{groupName(g)}</div>
                                {g.channels.map((c) => row(c.id, c.name, { type: c.type, channel: c }))}
                            </div>
                        ))}
                    {foreign.length > 0 && (
                        <div>
                            <div className="kn-pick-cat">{t("channels.purposeDialog.foreign")}</div>
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
                    {!isCategory && !candidates.length && !foreign.length && <div className="kn-empty">{t("channels.purposeDialog.noChannelMatch")}</div>}
                    {isCategory && !categories.length && <div className="kn-empty">{t("channels.purposeDialog.noCategoryMatch")}</div>}
                </div>
                <div className="kn-dlg-note">
                    {t("channels.purposeDialog.noteBefore")} <Link to={settingsLink(purpose)}>{t("channels.purposeDialog.noteLink")}</Link>{t("channels.purposeDialog.noteAfter")}
                </div>
            </div>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Channel → purposes (the row's "Zweck zuordnen")
// ---------------------------------------------------------------------------

export function AssignChannelDialog({ channel, data, onClose, onSaved }: {
    channel: Channel;
    data: ChannelsData;
    onClose: () => void;
    onSaved: () => void;
}) {
    const channelPurposes = data.purposes.filter((p) => p.kind === "channel");
    const initial = channelPurposes.filter((p) => p.ids.includes(channel.id)).map((p) => p.id);
    const [on, setOn] = useState<string[]>(initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();

    const save = async () => {
        const changed = channelPurposes.filter((p) => on.includes(p.id) !== initial.includes(p.id));
        if (!changed.length) { onClose(); return; }
        setBusy(true);
        try {
            for (const p of changed) {
                const ids = on.includes(p.id)
                    ? (p.multiple ? [...p.ids, channel.id] : [channel.id])
                    : p.ids.filter((id) => id !== channel.id);
                await saveChannelPurpose(p, ids);
            }
            toast(t("channels.assignDialog.saved", { name: channel.name }));
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
            kicker={t("channels.kickerPath", { name: channel.name })}
            title={t("channels.assignDialog.title")}
            width={560}
            initialFocus=".kn-zweck"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon="inv_misc_note_02" running={busy} onClick={save}>{t("channels.purposeDialog.save")}</Button>
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
                                tipSub={replaces ? `${purposeHint(p)}\n${t("channels.assignDialog.replaces", { name: replaces.name || replaces.id })}` : purposeHint(p)}
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

// The label of each option is the channel type's name (channels.types.<type>), translated at render.
const TYPE_OPTIONS = [
    { value: "text", type: TYPE_TEXT },
    { value: "voice", type: TYPE_VOICE },
    { value: "announcement", type: TYPE_ANNOUNCEMENT },
    { value: "forum", type: TYPE_FORUM },
    { value: "stage", type: TYPE_STAGE },
];

/**
 * The type switch with line icons. The shared <Segment> only takes WoW icons,
 * and a channel type has no game meaning — so the same classes, locally.
 */
function TypeSegment({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const t = useT();
    return (
        <div className="seg kn-type-seg" role="radiogroup" aria-label={t("channels.createDialog.type")}>
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
                    {t(`channels.types.${o.type}`)}
                </button>
            ))}
        </div>
    );
}

export function CreateChannelDialog({ data, canAssign, onClose, onDone }: {
    data: ChannelsData;
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
    const t = useT();
    const textLike = type === "text" || type === "announcement";
    const purposes = data.purposes.filter((p) => p.kind === "channel");

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const created = await createChannel({ name, type, parentId });
            const purpose = canAssign && textLike ? purposes.find((p) => p.id === purposeId) : undefined;
            if (purpose) {
                try {
                    await saveChannelPurpose(purpose, purpose.multiple ? [...purpose.ids, created.id] : [created.id]);
                    toast(t("channels.createDialog.createdAssigned", { name: created.name, purpose: purposeLabel(purpose) }));
                } catch (err) {
                    toast(t("channels.createDialog.createdAssignFailed", { name: created.name, error: (err as ApiError).message }), "err");
                }
            } else {
                toast(t("channels.createDialog.created", { name: created.name }));
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
            kicker={t("channels.createDialog.kicker")}
            title={t("channels.createDialog.title")}
            width={600}
            initialFocus="#kn-create-name"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-create" icon="inv_letter_15" running={busy}>{t("channels.createDialog.submit")}</Button>
                </>
            )}
        >
            <form id="kn-create" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-create-name">{t("common.name")}</label>
                    <div className="kn-input"><span>#</span><input id="kn-create-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("channels.createDialog.namePlaceholder")} required /></div>
                </div>
                <div className="kn-field">
                    <label>{t("channels.createDialog.type")}</label>
                    <TypeSegment value={type} onChange={setType} />
                </div>
                <div className="kn-field">
                    <label htmlFor="kn-create-cat">{t("channels.category")}</label>
                    <select id="kn-create-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                        <option value="">{t("channels.noCategoryOption")}</option>
                        {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                {canAssign && textLike && (
                    <div className="kn-field">
                        <label>
                            <span className="tipped" tabIndex={0} data-tip={t("channels.createDialog.assignNow")} data-tip-sub={t("channels.createDialog.assignNowSub")}>{t("channels.createDialog.assignNow")}</span>
                            <span className="kn-opt">{t("channels.optional")}</span>
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
    const t = useT();
    const purposes = data.purposes.filter((p) => p.ids.includes(channel.id));
    return (
        <div className="kn-source">
            <span className="kn-type"><ChannelTypeIcon type={channel.type} /></span>
            <div className="kn-source-text">
                <b>{channel.name}</b>
                <span className="kicker">{channel.category || t("channels.noCategory")}</span>
            </div>
            {purposes.map((p) => <PurposeBadge key={p.id} purpose={p} />)}
        </div>
    );
}

export function DuplicateChannelDialog({ source, data, onClose, onDone }: {
    source: Channel;
    data: ChannelsData;
    onClose: () => void;
    onDone: () => void;
}) {
    const [name, setName] = useState(source.name);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const created = await duplicateChannel({ channelId: source.id, name });
            toast(t("channels.duplicateDialog.done", { name: created.name }));
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
            kicker={t("channels.kickerPath", { name: source.name })}
            title={t("channels.duplicateDialog.title")}
            width={560}
            initialFocus="#kn-dup-name"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-dup" icon={<CopyIcon />} running={busy}>{t("channels.duplicateDialog.submit")}</Button>
                </>
            )}
        >
            <form id="kn-dup" className="kn-dlg-stack" onSubmit={submit}>
                <SourceCard channel={source} data={data} />
                <div className="kn-field">
                    <label htmlFor="kn-dup-name">{t("channels.duplicateDialog.name")}</label>
                    <div className="kn-input"><span>#</span><input id="kn-dup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={source.name} /></div>
                </div>
                <div className="kn-field">
                    <label>{t("channels.duplicateDialog.carried")}</label>
                    <div className="badge-row">
                        <Badge tone="ok" tip={t("channels.duplicateDialog.rights")} tipSub={t("channels.duplicateDialog.rightsSub")}>{t("channels.duplicateDialog.rights")}</Badge>
                        <Badge tone="ok" tip={t("channels.topic")} tipSub={t("channels.duplicateDialog.topicSub")}>{t("channels.topic")}</Badge>
                        <Badge tone="ok" tip={t("channels.slowmode")}>{t("channels.slowmode")}</Badge>
                        <Badge tone="ok" tip={t("channels.category")} tipSub={t("channels.duplicateDialog.categorySub", { where: source.category ? t("common.quoted", { text: source.category }) : t("channels.duplicateDialog.noCategory") })}>{t("channels.category")}</Badge>
                        <Badge className="dashed" tip={t("channels.duplicateDialog.noPurpose")} tipSub={t("channels.duplicateDialog.noPurposeSub")}>{t("channels.duplicateDialog.noPurpose")}</Badge>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
