import { useEffect, useState, type ReactNode } from "react";
import {
    getDiscordServers, updateSettings,
    type AdminConfig, type ApiError, type DiscordServerCard, type DiscordServersData, type TextChannel,
} from "../api";
import { discordServersPatch, overlapBadge, serverCardState, type ServerFields } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import RoleSyncPart from "./SettingsRoleSync";
import RemindersPart from "./SettingsReminders";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import IconTile from "./ui/IconTile";
import PartHead from "./ui/PartHead";
import RaidLoader from "./ui/RaidLoader";
import { AdminOnlyBadge, ChannelPicker, CheckMark, FieldLabel, PenIcon, WarnIcon } from "./settingsUi";

// Einstellungen → Verbindungen → Discord-Server (#251): which server is the
// event server (event channels, Raid-Helper) and which the talk server
// (overview, sign-up per bot, pings). Two cards that answer "is the bot there
// and may it do its job?" at a glance; the rights sit in a tooltip, the ids in
// a dialog that saves only this block. Deliberately little per card — the role
// sync and the per-category sign-up come with their own issues.

const ROLE_TEXT = {
    event: {
        kicker: "Event-Discord",
        tip: "Event-Discord",
        tipSub: "Hier liegen die Event-Kanäle und Raid-Helper. Gegen diesen Server läuft auch der Admin-Rollencheck des Menüs.",
    },
    talk: {
        kicker: "Kommunikations-Discord",
        tip: "Kommunikations-Discord",
        tipSub: "Hier wird gesprochen: Raid-Übersicht, Anmeldung per Bot und Erinnerungen. Leer = alles läuft auf dem Event-Discord.",
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

export default function DiscordServersSection({ csrfToken, onConfig, icon, crumb }: {
    csrfToken: string | null;
    onConfig: (config: AdminConfig) => void;
    icon: string;
    crumb: string;
}) {
    const [data, setData] = useState<DiscordServersData | null>(null);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState(false);

    const load = () => {
        getDiscordServers().then((d) => { setData(d); setError(""); }).catch((err: ApiError) => setError(err.message));
    };
    useEffect(load, []);

    const head = (
        <PartHead
            icon={icon}
            tone="settings"
            title="Discord-Server"
            crumb={`Einstellungen › ${crumb}`}
            tip="Discord-Server"
            tipSub="Der Bot kann mit zwei Servern arbeiten: Events und Raid-Helper auf dem einen, Übersicht, Anmeldung und Pings auf dem anderen. Ohne zweiten Server läuft alles wie bisher auf einem."
            action={data ? <Button variant="ghost" size="sm" icon={<PenIcon />} onClick={() => setEditing(true)}>Bearbeiten</Button> : undefined}
        />
    );

    if (error) return <>{head}<div className="empty">{error}</div></>;
    if (!data) return <>{head}<RaidLoader compact text="Server werden geprüft" /></>;

    const talkChannels = data.guilds.find((g) => g.id === data.discordServers.talkGuildId)?.channels || [];
    const overlap = overlapBadge(data.overlap);

    return (
        <>
            {head}
            <div className="conn-grid">
                <ServerCard card={data.event} role="event" onEdit={() => setEditing(true)} />
                <ServerCard card={data.talk} role="talk" onEdit={() => setEditing(true)}>
                    {data.talk && (
                        <dl className="conn-rows">
                            <div><dt>Raid-Übersicht</dt><dd>{channelName(talkChannels, data.discordServers.talkOverviewChannelId)}</dd></div>
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

            {/* #264: the role sync needs two servers; reminders work with one as well. */}
            {data.talk && <RoleSyncPart csrfToken={csrfToken} onConfig={onConfig} />}
            <RemindersPart csrfToken={csrfToken} onConfig={onConfig} />

            {editing && (
                <ServersModal
                    data={data}
                    csrfToken={csrfToken}
                    onClose={() => setEditing(false)}
                    onSaved={(config) => { onConfig(config); setEditing(false); load(); }}
                />
            )}
        </>
    );
}

/** One server: who it is, whether the bot is there, and which rights it lacks. */
function ServerCard({ card, role, onEdit, children }: {
    card: DiscordServerCard | null;
    role: "event" | "talk";
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
                    <span className="kicker srv-kicker" tabIndex={0} data-tip={text.tip} data-tip-sub={text.tipSub}>{text.kicker}</span>
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
                    <span className="srv-empty grow">{role === "talk" ? "Übersicht, Anmeldung und Pings laufen auf dem Event-Discord." : "Noch kein Event-Discord gewählt."}</span>
                    <Button size="sm" variant={role === "talk" ? "ghost" : "primary"} onClick={onEdit}>Server wählen</Button>
                </div>
            )}
        </section>
    );
}

/** The ids of both servers and the talk server's two channels, saved on their own. */
function ServersModal({ data, csrfToken, onClose, onSaved }: {
    data: DiscordServersData;
    csrfToken: string | null;
    onClose: () => void;
    onSaved: (config: AdminConfig) => void;
}) {
    const [fields, setFields] = useState<ServerFields>({ ...data.discordServers });
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const guilds = data.guilds;
    const talkChannels = guilds.find((g) => g.id === fields.talkGuildId)?.channels || [];

    const save = async () => {
        setBusy(true);
        try {
            const { config } = await updateSettings(csrfToken, discordServersPatch(fields) as Partial<AdminConfig>);
            toast("Discord-Server gespeichert.");
            onSaved(config);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    // A server the bot is not (or no longer) on stays selectable as its id, so
    // opening and saving the dialog never silently drops a configured server.
    const guildOptions = (value: string, exclude: string) => (
        <>
            {value && !guilds.some((g) => g.id === value) && <option value={value}>unbekannt ({value})</option>}
            {guilds.filter((g) => g.id !== exclude).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </>
    );

    const guildField = (key: "eventGuildId" | "talkGuildId", label: string, empty: string, exclude: string, tip: string, tipSub: string) => (
        <div className="dlg-field">
            <FieldLabel htmlFor={`srv-${key}`} tip={tip} tipSub={tipSub}>{label}</FieldLabel>
            {guilds.length ? (
                <select
                    id={`srv-${key}`}
                    value={fields[key]}
                    onChange={(e) => setFields(key === "talkGuildId"
                        // Another talk server has other channels: the old picks mean nothing there.
                        ? { ...fields, talkGuildId: e.target.value, talkOverviewChannelId: "", talkPingChannelId: "" }
                        : { ...fields, [key]: e.target.value })}
                >
                    <option value="">{empty}</option>
                    {guildOptions(fields[key], exclude)}
                </select>
            ) : (
                <input id={`srv-${key}`} type="text" className="mono" value={fields[key]} placeholder="Discord-Server-ID" onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
            )}
        </div>
    );

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_letter_15"
            tone="settings"
            kicker="Verbindung bearbeiten"
            title="Discord-Server"
            width={580}
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
                {guildField("eventGuildId", "Event-Discord", "— Standard-Server des Bots —", "", ROLE_TEXT.event.tip, ROLE_TEXT.event.tipSub)}
                {guildField("talkGuildId", "Kommunikations-Discord", "— kein zweiter Server —", fields.eventGuildId, ROLE_TEXT.talk.tip, ROLE_TEXT.talk.tipSub)}
                {fields.talkGuildId && (
                    <div className="srv-channels">
                        <div className="dlg-field">
                            <FieldLabel htmlFor="srv-overview" tip="Raid-Übersicht" tipSub="Kanal auf dem Kommunikations-Discord, in dem die Raid-Übersicht steht.">Raid-Übersicht</FieldLabel>
                            <ChannelPicker id="srv-overview" value={fields.talkOverviewChannelId} channels={talkChannels} onChange={(talkOverviewChannelId) => setFields({ ...fields, talkOverviewChannelId })} />
                        </div>
                        <div className="dlg-field">
                            <FieldLabel htmlFor="srv-ping" tip="Erinnerungen & Pings" tipSub="Kanal für Erinnerungen und Pings. Wer nicht auf dem Server ist, bekommt sie als DM.">Erinnerungen &amp; Pings</FieldLabel>
                            <ChannelPicker id="srv-ping" value={fields.talkPingChannelId} channels={talkChannels} onChange={(talkPingChannelId) => setFields({ ...fields, talkPingChannelId })} />
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
