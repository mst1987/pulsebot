import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Channel, ChannelsData } from "../../api";
import { Badge, IconButton } from "../ui";
import { ChevronDownIcon, CopyIcon, SearchIcon, SettingsIcon } from "../icons";
import { ChannelTypeIcon, PencilIcon } from "./channelBits";
import { channelTip, eventDateLabel, groupByCategory, ownSchemaOf } from "../../lib/channels";
import { normalizeForType } from "../../lib/channelNames";

// The Discord sidebar of the Kanäle page (issue #259): categories that fold,
// channels as one line each — a check box, the type, the name large, the status
// as a badge. Everything else about a channel (event, topic, purposes, rights)
// is its tooltip. A double click on the name (or the pencil) renames in place:
// Enter saves, Esc discards, Discord's naming rules apply while typing.

/** A check box that can show "some of them" (the category head). */
function TriCheck({ checked, partial, onChange, label, disabled }: {
    checked: boolean;
    partial: boolean;
    onChange: (on: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = partial && !checked;
    }, [partial, checked]);
    return (
        <input
            ref={ref}
            type="checkbox"
            className="kn-cb"
            checked={checked}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.checked)}
        />
    );
}

/** The status badges of a channel row: Event / vergangen. Nothing else sits in the row. */
export function ChannelStatusBadges({ channel, data }: { channel: Channel; data: ChannelsData }) {
    const ev = data.events?.[channel.id];
    if (!ev) return null;
    return ev.status === "past"
        ? <Badge tone="mid" tip="Vergangenes Event" tipSub={`${ev.title} · ${eventDateLabel(ev.startTime)}. Archivieren räumt den Kanal aus der Liste — gelöscht wird nichts.`}>vergangen</Badge>
        : <Badge tone="ok" tip="Event" tipSub={`${ev.title} · ${eventDateLabel(ev.startTime)}.`}>Event</Badge>;
}

function InlineName({ channel, onSave, onCancel }: {
    channel: Channel;
    onSave: (name: string) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(channel.name);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const name = normalizeForType(draft, channel.type);
            if (!name || name === channel.name) onCancel();
            else onSave(name);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        }
    };
    return (
        <span className="kn-inline-wrap">
            <input
                ref={ref}
                className="kn-inline"
                value={draft}
                aria-label={`Neuer Name für #${channel.name}`}
                onChange={(e) => setDraft(normalizeForType(e.target.value, channel.type, false))}
                onKeyDown={onKey}
                onBlur={onCancel}
            />
            <span className="kn-kicker">Enter speichert · Esc verwirft</span>
        </span>
    );
}

export function ChannelTree({ data, selected, onSelect, canWrite, onRename, onEdit, onDuplicate, onSchema }: {
    data: ChannelsData;
    selected: Set<string>;
    /** Select (true) or deselect (false) these channel ids. */
    onSelect: (ids: string[], on: boolean) => void;
    canWrite: boolean;
    onRename: (channel: Channel, name: string) => void;
    onEdit: (channel: Channel) => void;
    onDuplicate: (channel: Channel) => void;
    /** Open the naming schema of this category. */
    onSchema: (categoryId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [closed, setClosed] = useState<Record<string, boolean>>({});
    const [editing, setEditing] = useState("");
    const q = query.trim().toLowerCase();
    const archiveId = data.archive?.categoryId || "";

    // The archive has its own tab; the tree is what is in use.
    const groups = useMemo(() => groupByCategory(
        { categories: data.categories.filter((c) => c.id !== archiveId) },
        data.channels.filter((c) => !archiveId || c.parentId !== archiveId),
    )
        .map((g) => ({
            ...g,
            // A search hit on the category name shows all of its channels.
            visible: !q || g.name.toLowerCase().includes(q) ? g.channels : g.channels.filter((c) => c.name.toLowerCase().includes(q)),
        }))
        .filter((g) => !q || g.visible.length), [data, archiveId, q]);

    return (
        <div className="kn-tree">
            <div className="kn-tree-tools">
                <label className="kn-search">
                    <SearchIcon />
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kanal suchen…" aria-label="Kanal suchen" />
                </label>
                {canWrite && <span className="kn-kicker">Doppelklick auf den Namen bearbeitet</span>}
            </div>
            {!groups.length && <div className="kn-empty">{q ? "Kein Kanal passt zur Suche." : "Keine Kanäle gefunden — ist der Bot verbunden?"}</div>}
            {groups.map((g) => {
                const open = q ? true : !closed[g.id];
                const ids = g.visible.map((c) => c.id);
                const picked = ids.filter((id) => selected.has(id)).length;
                const categoryPurposes = data.purposes.filter((p) => p.kind === "category" && g.id && p.ids.includes(g.id)).map((p) => p.label);
                return (
                    <div key={g.id || "loose"} className="kn-cat" data-category={g.id}>
                        <div className="kn-cat-row">
                            {canWrite && (
                                <TriCheck
                                    checked={ids.length > 0 && picked === ids.length}
                                    partial={picked > 0}
                                    disabled={!ids.length}
                                    label={`Alle in ${g.name} wählen`}
                                    onChange={(on) => onSelect(ids, on)}
                                />
                            )}
                            <button
                                type="button"
                                className={`kn-fold${open ? " open" : ""}`}
                                aria-expanded={open}
                                aria-label={`${g.name} ${open ? "zuklappen" : "aufklappen"}`}
                                onClick={() => setClosed((c) => ({ ...c, [g.id]: open }))}
                            >
                                <ChevronDownIcon />
                                <span
                                    className="kn-cat-title"
                                    data-tip={g.name}
                                    data-tip-sub={categoryPurposes.length ? `Zweck: ${categoryPurposes.join(", ")}.` : `${g.channels.length} ${g.channels.length === 1 ? "Kanal" : "Kanäle"}.`}
                                >
                                    {g.name}
                                </span>
                            </button>
                            <Badge count>{g.channels.length}</Badge>
                            {categoryPurposes.length > 0 && <Badge className="area">Event-Kategorie</Badge>}
                            {g.id && ownSchemaOf(data, g.id) && (
                                <Badge tip="Eigenes Namensschema" tipSub={`${ownSchemaOf(data, g.id)} — gilt für jeden neuen Event-Kanal dieser Kategorie.`}>Schema</Badge>
                            )}
                            {canWrite && g.id && (
                                <span className="kn-row-icons">
                                    <IconButton
                                        size="sm"
                                        icon={<PencilIcon />}
                                        tip="Namensschema"
                                        tipSub={ownSchemaOf(data, g.id) ? `Neue Event-Kanäle heißen nach ${ownSchemaOf(data, g.id)}.` : "Neue Event-Kanäle heißen wie der letzte Event-Kanal. Hier ein eigenes Schema festlegen."}
                                        onClick={() => onSchema(g.id)}
                                    />
                                </span>
                            )}
                        </div>
                        {open && g.visible.map((c) => {
                            const tip = channelTip(c, data);
                            const isSelected = selected.has(c.id);
                            return (
                                <div key={c.id} className={`kn-row${isSelected ? " sel" : ""}`} data-channel={c.id}>
                                    {canWrite && (
                                        <input
                                            type="checkbox"
                                            className="kn-cb"
                                            checked={isSelected}
                                            aria-label={`#${c.name} wählen`}
                                            onChange={(e) => onSelect([c.id], e.target.checked)}
                                        />
                                    )}
                                    <span className="kn-type"><ChannelTypeIcon type={c.type} /></span>
                                    {editing === c.id
                                        ? (
                                            <InlineName
                                                channel={c}
                                                onCancel={() => setEditing("")}
                                                onSave={(name) => {
                                                    setEditing("");
                                                    onRename(c, name);
                                                }}
                                            />
                                        )
                                        : (
                                            <span
                                                className="kn-name"
                                                tabIndex={0}
                                                data-tip={tip.head}
                                                data-tip-sub={tip.sub}
                                                onDoubleClick={() => canWrite && setEditing(c.id)}
                                                onKeyDown={(e) => {
                                                    if (canWrite && e.key === "F2") setEditing(c.id);
                                                }}
                                            >
                                                {c.name}
                                            </span>
                                        )}
                                    <ChannelStatusBadges channel={c} data={data} />
                                    {canWrite && editing !== c.id && (
                                        <span className="kn-row-icons">
                                            <IconButton size="sm" icon={<PencilIcon />} tip="Umbenennen" tipSub="Oder Doppelklick auf den Namen. Enter speichert, Esc verwirft." onClick={() => setEditing(c.id)} />
                                            <IconButton size="sm" icon={<SettingsIcon />} tip="Bearbeiten" tipSub="Name, Thema, Kategorie, Slowmode, Rechte, archivieren." onClick={() => onEdit(c)} />
                                            <IconButton size="sm" icon={<CopyIcon />} tip="Duplizieren" tipSub="Klon mit Rechten, Thema und Slowmode in derselben Kategorie." onClick={() => onDuplicate(c)} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
