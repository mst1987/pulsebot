import { useEffect, useState, type ReactNode } from "react";
import {
    getDiscordServers, getTalkOverview, updateSettings,
    type AdminConfig, type ApiError, type DiscordServerCard, type DiscordServersData,
    type EventGuildEntry, type TalkOverviewStatus, type TextChannel,
} from "../api";
import { discordServersPatch, overlapBadge, serverCardState, type ServerFields } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import { PlusIcon, TrashIcon } from "./icons";
import RoleSyncPart from "./SettingsRoleSync";
import RemindersPart from "./SettingsReminders";
import TalkOverviewRow from "./SettingsTalkOverview";
import { Modal } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import Badge from "./ui/Badge";
import IconTile from "./ui/IconTile";
import PartHead from "./ui/PartHead";
import RaidLoader from "./ui/RaidLoader";
import { AdminOnlyBadge, ChannelPicker, CheckMark, PenIcon, WarnIcon } from "./settingsUi";
import { FieldLabel } from "./ui/Field";

// Einstellungen → Verbindungen → Discord-Server (#251, #361): any number of
// event servers (event channels, Raid-Helper), each optionally posting its own
// raid overview to a channel on any server — the talk server, another event
// server, or itself — plus one talk server for sign-up per bot and pings. One
// card per configured server answers "is the bot there and may it do its job?"
// at a glance; the rights sit in a tooltip, the ids in a dialog that saves only
// this block. Deliberately little per card — the role sync and the
// per-category sign-up come with their own issues.

const ROLE_TEXT = {
    event: {
        kicker: "Event-Discord",
        tip: "Event-Discord",
        tipSub: "Hier liegen die Event-Kanäle und Raid-Helper. Der Admin-Rollencheck des Menüs läuft gegen den ersten konfigurierten Event-Server.",
    },
    talk: {
        kicker: "Kommunikations-Discord",
        tip: "Kommunikations-Discord",
        tipSub: "Hier wird gesprochen: Anmeldung per Bot und Erinnerungen. Leer = alles läuft auf dem Event-Discord.",
    },
};

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "?";
}

function channelName(channels: TextChannel[], id: string): string {
    if (!id) return "—";
    const found = channels.find((c) => c.id === id);
    return found ? `#${found.name}` : id;
}

/**
 * The channels the messages of "Vielleicht" / "Absagen" may go to: those of
 * every configured event server plus the talk server (every server of the bot
 * while none is picked yet), named with their server when there are several.
 */
function noteChannels(guilds: DiscordServersData["guilds"], guildIds: string[]): TextChannel[] {
    const ids = guildIds.filter(Boolean);
    const picked = ids.length ? guilds.filter((g) => ids.includes(g.id)) : guilds;
    return picked.flatMap((g) => g.channels.map((c) => ({
        ...c,
        category: picked.length > 1 ? [g.name, c.category].filter(Boolean).join(" · ") : c.category,
    })));
}

/**
 * The options of a guild `<select>`: a server the bot is not (or no longer) on
 * stays selectable as its id (so opening and saving the dialog never silently
 * drops a configured server), `exclude` hides ids already picked elsewhere.
 */
function guildSelectOptions(guilds: DiscordServersData["guilds"], value: string, exclude: Set<string>) {
    return (
        <>
            {value && !guilds.some((g) => g.id === value) && <option value={value}>unbekannt ({value})</option>}
            {guilds.filter((g) => !exclude.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </>
    );
}

const NOTE_TIP = "Vielleicht- & Absage-Nachrichten";
const NOTE_TIP_SUB = "Wer in Discord „Vielleicht“ oder „Absagen“ drückt, kann eine kurze Nachricht an die Raidleitung hinterlassen — der Bot postet sie hier. Ob gefragt wird (Pflicht, optional, keine), stellst du je Kategorie unter Kategorien ein.";

export default function DiscordServersSection({ onConfig, icon, crumb }: {
    onConfig: (config: AdminConfig) => void;
    icon: string;
    crumb: string;
}) {
    const [data, setData] = useState<DiscordServersData | null>(null);
    const [statuses, setStatuses] = useState<TalkOverviewStatus[]>([]);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState(false);

    const load = () => {
        getDiscordServers().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
        // One shared fetch for every event server's overview status, instead of
        // each card asking on its own.
        getTalkOverview().then((d) => setStatuses(d.statuses)).catch(() => setStatuses([]));
    };
    useEffect(load, []);

    const onReposted = (status: TalkOverviewStatus) => {
        setStatuses((prev) => {
            const i = prev.findIndex((s) => s.guildId === status.guildId);
            if (i < 0) return [...prev, status];
            return prev.map((s, idx) => (idx === i ? status : s));
        });
    };

    const head = (
        <PartHead
            icon={icon}
            tone="settings"
            title="Discord-Server"
            crumb={`Einstellungen › ${crumb}`}
            tip="Discord-Server"
            tipSub="Der Bot kann mit mehreren Event-Servern arbeiten — jeder mit eigenen Event-Kanälen, Raid-Helper und wahlweise einer eigenen Raid-Übersicht — plus einem Kommunikations-Discord für Anmeldung per Bot und Erinnerungen."
            action={data ? <Button variant="ghost" size="sm" icon={<PenIcon />} onClick={() => setEditing(true)}>Bearbeiten</Button> : undefined}
        />
    );

    if (error) return <>{head}<div className="empty">{error}</div></>;
    if (!data) return <>{head}<RaidLoader compact text="Server werden geprüft" /></>;

    const talkChannels = data.guilds.find((g) => g.id === data.discordServers.talkGuildId)?.channels || [];
    const overlap = overlapBadge(data.overlap);
    const allChannels = data.guilds.flatMap((g) => g.channels);

    return (
        <>
            {head}
            <div className="conn-grid">
                {data.events.length === 0 && <ServerCard card={null} role="event" onEdit={() => setEditing(true)} />}
                {data.events.map((card, i) => {
                    const overviewChannels = data.guilds.find((g) => g.id === card.overviewGuildId)?.channels || [];
                    const hasOverview = !!(card.overviewGuildId && card.overviewChannelId);
                    return (
                        <ServerCard key={card.id} card={card} role="event" label={card.label} onEdit={() => setEditing(true)}>
                            <dl className="conn-rows">
                                {/* Global setting, not per-server: named on the first event card only, so several servers don't repeat it. */}
                                {i === 0 && (
                                    <div>
                                        <dt tabIndex={0} data-tip={NOTE_TIP} data-tip-sub={NOTE_TIP_SUB}>Vielleicht/Absage</dt>
                                        <dd>{channelName(allChannels, data.discordServers.signupNoteChannelId)}</dd>
                                    </div>
                                )}
                                {hasOverview && (
                                    <TalkOverviewRow
                                        guildId={card.id}
                                        targetGuildName={card.overviewGuildName || card.overviewGuildId}
                                        targetChannelName={channelName(overviewChannels, card.overviewChannelId)}
                                        status={statuses.find((s) => s.guildId === card.id) || null}
                                        onReposted={onReposted}
                                    />
                                )}
                            </dl>
                        </ServerCard>
                    );
                })}
                <ServerCard card={data.talk} role="talk" onEdit={() => setEditing(true)}>
                    {data.talk && (
                        <dl className="conn-rows">
                            <div><dt>Erinnerungen</dt><dd>{channelName(talkChannels, data.discordServers.talkPingChannelId)}</dd></div>
                            {overlap && (
                                <div>
                                    <dt>Auch hier</dt>
                                    <dd><Badge tone={overlap.tone || undefined} tip="Mitglieder auf beiden Servern" tipSub={overlap.tip}>{overlap.label}</Badge></dd>
                                </div>
                            )}
                        </dl>
                    )}
                </ServerCard>
            </div>
            {data.events.length > 0 && (
                <div className="srv-add-row">
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setEditing(true)}>Event-Server hinzufügen</Button>
                </div>
            )}

            {/* #264: the role sync needs a talk server; reminders work with one server as well. */}
            {data.talk && <RoleSyncPart onConfig={onConfig} />}
            <RemindersPart onConfig={onConfig} />

            {editing && (
                <ServersModal
                    data={data}
                    onClose={() => setEditing(false)}
                    onSaved={(config) => { onConfig(config); setEditing(false); load(); }}
                />
            )}
        </>
    );
}

/** One server: who it is, whether the bot is there, and which rights it lacks. */
function ServerCard({ card, role, label, onEdit, children }: {
    card: DiscordServerCard | null;
    role: "event" | "talk";
    /** An event server's own name for it, next to its Discord name (#361). */
    label?: string;
    onEdit: () => void;
    children?: ReactNode;
}) {
    const text = ROLE_TEXT[role];
    const state = serverCardState(card, role === "talk");
    const avatar = card && card.iconUrl
        ? <img className="srv-icon" src={card.iconUrl} alt="" />
        : <span className="srv-initials">{card ? initials(card.name || card.id) : "–"}</span>;
    const perms = card && card.permissions;
    const okCount = perms ? perms.filter((p) => p.ok).length : 0;
    // One status badge under the name, carrying the rights in its tooltip — the
    // card used to say "2 Rechte fehlen" in the head and "3 von 5" again below.
    const stateTip = card && perms
        ? { tip: card.missing.length ? `Fehlt: ${card.missing.join(", ")}` : `Alle ${perms.length} Rechte vorhanden`, sub: perms.map((p) => `${p.label}: ${p.ok ? "vorhanden" : "fehlt"}`).join("\n") }
        : { tip: state.label, sub: text.tipSub };

    return (
        <section className="conn-card" data-server={role}>
            <div className="conn-head">
                <IconTile icon={avatar} tone={state.missing ? "mid" : "settings"} />
                <div className="srv-title">
                    <span className="kicker srv-kicker" tabIndex={0} data-tip={text.tip} data-tip-sub={text.tipSub}>
                        {text.kicker}{label && <span className="srv-label"> · {label}</span>}
                    </span>
                    <span className="srv-name" data-tip={card ? card.name || card.id : undefined} data-tip-sub={card ? `Server-ID ${card.id}` : undefined}>
                        {card ? card.name || card.id : role === "talk" ? "Kein zweiter Server" : "Nicht gewählt"}
                    </span>
                    {card && (
                        <span className="srv-state">
                            <Badge tone={state.tone || undefined} icon={state.tone === "ok" ? <CheckMark /> : state.tone === "mid" ? <WarnIcon /> : undefined}
                                tip={stateTip.tip} tipSub={stateTip.sub}>
                                {state.label}{perms && card.missing.length ? ` · ${okCount} von ${perms.length}` : ""}
                            </Badge>
                        </span>
                    )}
                </div>
            </div>
            {card && card.connected && (
                <dl className="conn-rows">
                    <div><dt>Mitglieder</dt><dd>{card.memberCount ?? "—"}</dd></div>
                </dl>
            )}
            {children}
            {!card && (
                <div className="conn-foot">
                    <span className="srv-empty grow">{role === "talk" ? "Anmeldung und Pings laufen auf dem Event-Discord." : "Noch kein Event-Discord gewählt."}</span>
                    <Button size="sm" variant={role === "talk" ? "ghost" : "primary"} onClick={onEdit}>Server wählen</Button>
                </div>
            )}
        </section>
    );
}

/** One event-server row of the edit dialog: which server, its label, and where its own overview posts. */
function EventGuildRow({ entry, index, guilds, exclude, onChange, onRemove }: {
    entry: EventGuildEntry;
    index: number;
    guilds: DiscordServersData["guilds"];
    exclude: Set<string>;
    onChange: (next: EventGuildEntry) => void;
    onRemove: () => void;
}) {
    const targetChannels = guilds.find((g) => g.id === entry.overviewGuildId)?.channels || [];
    return (
        <div className="srv-guild-row">
            <div className="srv-guild-row-head">
                <div className="dlg-field">
                    <FieldLabel htmlFor={`srv-eg-${index}`} tip="Event-Discord" tipSub={ROLE_TEXT.event.tipSub}>Server</FieldLabel>
                    {guilds.length ? (
                        <select id={`srv-eg-${index}`} value={entry.guildId} onChange={(e) => onChange({ ...entry, guildId: e.target.value })}>
                            <option value="">— Server wählen —</option>
                            {guildSelectOptions(guilds, entry.guildId, exclude)}
                        </select>
                    ) : (
                        <input id={`srv-eg-${index}`} type="text" className="mono" value={entry.guildId} placeholder="Discord-Server-ID" onChange={(e) => onChange({ ...entry, guildId: e.target.value })} />
                    )}
                </div>
                <div className="dlg-field">
                    <FieldLabel htmlFor={`srv-eg-label-${index}`} tip="Label" tipSub="Kurzer eigener Name, hilfreich sobald mehrere Event-Server laufen.">Label</FieldLabel>
                    <input id={`srv-eg-label-${index}`} type="text" value={entry.label} placeholder="PvE, PvP, Allianz …" onChange={(e) => onChange({ ...entry, label: e.target.value })} />
                </div>
                <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Event-Server entfernen" onClick={onRemove} />
            </div>
            <div className="srv-guild-row-target">
                <div className="dlg-field">
                    <FieldLabel htmlFor={`srv-eg-og-${index}`} tip="Raid-Übersicht" tipSub="Wo die Raid-Übersicht dieses Servers gepostet wird — der Kommunikations-Discord, ein anderer Event-Server oder er selbst.">Übersicht auf</FieldLabel>
                    {guilds.length ? (
                        <select id={`srv-eg-og-${index}`} value={entry.overviewGuildId} onChange={(e) => onChange({ ...entry, overviewGuildId: e.target.value, overviewChannelId: "" })}>
                            <option value="">— keine Übersicht —</option>
                            {guildSelectOptions(guilds, entry.overviewGuildId, new Set())}
                        </select>
                    ) : (
                        <input id={`srv-eg-og-${index}`} type="text" className="mono" value={entry.overviewGuildId} placeholder="Discord-Server-ID" onChange={(e) => onChange({ ...entry, overviewGuildId: e.target.value })} />
                    )}
                </div>
                <div className="dlg-field">
                    <FieldLabel htmlFor={`srv-eg-oc-${index}`} tip="Raid-Übersicht: Kanal">Kanal</FieldLabel>
                    <ChannelPicker id={`srv-eg-oc-${index}`} value={entry.overviewChannelId} channels={targetChannels} onChange={(overviewChannelId) => onChange({ ...entry, overviewChannelId })} />
                </div>
            </div>
        </div>
    );
}

const emptyEventGuild = (): EventGuildEntry => ({ guildId: "", label: "", overviewGuildId: "", overviewChannelId: "" });

/** Every event server (own overview target each) plus the talk server's two channels, saved on their own. */
function ServersModal({ data, onClose, onSaved }: {
    data: DiscordServersData;
    onClose: () => void;
    onSaved: (config: AdminConfig) => void;
}) {
    const [fields, setFields] = useState<ServerFields>({
        ...data.discordServers,
        eventGuilds: data.discordServers.eventGuilds.map((e) => ({ ...e })),
    });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const guilds = data.guilds;
    const talkChannels = guilds.find((g) => g.id === fields.talkGuildId)?.channels || [];
    const notePicks = noteChannels(guilds, [...fields.eventGuilds.map((e) => e.guildId), fields.talkGuildId]);

    const save = async () => {
        setBusy(true);
        try {
            const { config } = await updateSettings(discordServersPatch(fields) as Partial<AdminConfig>);
            toast("Discord-Server gespeichert.");
            onSaved(config);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const updateRow = (index: number, next: EventGuildEntry) => {
        setFields({ ...fields, eventGuilds: fields.eventGuilds.map((e, i) => (i === index ? next : e)) });
    };
    const removeRow = (index: number) => {
        setFields({ ...fields, eventGuilds: fields.eventGuilds.filter((_, i) => i !== index) });
    };
    const addRow = () => setFields({ ...fields, eventGuilds: [...fields.eventGuilds, emptyEventGuild()] });

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="settings"
            kicker="Verbindung bearbeiten"
            title="Discord-Server"
            width={640}
            initialFocus="select, input"
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
                    <Button onClick={save} disabled={busy}>{busy ? "Speichert…" : "Speichern"}</Button>
                </>
            )}
        >
            <div className="conn-form">
                {!guilds.length && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>Bot offline</Badge>
                        <span>Ohne Verbindung keine Serverliste — die IDs lassen sich trotzdem eintragen.</span>
                    </div>
                )}

                <div className="dlg-field">
                    <FieldLabel tip="Event-Server" tipSub={ROLE_TEXT.event.tipSub}>Event-Server</FieldLabel>
                </div>
                <div className="srv-guild-rows">
                    {fields.eventGuilds.length === 0 && <div className="srv-empty">Noch kein Event-Server.</div>}
                    {fields.eventGuilds.map((entry, i) => {
                        const exclude = new Set([
                            ...fields.eventGuilds.filter((_, j) => j !== i).map((e) => e.guildId),
                            fields.talkGuildId,
                        ].filter(Boolean));
                        return (
                            <EventGuildRow
                                key={i}
                                index={i}
                                entry={entry}
                                guilds={guilds}
                                exclude={exclude}
                                onChange={(next) => updateRow(i, next)}
                                onRemove={() => removeRow(i)}
                            />
                        );
                    })}
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={addRow}>Event-Server hinzufügen</Button>
                </div>

                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-talk" tip={ROLE_TEXT.talk.tip} tipSub={ROLE_TEXT.talk.tipSub}>Kommunikations-Discord</FieldLabel>
                    {guilds.length ? (
                        <select
                            id="srv-talk"
                            value={fields.talkGuildId}
                            onChange={(e) => setFields({ ...fields, talkGuildId: e.target.value, talkPingChannelId: "" })}
                        >
                            <option value="">— kein zweiter Server —</option>
                            {guildSelectOptions(guilds, fields.talkGuildId, new Set(fields.eventGuilds.map((e) => e.guildId).filter(Boolean)))}
                        </select>
                    ) : (
                        <input id="srv-talk" type="text" className="mono" value={fields.talkGuildId} placeholder="Discord-Server-ID" onChange={(e) => setFields({ ...fields, talkGuildId: e.target.value })} />
                    )}
                </div>
                {fields.talkGuildId && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor="srv-ping" tip="Erinnerungen & Pings" tipSub="Kanal für Erinnerungen und Pings. Wer nicht auf dem Server ist, bekommt sie als DM.">Erinnerungen &amp; Pings</FieldLabel>
                        <ChannelPicker id="srv-ping" value={fields.talkPingChannelId} channels={talkChannels} onChange={(talkPingChannelId) => setFields({ ...fields, talkPingChannelId })} />
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor="srv-note" tip={NOTE_TIP} tipSub={NOTE_TIP_SUB}>Vielleicht- &amp; Absage-Nachrichten</FieldLabel>
                    <ChannelPicker id="srv-note" value={fields.signupNoteChannelId} channels={notePicks} placeholder="— nicht posten —"
                        onChange={(signupNoteChannelId) => setFields({ ...fields, signupNoteChannelId })} />
                </div>
            </div>
        </Modal>
    );
}
