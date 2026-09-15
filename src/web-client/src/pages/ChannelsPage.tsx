import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { canAccess, getChannels, type ApiError, type Channel, type ChannelPurpose, type ChannelsData } from "../api";
import type { ShellContext } from "../components/Shell";
import { Badge, Button, Expand, IconButton, IconTile, PageHead, PartHead } from "../components/ui";
import { CheckIcon, CopyIcon, SearchIcon } from "../components/icons";
import {
    ChannelChip, ChannelTypeIcon, PencilIcon, PurposeBadge, StatusBadge, TagIcon,
} from "../components/channels/channelBits";
import {
    AssignChannelDialog, CreateChannelDialog, DuplicateChannelDialog, PurposeDialog,
} from "../components/channels/ChannelDialogs";
import { groupByCategory, isTextLike } from "../lib/channels";
import "../styles/kanaele.css";
import RaidLoader from "../components/ui/RaidLoader";

// Kanäle (design issue #216): what the bot uses which channel for, and every
// channel of the server grouped by Discord category. Creating, duplicating and
// assigning happen in dialogs; the purposes themselves stay settings (stored in
// the admin config, also editable in Einstellungen).

type Dialog =
    | { kind: "purpose"; purpose: ChannelPurpose }
    | { kind: "assign"; channel: Channel }
    | { kind: "duplicate"; channel: Channel }
    | { kind: "create" }
    | null;

function PurposeList({ data, canEdit, onEdit }: {
    data: ChannelsData;
    canEdit: boolean;
    onEdit: (purpose: ChannelPurpose) => void;
}) {
    const { set, missing, warnings } = data.purposeSummary;
    return (
        <section className="kn-part">
            <PartHead
                icon="inv_misc_note_02"
                tone="channels"
                title="Wofür der Bot welche Kanäle nutzt"
                crumb="Kanäle › Zwecke"
                action={(
                    <>
                        <Badge tone="ok" icon={<CheckIcon />}>{set} gesetzt</Badge>
                        {missing > 0 && <Badge tone="bad">{missing} fehlt</Badge>}
                        {warnings > 0 && <Badge tone="mid" tip="Gesetzt, wirkt aber nicht" tipSub="Kanal fehlt oder der Bot darf dort nicht lesen/schreiben — Details am Status.">{warnings} {warnings === 1 ? "Warnung" : "Warnungen"}</Badge>}
                    </>
                )}
            />
            <div className="kn-table" role="table" aria-label="Zwecke">
                <div className="kn-purpose kn-th" role="row">
                    <span role="columnheader" data-tip="Zweck" data-tip-sub="Wofür der Bot die Kanäle benutzt. Hover über den Namen erklärt, was er dort tut.">Zweck</span>
                    <span role="columnheader">Kanal</span>
                    <span role="columnheader" data-tip="Status" data-tip-sub="Ob der Zweck gesetzt ist, der Kanal noch existiert und der Bot dort darf, was er muss.">Status</span>
                    <span role="columnheader" />
                </div>
                {data.purposes.map((p) => (
                    <div key={p.id} className="kn-purpose" role="row" data-purpose={p.id}>
                        <div className="kn-purpose-name">
                            <IconTile icon={p.icon} tone={p.ids.length ? "channels" : "bad"} />
                            <span className="tipped" tabIndex={0} data-tip={p.label} data-tip-sub={p.hint}>{p.label}</span>
                        </div>
                        <div className="kn-chips">
                            {p.items.length
                                ? p.items.map((i) => (
                                    <ChannelChip
                                        key={i.id}
                                        name={i.found ? i.name : i.id}
                                        category={p.kind === "category"}
                                        missing={!i.found}
                                        tip={i.found ? undefined : i.status.label}
                                        tipSub={i.found ? undefined : i.status.tip}
                                    />
                                ))
                                : <span className="kn-muted">nicht gesetzt</span>}
                        </div>
                        <div><StatusBadge status={p.status} /></div>
                        <div className="kn-actions">
                            {canEdit
                                ? <IconButton size="sm" icon={<PencilIcon />} tip={`${p.label} zuordnen`} tipSub={p.multiple ? "Mehrere möglich." : undefined} onClick={() => onEdit(p)} />
                                : (
                                    <Link
                                        className="ibtn sm"
                                        to={`/settings?section=${encodeURIComponent(p.section)}`}
                                        aria-label="In Einstellungen öffnen"
                                        data-tip="In Einstellungen öffnen"
                                        data-tip-sub="Zwecke sind Einstellungen — ändern braucht Schreibrecht auf Einstellungen."
                                    >
                                        <PencilIcon />
                                    </Link>
                                )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function ChannelTree({ data, canAssign, canDuplicate, onAssign, onDuplicate }: {
    data: ChannelsData;
    canAssign: boolean;
    canDuplicate: boolean;
    onAssign: (channel: Channel) => void;
    onDuplicate: (channel: Channel) => void;
}) {
    const [query, setQuery] = useState("");
    const [toggled, setToggled] = useState<Record<string, boolean>>({});
    const q = query.trim().toLowerCase();

    const purposesOf = useMemo(() => {
        const map = new Map<string, ChannelPurpose[]>();
        for (const p of data.purposes) {
            if (p.kind !== "channel") continue;
            for (const id of p.ids) map.set(id, [...(map.get(id) || []), p]);
        }
        return map;
    }, [data.purposes]);
    const eventCategories = data.purposes.find((p) => p.kind === "category");

    const groups = useMemo(() => groupByCategory(data, data.channels)
        .map((g) => ({
            ...g,
            // A search hit on the category name shows all of its channels.
            visible: !q || g.name.toLowerCase().includes(q) ? g.channels : g.channels.filter((c) => c.name.toLowerCase().includes(q)),
        }))
        .filter((g) => !q || g.visible.length), [data, q]);

    return (
        <section className="kn-part">
            <PartHead
                icon="inv_letter_15"
                tone="channels"
                title="Kanäle auf dem Server"
                crumb="Kanäle › Server"
                action={(
                    <label className="kn-search">
                        <SearchIcon />
                        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kanal suchen…" aria-label="Kanal suchen" />
                    </label>
                )}
            />
            <div className="kn-table">
                {!groups.length && <div className="kn-empty">{q ? "Kein Kanal passt zur Suche." : "Keine Kanäle gefunden — ist der Bot verbunden?"}</div>}
                {groups.map((g) => {
                    const assigned = g.channels.flatMap((c) => purposesOf.get(c.id) || []);
                    const open = q ? true : (toggled[g.id] ?? assigned.length > 0);
                    const isEvent = !!g.id && !!eventCategories?.ids.includes(g.id);
                    const blocked = data.connected ? g.channels.filter((c) => isTextLike(c) && c.botCanSend === false) : [];
                    const counts = new Map<string, { purpose: ChannelPurpose; n: number }>();
                    for (const p of assigned) counts.set(p.id, { purpose: p, n: (counts.get(p.id)?.n || 0) + 1 });
                    return (
                        <div key={g.id || "loose"} className="kn-group" data-category={g.id}>
                            <div className="kn-cat-head">
                                <span className="kn-cat-name">{g.name}</span>
                                <Badge count>{g.channels.length}</Badge>
                                {isEvent && eventCategories && <PurposeBadge purpose={eventCategories} label="Event-Kategorie" />}
                                {!open && [...counts.values()].map(({ purpose, n }) => (
                                    <PurposeBadge key={purpose.id} purpose={purpose} label={String(n)} />
                                ))}
                                {blocked.length > 0 && (
                                    <Badge tone="mid" tip="Bot darf nicht schreiben" tipSub={`Kein Recht „Nachrichten senden“ in: ${blocked.map((c) => `#${c.name}`).join(", ")}.`}>
                                        Bot darf nicht schreiben
                                    </Badge>
                                )}
                                <Expand open={open} showLabel={!open} onToggle={() => setToggled((t) => ({ ...t, [g.id]: !open }))} />
                            </div>
                            {open && g.visible.map((c) => {
                                const own = purposesOf.get(c.id) || [];
                                const posts = data.recruitmentPosts[c.id] || 0;
                                return (
                                    <div key={c.id} className="kn-chan-row" data-channel={c.id}>
                                        <span className="kn-type" data-tip={c.typeLabel}><ChannelTypeIcon type={c.type} /></span>
                                        <span className="kn-chan-name">{c.name}</span>
                                        <div className="kn-chips">
                                            {own.map((p) => <PurposeBadge key={p.id} purpose={p} />)}
                                            {posts > 0 && <Badge icon="inv_misc_grouplooking" tip="Recruitment-Aushänge" tipSub="Vom Bot gepostete Recruitment-Nachrichten in diesem Kanal.">{posts} {posts === 1 ? "Aushang" : "Aushänge"}</Badge>}
                                            {c.type !== 0 && <span className="kn-muted">{c.typeLabel}</span>}
                                        </div>
                                        <div className="kn-actions">
                                            {canAssign && isTextLike(c) && (
                                                <IconButton size="sm" icon={<TagIcon />} tip="Zweck zuordnen" tipSub="Diesen Kanal für Raid-Anmeldung, Logs, Bewerbungen oder Höchstgebote einsetzen." onClick={() => onAssign(c)} />
                                            )}
                                            {canDuplicate && (
                                                <IconButton size="sm" icon={<CopyIcon />} tip="Duplizieren" tipSub="Klon mit Rechten, Thema und Slowmode in derselben Kategorie." onClick={() => onDuplicate(c)} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export default function ChannelsPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<ChannelsData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [dialog, setDialog] = useState<Dialog>(null);

    const load = () => {
        getChannels().then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    // The purposes are settings: changing them takes write access to Einstellungen.
    const canEditPurposes = canAccess(user, "settings", "write");
    const canWriteChannels = canAccess(user, "channels", "write");

    const done = () => {
        setDialog(null);
        load();
    };

    if (error) return <div className="empty">Fehler beim Laden der Kanäle: {error.message}</div>;
    if (!data) return <RaidLoader text="Kanäle werden geladen" />;

    if (!data.activeGuildId) {
        return (
            <>
                <PageHead icon="inv_letter_15" tone="channels" kicker="Discord" title="Kanäle" />
                <div className="empty">Wähle oben einen Server, um Kanäle zu verwalten.</div>
            </>
        );
    }

    const kicker = ["Discord", data.guildName, `${data.categories.length} Kategorien`, `${data.channels.length} Kanäle`].filter(Boolean).join(" · ");

    return (
        <div className="kn-page">
            <PageHead
                icon="inv_letter_15"
                tone="channels"
                kicker={kicker}
                title="Kanäle"
                meta={!data.connected ? <Badge tone="mid" tip="Bot nicht verbunden" tipSub="Kanäle und Rechte kommen live aus Discord — ohne Verbindung bleibt die Liste leer.">Bot nicht verbunden</Badge> : undefined}
                action={canWriteChannels ? <Button icon="inv_letter_15" onClick={() => setDialog({ kind: "create" })}>Kanal erstellen</Button> : undefined}
            />

            <PurposeList data={data} canEdit={canEditPurposes} onEdit={(purpose) => setDialog({ kind: "purpose", purpose })} />

            <ChannelTree
                data={data}
                canAssign={canEditPurposes}
                canDuplicate={canWriteChannels}
                onAssign={(channel) => setDialog({ kind: "assign", channel })}
                onDuplicate={(channel) => setDialog({ kind: "duplicate", channel })}
            />

            {dialog?.kind === "purpose" && (
                <PurposeDialog purpose={dialog.purpose} data={data} csrfToken={csrfToken} onClose={() => setDialog(null)} onSaved={done} />
            )}
            {dialog?.kind === "assign" && (
                <AssignChannelDialog channel={dialog.channel} data={data} csrfToken={csrfToken} onClose={() => setDialog(null)} onSaved={done} />
            )}
            {dialog?.kind === "duplicate" && (
                <DuplicateChannelDialog source={dialog.channel} data={data} csrfToken={csrfToken} onClose={() => setDialog(null)} onDone={done} />
            )}
            {dialog?.kind === "create" && (
                <CreateChannelDialog data={data} csrfToken={csrfToken} canAssign={canEditPurposes} onClose={() => setDialog(null)} onDone={done} />
            )}
        </div>
    );
}
