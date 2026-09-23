import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Channel, ChannelsData } from "../../api";
import { Badge, IconButton } from "../ui";
import { ChevronDownIcon, CopyIcon, SearchIcon, SettingsIcon, TrashIcon } from "../icons";
import { ChannelTypeIcon, PencilIcon } from "./channelBits";
import { channelTip, eventDateLabel, groupByCategory, ownSchemaOf } from "../../lib/channels";
import { normalizeForType } from "../../lib/channelNames";

// The Discord sidebar of the Kanäle page (issue #259): categories that fold,
// channels as one line each — a check box, the type, the name large, the status
// as a badge. Everything else about a channel (event, topic, purposes, rights)
// is its tooltip. A double click on the name (or the pencil) renames in place:
// Enter saves, Esc discards, Discord's naming rules apply while typing.
//
// A channel's threads nest as a third level under it (#361): a small fold
// toggle and a count badge appear only on a channel that has any, its threads
// render right below, indented, with their own row (rename + delete only —
// moving into another category or cloning does not apply to a thread).

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

export function ChannelTree({ data, selected, onSelect, canWrite, onRename, onEdit, onDuplicate, onDelete, onSchema }: {
    data: ChannelsData;
    selected: Set<string>;
    /** Select (true) or deselect (false) these channel ids. */
    onSelect: (ids: string[], on: boolean) => void;
    canWrite: boolean;
    onRename: (channel: Channel, name: string) => void;
    onEdit: (channel: Channel) => void;
    onDuplicate: (channel: Channel) => void;
    /** Delete this channel for good (asks for its name first). */
    onDelete: (channel: Channel) => void;
    /** Open the naming schema of this category. */
    onSchema: (categoryId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [closed, setClosed] = useState<Record<string, boolean>>({});
    const [closedThreads, setClosedThreads] = useState<Record<string, boolean>>({});
    const [editing, setEditing] = useState("");
    const q = query.trim().toLowerCase();
    const archiveId = data.archive?.categoryId || "";

    // The archive has its own tab; the tree is what is in use. A thread whose
    // channel sits in the archive has no home left in the tree either.
    const groups = useMemo(() => {
        const archived = new Set(archiveId ? data.channels.filter((c) => c.parentId === archiveId).map((c) => c.id) : []);
        const visibleChannels = data.channels.filter((c) => (!archiveId || c.parentId !== archiveId) && !archived.has(c.parentId));
        return groupByCategory(
            { categories: data.categories.filter((c) => c.id !== archiveId) },
            visibleChannels,
        )
            .map((g) => ({
                ...g,
                // A search hit on the category name shows all of its channels; otherwise a
                // channel stays visible when it matches or one of its threads does.
                visible: !q || g.name.toLowerCase().includes(q)
                    ? g.channels
                    : g.channels
                        .map((c) => ({ ...c, threads: c.threads.filter((t) => t.name.toLowerCase().includes(q)) }))
                        .filter((c) => c.name.toLowerCase().includes(q) || c.threads.length),
            }))
            .filter((g) => !q || g.visible.length);
    }, [data, archiveId, q]);

    /** A channel row — checkbox, type, name (inline-editable), badges, actions. */
    function renderRow(c: Channel, { nested = false, threadCount = 0, threadsOpen = false, onToggleThreads }: {
        nested?: boolean;
        threadCount?: number;
        threadsOpen?: boolean;
        onToggleThreads?: () => void;
    } = {}) {
        const tip = channelTip(c, data);
        const isSelected = selected.has(c.id);
        return (
            <div key={c.id} className={`kn-row${isSelected ? " sel" : ""}${nested ? " kn-row-thread" : ""}`} data-channel={c.id}>
                {canWrite && (
                    <input
                        type="checkbox"
                        className="kn-cb"
                        checked={isSelected}
                        aria-label={`#${c.name} wählen`}
                        onChange={(e) => onSelect([c.id], e.target.checked)}
                    />
                )}
                {!nested && (threadCount > 0
                    ? (
                        <button
                            type="button"
                            className={`kn-fold-sm${threadsOpen ? " open" : ""}`}
                            aria-expanded={threadsOpen}
                            aria-label={`Threads von #${c.name} ${threadsOpen ? "zuklappen" : "aufklappen"}`}
                            onClick={onToggleThreads}
                        >
                            <ChevronDownIcon />
                        </button>
                    )
                    : <span className="kn-fold-slot" />)}
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
                {threadCount > 0 && (
                    <Badge count tip="Threads" tipSub={`${threadCount} ${threadCount === 1 ? "Thread" : "Threads"} in diesem Kanal.`}>{threadCount}</Badge>
                )}
                <ChannelStatusBadges channel={c} data={data} />
                {canWrite && editing !== c.id && (
                    <span className="kn-row-icons">
                        <IconButton size="sm" icon={<PencilIcon />} tip="Umbenennen" tipSub="Oder Doppelklick auf den Namen. Enter speichert, Esc verwirft." onClick={() => setEditing(c.id)} />
                        {!nested && <IconButton size="sm" icon={<SettingsIcon />} tip="Bearbeiten" tipSub="Name, Thema, Kategorie, Slowmode, Rechte, archivieren." onClick={() => onEdit(c)} />}
                        {!nested && <IconButton size="sm" icon={<CopyIcon />} tip="Duplizieren" tipSub="Klon mit Rechten, Thema und Slowmode in derselben Kategorie." onClick={() => onDuplicate(c)} />}
                        <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Löschen" tipSub="Endgültig aus Discord löschen — mit Namen bestätigen. Zum Aufheben lieber archivieren." onClick={() => onDelete(c)} />
                    </span>
                )}
            </div>
        );
    }

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
                const ids = g.visible.flatMap((c) => [c.id, ...c.threads.map((t) => t.id)]);
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
                            const threadsOpen = q ? true : !closedThreads[c.id];
                            return (
                                <Fragment key={c.id}>
                                    {renderRow(c, {
                                        threadCount: c.threads.length,
                                        threadsOpen,
                                        onToggleThreads: () => setClosedThreads((s) => ({ ...s, [c.id]: threadsOpen })),
                                    })}
                                    {threadsOpen && c.threads.map((t) => renderRow(t, { nested: true }))}
                                </Fragment>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
