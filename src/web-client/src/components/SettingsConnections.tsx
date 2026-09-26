import { useState, type ReactNode } from "react";
import {
    updateSettings, createIngestToken, deleteIngestToken,
    type AdminConfig, type ApiError, type IngestToken, type SettingsData,
} from "../api";
import { fmtMs } from "../lib/format";
import { useTableSort, type Dir } from "../lib/tableSort";
import { SortTh } from "./SortTh";
import { connectionInputs, connectionPatch, connectionState, visibleConnections, type ConnectionId } from "../lib/settingsLogic";
import { useToast } from "./Jobs";
import { useConfirm, Modal } from "./ui/Modal";
import { Button, IconButton, buttonClass } from "./ui/Button";
import Badge from "./ui/Badge";
import IconTile from "./ui/IconTile";
import PartHead from "./ui/PartHead";
import { CheckIcon, CopyIcon, ExternalIcon, TrashIcon } from "./icons";
import { AdminOnlyBadge, CheckMark, PenIcon, WarnIcon } from "./settingsUi";
import { FieldLabel, InfoTip } from "./ui/Field";
import RaidLoader from "./ui/RaidLoader";
import RaidhelperRetirementCard from "./SettingsRaidhelperRetirement";

// Einstellungen → Verbindungen: one status card per foreign system instead of a
// form per system. The card answers "is it set up?" at a glance; what the
// connection is for sits in the tooltip at its title, the fields in a modal that
// saves only that connection's block (PATCH /api/settings), so it never touches
// the page's unsaved draft. Secrets are never shown — only replaced or cleared.

type Card = {
    id: ConnectionId;
    title: string;
    icon: string;
    tip: string;
    tipSub: string;
    adminOnly: boolean;
    rows: [string, string][];
};

function shortId(id: string): string {
    const v = id.trim();
    return v.length > 12 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v || "—";
}

function since(ms: number): string {
    if (!ms) return "";
    const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (minutes < 60) return `${minutes} Min.`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} Std.`;
    return `${Math.round(hours / 24)} T`;
}

function cards(data: SettingsData, tokens: IngestToken[] | null): Card[] {
    const c = data.config;
    const secret = (has: boolean | undefined) => (has ? "•••••••• gespeichert" : "kein Secret");
    const lastUsed = (tokens || []).filter((t) => t.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    const uploads = (tokens || []).reduce((sum, t) => sum + (t.uses || 0), 0);
    const wclOk = connectionState("wcl", connectionInputs(data, tokens)).tone === "ok";
    const all: Card[] = [
        {
            id: "discord", title: "Discord & Raid-Helper", icon: "inv_letter_15", adminOnly: true,
            tip: "Discord & Raid-Helper",
            tipSub: "Ob der Bot verbunden ist und welcher Raid-Helper-Server die Events liefert. Welcher Discord-Server der Event- und welcher der Kommunikations-Discord ist, steht unter Verbindungen › Discord-Server. Der Raid-Helper-API-Key selbst bleibt in der .env.",
            rows: [
                ["Event-Server", data.servers?.events?.[0]?.name || data.bot?.guildName || c.guildId || "Standard-Server des Bots"],
                ["Raid-Helper", c.raidhelperServerId || "aus der .env"],
                ["Bot", data.bot?.online ? `online${data.bot.readySince ? ` seit ${since(data.bot.readySince)}` : ""}` : "offline"],
            ],
        },
        {
            id: "battlenet", title: "Battle.net / Armory", icon: "inv_chest_plate16", adminOnly: false,
            tip: "Battle.net / Armory",
            tipSub: "Optional: Mit Battle.net-API-Zugang zeigt die Char-Historie das Live-Gear direkt an, und der Loot-Council kann die Armory als Gear-Quelle nutzen.",
            rows: [
                ["Realm", `${c.blizzard.region || "eu"} · ${c.blizzard.realmSlug || "thunderstrike"}`],
                ["Namespace", c.blizzard.namespace || "automatisch"],
                ["Secret", secret(c.blizzard.hasClientSecret)],
            ],
        },
        {
            id: "wcl", title: "Warcraft Logs", icon: "inv_misc_spyglass_02", adminOnly: true,
            tip: "Warcraft Logs API v2",
            tipSub: "Zeichnet im Kampfverlauf je Bosskampf Raid-DPS, Raid-HPS und das Boss-Leben. Alles andere der Log-Auswertung läuft weiter über den v1-Key in der .env.\nDie Kurven erscheinen ab der nächsten Auswertung.",
            rows: [
                ["Client-ID", shortId(c.warcraftlogsV2?.clientId || "")],
                ["Secret", secret(c.warcraftlogsV2?.hasClientSecret)],
                ["Wirkung", wclOk ? "DPS-/HPS-Kurven aktiv" : "keine DPS-/HPS-Kurven"],
            ],
        },
        {
            id: "anthropic", title: "KI-Formulierung", icon: "inv_misc_book_11", adminOnly: true,
            tip: "KI-Formulierung (Anthropic)",
            tipSub: "Claude formuliert die Empfehlungen aus der Log-Auswertung in Klartext für die Raider. Die Regeln entscheiden weiterhin, was aufgefallen ist; nichts geht ohne Freigabe raus.",
            rows: [
                ["Modell", c.anthropic?.model || "claude-opus-5"],
                ["Key", c.anthropic?.hasApiKey ? "•••••••• gespeichert" : "kein Key"],
                ["Wirkung", c.anthropic?.hasApiKey ? "KI-Texte in Empfehlungen" : "nur Regeltexte"],
            ],
        },
        {
            id: "lootsync", title: "Loot-Sync", icon: "inv_misc_punchcards_blue", adminOnly: true,
            tip: "Loot-Sync (Addon)",
            tipSub: "Das WoW-Addon schreibt den Loot von RCLootcouncil und Gargul in seine SavedVariables; das Sync-Tool auf dem Rechner des Raidleaders lädt ihn mit einem dieser Tokens hoch. Hochgeladene Raids landen in Historie & Loot → Addon-Inbox.",
            rows: [
                ["Letzter Upload", lastUsed ? `vor ${since(lastUsed.lastUsedAt)} · ${lastUsed.name}` : tokens ? "noch keiner" : "—"],
                ["Uploads", tokens ? `${uploads} gesamt` : "—"],
                ["Ziel", "Historie › Addon-Inbox"],
            ],
        },
    ];
    const visible = visibleConnections(data.canManageAccess);
    return all.filter((card) => visible.includes(card.id));
}

export default function ConnectionsSection({ data, tokens, onConfig, onTokensChanged, icon, crumb }: {
    data: SettingsData;
    tokens: IngestToken[] | null;
    onConfig: (config: AdminConfig) => void;
    onTokensChanged: () => void;
    icon: string;
    crumb: string;
}) {
    const [editing, setEditing] = useState<ConnectionId | null>(null);
    const inputs = connectionInputs(data, tokens);
    const list = cards(data, tokens);
    const ready = list.filter((card) => !connectionState(card.id, inputs).missing).length;

    return (
        <>
            <PartHead icon={icon} tone="settings" title="Verbindungen" crumb={`Einstellungen › ${crumb} · ${ready} von ${list.length} eingerichtet`} />
            <div className="conn-grid">
                {list.map((card) => {
                    const state = connectionState(card.id, inputs);
                    return (
                        <section className="conn-card" key={card.id} data-conn={card.id}>
                            <div className="conn-head">
                                <IconTile icon={card.icon} tone={state.missing ? "mid" : "settings"} />
                                <div className="conn-title">
                                    <span>{card.title}</span>
                                    <InfoTip head={card.tip} sub={card.tipSub} />
                                </div>
                                <Badge tone={state.tone || undefined} icon={state.tone === "ok" ? <CheckMark /> : state.tone === "mid" ? <WarnIcon /> : undefined}>
                                    {state.label}
                                </Badge>
                            </div>
                            <dl className="conn-rows">
                                {card.rows.map(([k, v]) => (
                                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                                ))}
                            </dl>
                            <div className="conn-foot">
                                {card.adminOnly && <AdminOnlyBadge />}
                                <span className="grow" />
                                {card.id === "lootsync" ? (
                                    <Button variant={state.missing ? "primary" : "ghost"} size="sm" icon={card.icon} onClick={() => setEditing("lootsync")}>
                                        Tokens verwalten
                                    </Button>
                                ) : state.missing ? (
                                    <Button size="sm" icon={card.icon} onClick={() => setEditing(card.id)}>Einrichten</Button>
                                ) : (
                                    <Button variant="ghost" size="sm" icon={<PenIcon />} onClick={() => setEditing(card.id)}>Bearbeiten</Button>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
            {/* #291: the switch-over checklist — full admins only, like the API. */}
            {data.canManageAccess && <RaidhelperRetirementCard />}

            {editing && editing !== "lootsync" && (
                <ConnectionModal
                    id={editing}
                    card={list.find((c) => c.id === editing)!}
                    data={data}
                    onClose={() => setEditing(null)}
                    onSaved={(config) => { onConfig(config); setEditing(null); }}
                />
            )}
            <TokensModal
                open={editing === "lootsync"}
                tokens={tokens}
                onClose={() => setEditing(null)}
                onChanged={onTokensChanged}
            />
        </>
    );
}

type FieldDef = { key: string; label: string; placeholder?: string; tip?: string; tipSub?: string; mono?: boolean };

const FIELDS: Record<Exclude<ConnectionId, "lootsync">, { title: string; fields: FieldDef[]; secret?: FieldDef; link?: [string, string]; missingText: string }> = {
    discord: {
        title: "Discord & Raid-Helper",
        missingText: "Der Bot ist gerade nicht verbunden — Server- und Rollenlisten fehlen, bis er wieder online ist.",
        fields: [
            { key: "raidhelperServerId", label: "Raid-Helper Server-ID", mono: true, placeholder: "Server-ID von raid-helper.xyz", tip: "Raid-Helper Server-ID", tipSub: "Wird für alle Raid-Helper-API-Aufrufe verwendet (Events, Setups, Anmeldungen). Der API-Key selbst bleibt in der .env." },
        ],
    },
    battlenet: {
        title: "Battle.net / Armory",
        missingText: "Ohne Client-ID und Secret zeigt die Char-Historie kein Live-Gear.",
        link: ["https://develop.battle.net/access/clients", "Client anlegen auf develop.battle.net"],
        fields: [
            { key: "clientId", label: "Client-ID", mono: true, placeholder: "Client-ID von develop.battle.net" },
            { key: "region", label: "Region", placeholder: "eu" },
            { key: "realmSlug", label: "Realm-Slug", placeholder: "thunderstrike" },
            { key: "namespace", label: "Profile-Namespace", placeholder: "leer = automatisch", tip: "Profile-Namespace", tipSub: "Leer = automatisch (profile-classicann-<region>). Nur setzen, wenn Blizzard den Namespace ändert." },
        ],
        secret: { key: "clientSecret", label: "Client-Secret", tip: "Client-Secret", tipSub: "Wird nie wieder angezeigt. Ein neuer Wert ersetzt das gespeicherte Secret." },
    },
    wcl: {
        title: "Warcraft Logs (API v2)",
        missingText: "Ohne Client-ID und Secret fehlen im Kampfverlauf die DPS-, HPS- und Boss-Leben-Kurven.",
        link: ["https://www.warcraftlogs.com/api/clients", "Client anlegen auf warcraftlogs.com"],
        fields: [
            { key: "clientId", label: "Client-ID", mono: true, placeholder: "Client-ID von warcraftlogs.com/api/clients" },
        ],
        secret: { key: "clientSecret", label: "Client-Secret", tip: "Client-Secret", tipSub: "Unter warcraftlogs.com/api/clients einen Client ohne Redirect-URL anlegen, „Public Client“ aus lassen." },
    },
    anthropic: {
        title: "KI-Formulierung (Anthropic)",
        missingText: "Ohne API-Key bleiben die Empfehlungen bei den Regeltexten.",
        link: ["https://console.anthropic.com/settings/keys", "Key anlegen auf console.anthropic.com"],
        fields: [
            { key: "model", label: "Modell", mono: true, placeholder: "claude-opus-5", tip: "Modell", tipSub: "Leer = claude-opus-5. Die Formulierung startet auf der Report-Seite unter „Empfehlungen“." },
        ],
        secret: { key: "apiKey", label: "API-Key", tip: "Anthropic API-Key", tipSub: "Wird nie wieder angezeigt. Ein neuer Wert ersetzt den gespeicherten Key." },
    },
};

function initialFields(id: ConnectionId, config: AdminConfig): Record<string, string> {
    if (id === "discord") return { raidhelperServerId: config.raidhelperServerId || "" };
    if (id === "battlenet") {
        const b = config.blizzard;
        return { clientId: b.clientId || "", region: b.region || "", realmSlug: b.realmSlug || "", namespace: b.namespace || "" };
    }
    if (id === "wcl") return { clientId: config.warcraftlogsV2?.clientId || "" };
    if (id === "anthropic") return { model: config.anthropic?.model || "" };
    return {};
}

function hasStoredSecret(id: ConnectionId, config: AdminConfig): boolean {
    if (id === "battlenet") return !!config.blizzard.hasClientSecret;
    if (id === "wcl") return !!config.warcraftlogsV2?.hasClientSecret;
    if (id === "anthropic") return !!config.anthropic?.hasApiKey;
    return false;
}

/** "Verbindung bearbeiten": the fields of one connection, saved on their own. */
function ConnectionModal({ id, card, data, onClose, onSaved }: {
    id: Exclude<ConnectionId, "lootsync">;
    card: Card;
    data: SettingsData;
    onClose: () => void;
    onSaved: (config: AdminConfig) => void;
}) {
    const def = FIELDS[id];
    const [fields, setFields] = useState(() => initialFields(id, data.config));
    // The secret is write-only: a typed value replaces it, "clear" removes it,
    // an untouched field keeps what is stored (undefined in the PATCH).
    const [secretValue, setSecretValue] = useState("");
    const [clearSecret, setClearSecret] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const stored = hasStoredSecret(id, data.config);
    const state = connectionState(id, connectionInputs(data, null));

    const save = async () => {
        setBusy(true);
        const secret = clearSecret ? "" : secretValue.trim() ? secretValue.trim() : undefined;
        try {
            const { config } = await updateSettings(connectionPatch(id, fields, def.secret ? secret : undefined) as Partial<AdminConfig>);
            toast(`${card.title} gespeichert.`);
            onSaved(config);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const input = (f: FieldDef): ReactNode => (
        <div className="dlg-field" key={f.key}>
            <FieldLabel htmlFor={`conn-${id}-${f.key}`} tip={f.tip} tipSub={f.tipSub}>{f.label}</FieldLabel>
            <input
                id={`conn-${id}-${f.key}`}
                type="text"
                className={f.mono ? "mono" : undefined}
                value={fields[f.key] || ""}
                placeholder={f.placeholder}
                autoComplete="off"
                onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
            />
        </div>
    );

    return (
        <Modal
            open
            onClose={onClose}
            icon={card.icon}
            tone={state.missing ? "mid" : "settings"}
            kicker="Verbindung bearbeiten"
            title={def.title}
            width={580}
            initialFocus="input"
            hint={card.adminOnly ? <AdminOnlyBadge /> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
                    <Button onClick={save} disabled={busy}>{busy ? "Speichert…" : "Speichern"}</Button>
                </>
            )}
        >
            <div className="conn-form">
                {(state.missing || state.tone === "mid") && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>{state.label}</Badge>
                        <span>{def.missingText}</span>
                    </div>
                )}
                {def.fields.slice(0, 1).map(input)}
                {def.secret && (
                    <div className="dlg-field">
                        <FieldLabel htmlFor={`conn-${id}-secret`} tip={def.secret.tip} tipSub={def.secret.tipSub}>{def.secret.label}</FieldLabel>
                        <div className="secret-row">
                            <input
                                id={`conn-${id}-secret`}
                                type="password"
                                className="mono"
                                value={secretValue}
                                disabled={clearSecret}
                                autoComplete="new-password"
                                placeholder={clearSecret ? "wird beim Speichern gelöscht" : stored ? "•••••••• gespeichert — leer lassen behält es" : "noch kein Secret hinterlegt"}
                                onChange={(e) => setSecretValue(e.target.value)}
                            />
                            {stored && (
                                <Button variant="ghost" size="sm" icon={clearSecret ? undefined : <TrashIcon />} onClick={() => { setClearSecret(!clearSecret); setSecretValue(""); }}>
                                    {clearSecret ? "Behalten" : "Löschen"}
                                </Button>
                            )}
                        </div>
                        <div className="note">Wird nie wieder angezeigt, nur ersetzt oder gelöscht.</div>
                    </div>
                )}
                {def.fields.slice(1).map(input)}
                {def.link && (
                    <div>
                        <a className={buttonClass("ghost", "sm", true)} href={def.link[0]} target="_blank" rel="noopener noreferrer">
                            <ExternalIcon />{def.link[1]}
                        </a>
                    </div>
                )}
            </div>
        </Modal>
    );
}

type TokenSortKey = "name" | "created" | "lastUsed" | "uses";
const TOKEN_SORT_DEFAULTS: Record<TokenSortKey, Dir> = { name: "asc", created: "desc", lastUsed: "desc", uses: "desc" };

/** Loot-Sync tokens: mint one (shown exactly once), revoke one behind a confirm. */
function TokensModal({ open, tokens, onClose, onChanged }: {
    open: boolean;
    tokens: IngestToken[] | null;
    onClose: () => void;
    onChanged: () => void;
}) {
    const ask = useConfirm();
    const toast = useToast();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    // The plaintext of the token just created — only in this state, gone on reload.
    const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const close = () => { setFresh(null); setCopied(false); onClose(); };

    const create = async () => {
        setBusy(true);
        try {
            const r = await createIngestToken(name);
            setFresh({ token: r.token, name: r.record.name });
            setName("");
            setCopied(false);
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (t: IngestToken) => {
        if (!(await ask({ title: `Token „${t.name}“ zurückziehen?`, text: "Das Sync-Tool, das ihn benutzt, kann danach nichts mehr hochladen.", action: "Zurückziehen", tone: "danger" }))) return;
        try {
            await deleteIngestToken(t.id);
            onChanged();
            toast(`Token „${t.name}“ zurückgezogen.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // Default "zuletzt benutzt": the question this table answers is usually
    // "welcher Rechner lädt eigentlich noch hoch?".
    const { sort, dir, onSort, apply } = useTableSort<TokenSortKey>("settings-ingest-tokens-sort", TOKEN_SORT_DEFAULTS, "lastUsed");
    const sorted = apply(tokens || [], (t, key) => {
        switch (key) {
            case "name": return t.name.toLowerCase();
            case "created": return t.createdAt || 0;
            case "uses": return t.uses || 0;
            default: return t.lastUsedAt || 0;
        }
    });

    return (
        <Modal
            open={open}
            onClose={close}
            icon="inv_misc_punchcards_blue"
            tone="settings"
            kicker="Verbindung bearbeiten"
            title="Loot-Sync-Tokens"
            width={720}
            hint={<AdminOnlyBadge />}
            footer={<Button variant="ghost" onClick={close}>Fertig</Button>}
        >
            <div className="conn-form">
                {fresh && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>nur einmal sichtbar</Badge>
                        <div className="fresh-token">
                            <span>Token „{fresh.name}“ erstellt — jetzt kopieren, er liegt nur als Hash auf dem Server.</span>
                            <div className="secret-row">
                                <input type="text" readOnly className="mono" value={fresh.token} onFocus={(e) => e.target.select()} />
                                <IconButton
                                    icon={copied ? <CheckIcon /> : <CopyIcon />}
                                    tip={copied ? "Kopiert" : "Token kopieren"}
                                    onClick={() => { navigator.clipboard?.writeText(fresh.token); setCopied(true); }}
                                />
                            </div>
                        </div>
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor="token-name" tip="Neues Token" tipSub="Ein Name pro Rechner, damit ein einzelner gezielt zurückgezogen werden kann.">Neues Token</FieldLabel>
                    <div className="secret-row">
                        <input id="token-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Raidlead-PC" />
                        <Button icon="inv_misc_punchcards_blue" onClick={create} disabled={busy}>{busy ? "Erstellt…" : "Token erstellen"}</Button>
                    </div>
                </div>
                {!tokens ? <RaidLoader compact text="Tokens werden geladen" /> : !tokens.length ? (
                    <div className="empty">Noch kein Token erstellt.</div>
                ) : (
                    <div className="table-scroll">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                    <th data-tip="Token" data-tip-sub="Die letzten vier Zeichen, damit mehrere Tokens unterscheidbar bleiben.">Token</th>
                                    <SortTh sortKey="created" label="Erstellt" sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="lastUsed" label="Zuletzt benutzt" sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="uses" label="Uploads" sort={sort} dir={dir} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((t) => (
                                    <tr key={t.id}>
                                        <td><strong>{t.name}</strong></td>
                                        <td className="mono">ehl_…{t.hint}</td>
                                        <td className="small" data-tip={t.createdBy ? `von ${t.createdBy}` : undefined}>{fmtMs(t.createdAt)}</td>
                                        <td className="small">{t.lastUsedAt ? fmtMs(t.lastUsedAt) : "nie"}</td>
                                        <td className="mono">{t.uses || 0}</td>
                                        <td className="cell-act">
                                            <IconButton icon={<TrashIcon />} tip="Token zurückziehen" size="sm" tone="danger" onClick={() => revoke(t)} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
}
