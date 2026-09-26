import { useState, type ReactNode } from "react";
import {
    updateSettings, createIngestToken, deleteIngestToken,
    type AdminConfig, type ApiError, type IngestToken, type SettingsData,
} from "../../api";
import { fmtMs } from "../../lib/format";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { connectionInputs, connectionPatch, connectionState, visibleConnections, type ConnectionId } from "../../lib/settingsLogic";
import { useToast } from "../../components/Jobs";
import { useConfirm, Modal } from "../../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import PartHead from "../../components/ui/PartHead";
import { CheckIcon, CopyIcon, ExternalIcon, TrashIcon } from "../../components/icons";
import { AdminOnlyBadge, CheckMark, PenIcon, WarnIcon } from "../../components/settings/settingsUi";
import { FieldLabel, InfoTip } from "../../components/ui/Field";
import RaidLoader from "../../components/ui/RaidLoader";
import RaidhelperRetirementCard from "./SettingsRaidhelperRetirement";
import { t as translate, useT } from "../../i18n";

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
    if (minutes < 60) return translate("settings.connections.since.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return translate("settings.connections.since.hours", { count: hours });
    return translate("settings.connections.since.days", { count: Math.round(hours / 24) });
}

// Built while rendering, so every text is in the active language.
function cards(data: SettingsData, tokens: IngestToken[] | null): Card[] {
    const t = translate;
    const c = data.config;
    const secret = (has: boolean | undefined) => (has ? t("settings.connections.secretStored") : t("settings.connections.noSecret"));
    const lastUsed = (tokens || []).filter((tok) => tok.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    const uploads = (tokens || []).reduce((sum, tok) => sum + (tok.uses || 0), 0);
    const wclOk = connectionState("wcl", connectionInputs(data, tokens)).tone === "ok";
    const all: Card[] = [
        {
            id: "discord", title: "Discord & Raid-Helper", icon: "inv_letter_15", adminOnly: true,
            tip: "Discord & Raid-Helper",
            tipSub: t("settings.connections.discordSub"),
            rows: [
                [t("settings.connections.eventServer"), data.servers?.events?.[0]?.name || data.bot?.guildName || c.guildId || t("settings.connections.botDefaultServer")],
                ["Raid-Helper", c.raidhelperServerId || t("settings.connections.fromEnv")],
                ["Bot", data.bot?.online ? (data.bot.readySince ? t("settings.connections.onlineSince", { since: since(data.bot.readySince) }) : "online") : "offline"],
            ],
        },
        {
            id: "battlenet", title: "Battle.net / Armory", icon: "inv_chest_plate16", adminOnly: false,
            tip: "Battle.net / Armory",
            tipSub: t("settings.connections.battlenetSub"),
            rows: [
                ["Realm", `${c.blizzard.region || "eu"} · ${c.blizzard.realmSlug || "thunderstrike"}`],
                ["Namespace", c.blizzard.namespace || t("settings.connections.auto")],
                ["Secret", secret(c.blizzard.hasClientSecret)],
            ],
        },
        {
            id: "wcl", title: "Warcraft Logs", icon: "inv_misc_spyglass_02", adminOnly: true,
            tip: "Warcraft Logs API v2",
            tipSub: t("settings.connections.wclSub"),
            rows: [
                [t("settings.connections.clientId"), shortId(c.warcraftlogsV2?.clientId || "")],
                ["Secret", secret(c.warcraftlogsV2?.hasClientSecret)],
                [t("settings.connections.effect"), wclOk ? t("settings.connections.curvesOn") : t("settings.connections.curvesOff")],
            ],
        },
        {
            id: "anthropic", title: t("settings.connections.aiTitle"), icon: "inv_misc_book_11", adminOnly: true,
            tip: t("settings.connections.aiTip"),
            tipSub: t("settings.connections.aiSub"),
            rows: [
                [t("settings.connections.model"), c.anthropic?.model || "claude-opus-5"],
                ["Key", c.anthropic?.hasApiKey ? t("settings.connections.secretStored") : t("settings.connections.noKey")],
                [t("settings.connections.effect"), c.anthropic?.hasApiKey ? t("settings.connections.aiOn") : t("settings.connections.aiOff")],
            ],
        },
        {
            id: "lootsync", title: t("settings.connections.lootSyncTitle"), icon: "inv_misc_punchcards_blue", adminOnly: true,
            tip: t("settings.connections.lootSyncTip"),
            tipSub: t("settings.connections.lootSyncSub"),
            rows: [
                [t("settings.connections.lastUpload"), lastUsed
                    ? t("settings.connections.lastUploadValue", { since: since(lastUsed.lastUsedAt), name: lastUsed.name })
                    : tokens ? t("settings.connections.noUploadYet") : "—"],
                ["Uploads", tokens ? t("settings.connections.uploadsTotal", { count: uploads }) : "—"],
                [t("settings.connections.target"), t("settings.connections.targetValue")],
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
    const t = useT();
    const [editing, setEditing] = useState<ConnectionId | null>(null);
    const inputs = connectionInputs(data, tokens);
    const list = cards(data, tokens);
    const ready = list.filter((card) => !connectionState(card.id, inputs).missing).length;

    return (
        <>
            <PartHead icon={icon} tone="settings" title={t("settings.sections.verbindungen.label")}
                crumb={t("settings.crumb", { crumb: t("settings.connections.crumb", { crumb, ready, total: list.length }) })} />
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
                                        {t("settings.connections.manageTokens")}
                                    </Button>
                                ) : state.missing ? (
                                    <Button size="sm" icon={card.icon} onClick={() => setEditing(card.id)}>{t("settings.connections.setUp")}</Button>
                                ) : (
                                    <Button variant="ghost" size="sm" icon={<PenIcon />} onClick={() => setEditing(card.id)}>{t("common.edit")}</Button>
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

type FieldsDef = { title: string; fields: FieldDef[]; secret?: FieldDef; link?: [string, string]; missingText: string };

/** The modal's fields of one connection, in the active language. */
function fieldsOf(id: Exclude<ConnectionId, "lootsync">): FieldsDef {
    const t = translate;
    const secretLabel = t("settings.connections.clientSecret");
    const clientId = t("settings.connections.clientId");
    if (id === "discord") {
        const label = t("settings.connections.raidhelperId");
        return {
            title: "Discord & Raid-Helper",
            missingText: t("settings.connections.discordMissing"),
            fields: [
                { key: "raidhelperServerId", label, mono: true, placeholder: t("settings.connections.raidhelperIdPlaceholder"), tip: label, tipSub: t("settings.connections.raidhelperIdSub") },
            ],
        };
    }
    if (id === "battlenet") {
        const namespace = t("settings.connections.namespace");
        return {
            title: "Battle.net / Armory",
            missingText: t("settings.connections.battlenetMissing"),
            link: ["https://develop.battle.net/access/clients", t("settings.connections.battlenetLink")],
            fields: [
                { key: "clientId", label: clientId, mono: true, placeholder: t("settings.connections.battlenetClientPlaceholder") },
                { key: "region", label: "Region", placeholder: "eu" },
                { key: "realmSlug", label: t("settings.connections.realmSlug"), placeholder: "thunderstrike" },
                { key: "namespace", label: namespace, placeholder: t("settings.connections.namespacePlaceholder"), tip: namespace, tipSub: t("settings.connections.namespaceSub") },
            ],
            secret: { key: "clientSecret", label: secretLabel, tip: secretLabel, tipSub: t("settings.connections.battlenetSecretSub") },
        };
    }
    if (id === "wcl") {
        return {
            title: "Warcraft Logs (API v2)",
            missingText: t("settings.connections.wclMissing"),
            link: ["https://www.warcraftlogs.com/api/clients", t("settings.connections.wclLink")],
            fields: [
                { key: "clientId", label: clientId, mono: true, placeholder: t("settings.connections.wclClientPlaceholder") },
            ],
            secret: { key: "clientSecret", label: secretLabel, tip: secretLabel, tipSub: t("settings.connections.wclSecretSub") },
        };
    }
    const model = t("settings.connections.model");
    return {
        title: t("settings.connections.aiTip"),
        missingText: t("settings.connections.aiMissing"),
        link: ["https://console.anthropic.com/settings/keys", t("settings.connections.aiLink")],
        fields: [
            { key: "model", label: model, mono: true, placeholder: "claude-opus-5", tip: model, tipSub: t("settings.connections.modelSub") },
        ],
        secret: { key: "apiKey", label: t("settings.connections.apiKey"), tip: t("settings.connections.apiKeyTip"), tipSub: t("settings.connections.apiKeySub") },
    };
}

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
    const t = useT();
    const def = fieldsOf(id);
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
            toast(t("settings.connections.saved", { title: card.title }));
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
            kicker={t("settings.editKicker")}
            title={def.title}
            width={580}
            initialFocus="input"
            hint={card.adminOnly ? <AdminOnlyBadge /> : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
                    <Button onClick={save} disabled={busy}>{busy ? t("settings.saving") : t("common.save")}</Button>
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
                                placeholder={clearSecret ? t("settings.connections.secretCleared") : stored ? t("settings.connections.secretKeep") : t("settings.connections.secretNone")}
                                onChange={(e) => setSecretValue(e.target.value)}
                            />
                            {stored && (
                                <Button variant="ghost" size="sm" icon={clearSecret ? undefined : <TrashIcon />} onClick={() => { setClearSecret(!clearSecret); setSecretValue(""); }}>
                                    {clearSecret ? t("settings.connections.keep") : t("common.delete")}
                                </Button>
                            )}
                        </div>
                        <div className="note">{t("settings.connections.secretNote")}</div>
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
    const t = useT();
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

    const revoke = async (tok: IngestToken) => {
        if (!(await ask({ title: t("settings.tokens.revokeAsk", { name: tok.name }), text: t("settings.tokens.revokeText"), action: t("settings.tokens.revoke"), tone: "danger" }))) return;
        try {
            await deleteIngestToken(tok.id);
            onChanged();
            toast(t("settings.tokens.revoked", { name: tok.name }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    // Default "zuletzt benutzt": the question this table answers is usually
    // "welcher Rechner lädt eigentlich noch hoch?".
    const { sort, dir, onSort, apply } = useTableSort<TokenSortKey>("settings-ingest-tokens-sort", TOKEN_SORT_DEFAULTS, "lastUsed");
    const sorted = apply(tokens || [], (tok, key) => {
        switch (key) {
            case "name": return tok.name.toLowerCase();
            case "created": return tok.createdAt || 0;
            case "uses": return tok.uses || 0;
            default: return tok.lastUsedAt || 0;
        }
    });

    return (
        <Modal
            open={open}
            onClose={close}
            icon="inv_misc_punchcards_blue"
            tone="settings"
            kicker={t("settings.editKicker")}
            title={t("settings.tokens.title")}
            width={720}
            hint={<AdminOnlyBadge />}
            footer={<Button variant="ghost" onClick={close}>{t("common.done")}</Button>}
        >
            <div className="conn-form">
                {fresh && (
                    <div className="conn-status mid">
                        <Badge tone="mid" icon={<WarnIcon />}>{t("settings.tokens.onceVisible")}</Badge>
                        <div className="fresh-token">
                            <span>{t("settings.tokens.created", { name: fresh.name })}</span>
                            <div className="secret-row">
                                <input type="text" readOnly className="mono" value={fresh.token} onFocus={(e) => e.target.select()} />
                                <IconButton
                                    icon={copied ? <CheckIcon /> : <CopyIcon />}
                                    tip={copied ? t("common.copied") : t("settings.tokens.copy")}
                                    onClick={() => { navigator.clipboard?.writeText(fresh.token); setCopied(true); }}
                                />
                            </div>
                        </div>
                    </div>
                )}
                <div className="dlg-field">
                    <FieldLabel htmlFor="token-name" tip={t("settings.tokens.new")} tipSub={t("settings.tokens.newSub")}>{t("settings.tokens.new")}</FieldLabel>
                    <div className="secret-row">
                        <input id="token-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.tokens.namePlaceholder")} />
                        <Button icon="inv_misc_punchcards_blue" onClick={create} disabled={busy}>{busy ? t("settings.tokens.creating") : t("settings.tokens.create")}</Button>
                    </div>
                </div>
                {!tokens ? <RaidLoader compact text={t("settings.tokens.loading")} /> : !tokens.length ? (
                    <div className="empty">{t("settings.tokens.empty")}</div>
                ) : (
                    <div className="table-scroll">
                        <table className="idx">
                            <thead>
                                <tr>
                                    <SortTh sortKey="name" label={t("common.name")} sort={sort} dir={dir} onSort={onSort} />
                                    <th data-tip={t("settings.tokens.colToken")} data-tip-sub={t("settings.tokens.colTokenSub")}>{t("settings.tokens.colToken")}</th>
                                    <SortTh sortKey="created" label={t("settings.tokens.colCreated")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="lastUsed" label={t("settings.tokens.colLastUsed")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="uses" label={t("settings.tokens.colUploads")} sort={sort} dir={dir} onSort={onSort} />
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((tok) => (
                                    <tr key={tok.id}>
                                        <td><strong>{tok.name}</strong></td>
                                        <td className="mono">ehl_…{tok.hint}</td>
                                        <td className="small" data-tip={tok.createdBy ? t("settings.tokens.createdBy", { name: tok.createdBy }) : undefined}>{fmtMs(tok.createdAt)}</td>
                                        <td className="small">{tok.lastUsedAt ? fmtMs(tok.lastUsedAt) : t("settings.tokens.never")}</td>
                                        <td className="mono">{tok.uses || 0}</td>
                                        <td className="cell-act">
                                            <IconButton icon={<TrashIcon />} tip={t("settings.tokens.revokeTip")} size="sm" tone="danger" onClick={() => revoke(tok)} />
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
