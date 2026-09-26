// The pure rules behind the Einstellungen page, kept apart from the components so
// src/web-client/src/lib/settingsLogic.test.ts can run them in plain Node.
//
// Written so that stripping the signature's annotations leaves valid JavaScript:
// every function is `export function name(params): Result {` on one line, and
// no body uses type syntax (no `as`, no generics, no annotated locals). The test
// relies on exactly that; keep it when adding a function here.
import type { AreaAccess, EventGuildEntry, PingTarget, PingTargetInfo, ReminderRule, RoleSyncRule, TalkOverviewStatus } from "../api";
import { t, tOr } from "../i18n";

export type Level = "none" | "read" | "write";
export type Grants = Record<string, AreaAccess | undefined>;
export type GrantMap = Record<string, Grants>;
export type NameOf = (id: string) => string;

/** "aus" · "Lesen" · "Schreiben", in the active language. */
export function levelLabel(level: Level): string {
    return t(`settings.level.${level}`);
}

/** An area's name and description: the translation for its id, else what the server sent. */
export function areaLabel(area: { id: string; label: string }): string {
    return tOr(`settings.areas.${area.id}.label`, area.label);
}

export function areaDescription(area: { id: string; description: string }): string {
    return tOr(`settings.areas.${area.id}.description`, area.description);
}

// ---- permission matrix: one tri-state cell per owner × area ----

/** The level a stored grant stands for; write always implies read. */
export function levelOf(grant: AreaAccess | undefined): Level {
    if (grant && grant.write) return "write";
    if (grant && grant.read) return "read";
    return "none";
}

/** The stored shape of a level. */
export function grantOf(level: Level): AreaAccess {
    return { read: level !== "none", write: level === "write" };
}

/** One click on a cell: aus › Lesen › Schreiben › aus. */
export function nextLevel(level: Level): Level {
    if (level === "none") return "read";
    if (level === "read") return "write";
    return "none";
}

/** The grants with one area set to a level; "aus" removes the entry instead of storing two falses. */
export function withLevel(grants: Grants | undefined, areaId: string, level: Level): Grants {
    const out = { ...(grants || {}) };
    if (level === "none") delete out[areaId];
    else out[areaId] = grantOf(level);
    return out;
}

/** How many owners of a map hold at least read resp. write on an area (the column head's tooltip). */
export function areaCounts(maps: Grants[], areaId: string): { read: number; write: number } {
    let read = 0;
    let write = 0;
    for (const grants of maps) {
        const level = levelOf(grants && grants[areaId]);
        if (level === "read") read += 1;
        if (level === "write") write += 1;
    }
    return { read, write };
}

/** Discord ids are 17–20 digit snowflakes; anything else is a typo that could never log in. */
export function isDiscordId(value: string): boolean {
    return /^\d{17,20}$/.test(String(value || "").trim());
}

/** Every owner × area whose level differs, as "@Raidlead · Historie → Schreiben". */
export function permissionChanges(before: GrantMap, after: GrantMap, ownerName: NameOf, areaName: NameOf): string[] {
    const out = [];
    const owners = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    for (const owner of owners) {
        const a = (before || {})[owner] || {};
        const b = (after || {})[owner] || {};
        const areas = [...new Set([...Object.keys(a), ...Object.keys(b)])];
        for (const area of areas) {
            const from = levelOf(a[area]);
            const to = levelOf(b[area]);
            if (from !== to) out.push(t("settings.changes.perm", { owner: ownerName(owner), area: areaName(area), level: levelLabel(to) }));
        }
        const added = !(before || {})[owner] && (after || {})[owner];
        const removed = (before || {})[owner] && !(after || {})[owner];
        if (added && !areas.length) out.push(t("settings.changes.added", { name: ownerName(owner) }));
        if (removed && !areas.length) out.push(t("settings.changes.removed", { name: ownerName(owner) }));
    }
    return out;
}

// ---- the save bar: what differs between the saved config and the draft ----

export type DraftShape = {
    adminRoleIds: string[];
    rolePermissions: GrantMap;
    baseAccess: Grants;
    userPermissions: GrantMap;
    officerRoleId: string;
    applicationChannelId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidChannelId: string;
    categoryLootTool: Record<string, string>;
    /** The loot system per category; missing/"" = automatic from the loot addon. */
    categoryLootSystem?: Record<string, string>;
    categorySignupSource?: Record<string, string>;
    /** The source of a category without an entry (#291); missing = "raidhelper". */
    signupSourceDefault?: string;
    categorySetupDms?: Record<string, boolean>;
    /** A Discord event per raid (#305); missing = off. */
    categoryDiscordEvent?: Record<string, boolean>;
    /** The voice channel a category's raids meet in (#305); missing = none. */
    categoryVoiceChannel?: Record<string, string>;
    /** The look of the signup message; missing = raid picture on, title "large". */
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    categoryAnnounce?: Record<string, { enabled: boolean; target: string }>;
    /** The message with "Vielleicht" / "Absagen"; missing = "optional". */
    categorySignupNotes?: Record<string, string>;
    /** Where those messages go (#335); missing = the default channel. */
    categorySignupNoteChannel?: Record<string, string>;
    categorySheets: Record<string, { url: string; name: string }>;
    categoryRaidTemplate?: Record<string, string>;
    topItems: { id: number }[];
};

export type ChangeNames = { role: NameOf; user: NameOf; area: NameOf; category: NameOf };

// The draft field and the key of its label (translated when the line is built).
const SIMPLE_FIELDS: [string, string][] = [
    ["officerRoleId", "settings.page.officerRole"],
    ["applicationChannelId", "settings.page.appChannel"],
    ["raidChannelId", "settings.page.raidChannel"],
];

/** The loot addon's name; "" = none. The addons themselves are proper names. */
export function lootToolLabel(tool: string): string {
    if (tool === "gargul") return "Gargul";
    if (tool === "rclc") return "RCLootcouncil";
    return tool ? tool : t("settings.lootTool.none");
}

/** The loot system's name; "" = automatic from the loot addon. */
export function lootSystemLabel(system: string): string {
    if (system === "softres") return "Softres";
    if (system === "gdkp") return "GDKP";
    if (system === "lootcouncil") return t("settings.lootSystem.lootcouncil");
    if (system === "other") return t("settings.lootSystem.otherSystem");
    return system ? system : t("settings.lootSystem.auto");
}

/** "Beim Anlegen ankündigen" (#306) as one value: "" = off, else the ping target. */
export function announceLabel(mode: string): string {
    if (mode === "event" || mode === "talk" || mode === "both") return t(`settings.announce.${mode}`);
    return mode ? mode : t("settings.announce.off");
}

export function announceMode(entry: { enabled: boolean; target: string } | undefined): string {
    return entry && entry.enabled ? String(entry.target || "event") : "";
}

/** The message with "Vielleicht" / "Absagen" per category: required, optional (the default) or not asked. */
export function signupNoteLabel(mode: string): string {
    return t(`settings.signupNote.${mode === "required" || mode === "none" ? mode : "optional"}`);
}

export function signupNoteMode(map: Record<string, string> | undefined, categoryId: string): string {
    const mode = (map || {})[categoryId];
    return mode === "required" || mode === "none" ? mode : "optional";
}

/**
 * The channel select of "Nachricht bei Vielleicht/Absage" per category (#335):
 * the label of the default choice and whether the category's own channel is
 * out of the bot's reach (the server then posts to the default instead). With
 * no channel list (bot offline) nothing is judged unreachable.
 */
export function noteChannelPick(channels: { id: string; name: string }[], defaultId: string, value: string): { defaultLabel: string; unreachable: boolean } {
    const standard = defaultId ? channels.find((c) => c.id === defaultId) : undefined;
    let defaultLabel = t("settings.noteChannel.default");
    if (!defaultId) defaultLabel = t("settings.noteChannel.notSet");
    else if (standard) defaultLabel = t("settings.noteChannel.channel", { name: standard.name });
    else if (channels.length) defaultLabel = t("settings.noteChannel.unreachable");
    return { defaultLabel, unreachable: !!value && channels.length > 0 && !channels.some((c) => c.id === value) };
}

/** The title sizes of the signup message (src/web/embedLook.js, TITLE_SIZES). */
export const TITLE_SIZES: string[] = ["normal", "large", "huge"];

export function titleSizeLabel(size: string): string {
    return TITLE_SIZES.includes(size) ? t(`settings.titleSize.${size}`) : size;
}

/** One category's message look with the defaults filled in: raid picture on, title "large". */
export function messageLook(map: Record<string, { raidArt?: boolean; titleSize?: string }> | undefined, id: string): { raidArt: boolean; titleSize: string } {
    const entry = (map || {})[id] || {};
    return { raidArt: entry.raidArt !== false, titleSize: TITLE_SIZES.includes(entry.titleSize || "") ? String(entry.titleSize) : "large" };
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
    const x = [...(a || [])].sort();
    const y = [...(b || [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The unsaved changes, one line each — the save bar counts them and shows the
 * first few. An empty list means the draft equals the saved state and the bar
 * stays away.
 */
export function draftChanges(saved: DraftShape, draft: DraftShape, names: ChangeNames): string[] {
    const out = [];
    const admins = [...new Set([...(saved.adminRoleIds || []), ...(draft.adminRoleIds || [])])];
    for (const id of admins) {
        const was = (saved.adminRoleIds || []).includes(id);
        const is = (draft.adminRoleIds || []).includes(id);
        if (was !== is) out.push(t(is ? "settings.changes.adminAdded" : "settings.changes.adminRemoved", { name: names.role(id) }));
    }
    out.push(...permissionChanges(saved.rolePermissions, draft.rolePermissions, names.role, names.area));
    out.push(...permissionChanges({ base: saved.baseAccess || {} }, { base: draft.baseAccess || {} }, () => t("settings.permissions.base"), names.area));
    out.push(...permissionChanges(saved.userPermissions, draft.userPermissions, names.user, names.area));

    const categories = [...new Set([
        ...(saved.categoryIds || []), ...(draft.categoryIds || []),
        ...Object.keys(saved.categoryRoles || {}), ...Object.keys(draft.categoryRoles || {}),
        ...Object.keys(saved.categoryLootTool || {}), ...Object.keys(draft.categoryLootTool || {}),
        ...Object.keys(saved.categoryLootSystem || {}), ...Object.keys(draft.categoryLootSystem || {}),
        ...Object.keys(saved.categorySignupSource || {}), ...Object.keys(draft.categorySignupSource || {}),
        ...Object.keys(saved.categorySetupDms || {}), ...Object.keys(draft.categorySetupDms || {}),
        ...Object.keys(saved.categoryDiscordEvent || {}), ...Object.keys(draft.categoryDiscordEvent || {}),
        ...Object.keys(saved.categoryVoiceChannel || {}), ...Object.keys(draft.categoryVoiceChannel || {}),
        ...Object.keys(saved.categoryMessageLook || {}), ...Object.keys(draft.categoryMessageLook || {}),
        ...Object.keys(saved.categoryAnnounce || {}), ...Object.keys(draft.categoryAnnounce || {}),
        ...Object.keys(saved.categorySignupNotes || {}), ...Object.keys(draft.categorySignupNotes || {}),
        ...Object.keys(saved.categorySignupNoteChannel || {}), ...Object.keys(draft.categorySignupNoteChannel || {}),
        ...Object.keys(saved.categorySheets || {}), ...Object.keys(draft.categorySheets || {}),
    ])];
    for (const id of categories) {
        const name = names.category(id);
        const was = (saved.categoryIds || []).includes(id);
        const is = (draft.categoryIds || []).includes(id);
        if (was !== is) out.push(t(is ? "settings.changes.activated" : "settings.changes.deactivated", { name }));
        if (!sameList((saved.categoryRoles || {})[id], (draft.categoryRoles || {})[id])) out.push(t("settings.changes.raiderRoles", { name }));
        const toolWas = (saved.categoryLootTool || {})[id] || "";
        const toolIs = (draft.categoryLootTool || {})[id] || "";
        if (toolWas !== toolIs) out.push(t("settings.changes.lootTool", { name, value: lootToolLabel(toolIs) }));
        const systemWas = (saved.categoryLootSystem || {})[id] || "";
        const systemIs = (draft.categoryLootSystem || {})[id] || "";
        if (systemWas !== systemIs) out.push(t("settings.changes.lootSystem", { name, value: lootSystemLabel(systemIs) }));
        const sourceWas = (saved.categorySignupSource || {})[id] || saved.signupSourceDefault || "raidhelper";
        const sourceIs = (draft.categorySignupSource || {})[id] || draft.signupSourceDefault || saved.signupSourceDefault || "raidhelper";
        if (sourceWas !== sourceIs) out.push(t("settings.changes.newEvents", { name, value: sourceIs === "eventhelper" ? "EventHelper" : "Raid-Helper" }));
        const dmsWas = (saved.categorySetupDms || {})[id] === true;
        const dmsIs = (draft.categorySetupDms || {})[id] === true;
        if (dmsWas !== dmsIs) out.push(t(dmsIs ? "settings.changes.setupDmsOn" : "settings.changes.setupDmsOff", { name }));
        // #305: the Discord event per raid and the voice channel the raids meet in.
        const deWas = (saved.categoryDiscordEvent || {})[id] === true;
        const deIs = (draft.categoryDiscordEvent || {})[id] === true;
        if (deWas !== deIs) out.push(t(deIs ? "settings.changes.discordEventOn" : "settings.changes.discordEventOff", { name }));
        const voiceWas = (saved.categoryVoiceChannel || {})[id] || "";
        const voiceIs = (draft.categoryVoiceChannel || {})[id] || "";
        if (voiceWas !== voiceIs) out.push(t(voiceIs ? "settings.changes.voiceSet" : "settings.changes.voiceRemoved", { name }));
        const lookWas = messageLook(saved.categoryMessageLook, id);
        const lookIs = messageLook(draft.categoryMessageLook, id);
        if (lookWas.raidArt !== lookIs.raidArt) out.push(t(lookIs.raidArt ? "settings.changes.raidArtOn" : "settings.changes.raidArtOff", { name }));
        if (lookWas.titleSize !== lookIs.titleSize) out.push(t("settings.changes.titleSize", { name, value: titleSizeLabel(lookIs.titleSize) }));
        const annWas = announceMode((saved.categoryAnnounce || {})[id]);
        const annIs = announceMode((draft.categoryAnnounce || {})[id]);
        if (annWas !== annIs) out.push(t("settings.changes.announce", { name, value: announceLabel(annIs) }));
        const noteWas = signupNoteMode(saved.categorySignupNotes, id);
        const noteIs = signupNoteMode(draft.categorySignupNotes, id);
        if (noteWas !== noteIs) out.push(t("settings.changes.signupNote", { name, value: signupNoteLabel(noteIs) }));
        const noteChWas = (saved.categorySignupNoteChannel || {})[id] || "";
        const noteChIs = (draft.categorySignupNoteChannel || {})[id] || "";
        if (noteChWas !== noteChIs) out.push(t(noteChIs ? "settings.changes.noteChannelSet" : "settings.changes.noteChannelDefault", { name }));
        const sheetWas = (saved.categorySheets || {})[id] || { url: "", name: "" };
        const sheetIs = (draft.categorySheets || {})[id] || { url: "", name: "" };
        if ((sheetWas.url || "").trim() !== (sheetIs.url || "").trim() || (sheetWas.name || "").trim() !== (sheetIs.name || "").trim()) {
            out.push(t("settings.changes.raidsheet", { name }));
        }
    }

    // The default raid template per category (#266).
    const tplWas = saved.categoryRaidTemplate || {};
    const tplIs = draft.categoryRaidTemplate || {};
    for (const id of [...new Set([...Object.keys(tplWas), ...Object.keys(tplIs)])]) {
        if ((tplWas[id] || "") !== (tplIs[id] || "")) out.push(t("settings.changes.template", { name: names.category(id) }));
    }

    for (const [key, labelKey] of SIMPLE_FIELDS) {
        if (String(saved[key] || "").trim() !== String(draft[key] || "").trim()) out.push(t(labelKey));
    }
    if (!sameList(saved.logChannelIds, draft.logChannelIds)) out.push(t("settings.page.logChannels"));
    const itemsWas = (saved.topItems || []).map((i) => String(i.id));
    const itemsIs = (draft.topItems || []).map((i) => String(i.id));
    if (itemsWas.join(",") !== itemsIs.join(",")) out.push(t("settings.changes.topItems"));
    return out;
}

// ---- connections: one status card and one self-saving modal each ----

export type ConnectionId = "discord" | "battlenet" | "wcl" | "anthropic" | "lootsync";
export type ConnectionState = { tone: "ok" | "mid" | "accent" | ""; label: string; missing: boolean };

export type ConnectionInputs = {
    blizzard?: { clientId?: string; hasClientSecret?: boolean };
    anthropic?: { hasApiKey?: boolean };
    warcraftlogsV2?: { clientId?: string; hasClientSecret?: boolean };
    botOnline?: boolean;
    /** null = not known (not loaded, or not a full admin). */
    tokenCount?: number | null;
};

/** The badge of one connection card, and whether it counts as "nicht eingerichtet". */
export function connectionState(id: ConnectionId, input: ConnectionInputs): ConnectionState {
    if (id === "discord") {
        return input.botOnline ? { tone: "ok", label: t("settings.state.connected"), missing: false } : { tone: "mid", label: t("settings.state.botOffline"), missing: false };
    }
    if (id === "battlenet" || id === "wcl") {
        const block = id === "battlenet" ? input.blizzard : input.warcraftlogsV2;
        const hasId = !!(block && String(block.clientId || "").trim());
        const hasSecret = !!(block && block.hasClientSecret);
        if (hasId && hasSecret) return { tone: "ok", label: t("settings.state.connected"), missing: false };
        if (hasId || hasSecret) return { tone: "mid", label: t(hasId ? "settings.state.secretMissing" : "settings.state.clientIdMissing"), missing: true };
        return { tone: "mid", label: t("settings.state.notSetUp"), missing: true };
    }
    if (id === "anthropic") {
        return input.anthropic && input.anthropic.hasApiKey
            ? { tone: "ok", label: t("settings.state.keyStored"), missing: false }
            : { tone: "mid", label: t("settings.state.keyMissing"), missing: true };
    }
    if (input.tokenCount === null || input.tokenCount === undefined) return { tone: "", label: t("settings.state.tokens"), missing: false };
    if (input.tokenCount === 0) return { tone: "mid", label: t("settings.state.noToken"), missing: true };
    return { tone: "accent", label: t("settings.state.tokenCount", { count: input.tokenCount }), missing: false };
}

/**
 * The PATCH body of one connection modal — only that connection's block, so
 * saving Battle.net can never overwrite a half-edited category in the page's
 * draft. `secret` follows the server's contract: undefined = keep the stored
 * one, "" = clear it, anything else = replace it.
 */
export function connectionPatch(id: ConnectionId, fields: Record<string, string>, secret: string | undefined): Record<string, unknown> {
    const v = (key) => String(fields[key] || "").trim();
    // The server itself is picked under Discord-Server (discordServersPatch below).
    if (id === "discord") return { raidhelperServerId: v("raidhelperServerId") };
    if (id === "battlenet") {
        return {
            blizzard: {
                clientId: v("clientId"),
                region: v("region") || "eu",
                realmSlug: v("realmSlug").toLowerCase() || "thunderstrike",
                namespace: v("namespace").toLowerCase(),
                ...(secret !== undefined ? { clientSecret: secret } : {}),
            },
        };
    }
    if (id === "anthropic") {
        return { anthropic: { model: v("model"), ...(secret !== undefined ? { apiKey: secret } : {}) } };
    }
    if (id === "wcl") {
        return { warcraftlogsV2: { clientId: v("clientId"), ...(secret !== undefined ? { clientSecret: secret } : {}) } };
    }
    return {};
}

export type SettingsLike = {
    config: { blizzard?: ConnectionInputs["blizzard"]; anthropic?: ConnectionInputs["anthropic"]; warcraftlogsV2?: ConnectionInputs["warcraftlogsV2"] };
    bot?: { online: boolean };
};

/** What the status of the cards is computed from; `tokens` null = not loaded or not a full admin. */
export function connectionInputs(data: SettingsLike, tokens: unknown[] | null): ConnectionInputs {
    return {
        blizzard: data.config.blizzard,
        anthropic: data.config.anthropic,
        warcraftlogsV2: data.config.warcraftlogsV2,
        botOnline: !!(data.bot && data.bot.online),
        tokenCount: tokens ? tokens.length : null,
    };
}

/** The connections a user sees — a limited settings user only gets Battle.net (the rest are FULL_ADMIN_KEYS or admin-only ids). */
export function visibleConnections(canManageAccess: boolean): ConnectionId[] {
    return canManageAccess ? ["discord", "battlenet", "wcl", "anthropic", "lootsync"] : ["battlenet"];
}

/** The sidebar badge of "Verbindungen": how many visible connections are not set up. */
export function missingConnections(data: SettingsLike, tokens: unknown[] | null, canManageAccess: boolean): number {
    const inputs = connectionInputs(data, tokens);
    return visibleConnections(canManageAccess).filter((id) => connectionState(id, inputs).missing).length;
}

// ---- Discord-Server: several event servers, each with its own overview target, plus the talk server (#251, #361) ----

export type ServerCardLike = { connected: boolean; permissions: { label: string; ok: boolean }[] | null; missing: string[] };
export type ServerFields = { eventGuilds: EventGuildEntry[]; talkGuildId: string; talkPingChannelId: string; signupNoteChannelId: string };
export type OverlapLike = { eventCount: number | null; talkCount: number | null; both: number | null; error: string | null };

/**
 * The badge of one server card. `optional` is the talk server: not having one
 * is the one-server setup, not a gap. Rights that cannot be known (bot offline)
 * are said as such, never counted as missing.
 */
export function serverCardState(card: ServerCardLike | null, optional: boolean): ConnectionState {
    if (!card) return optional ? { tone: "", label: t("settings.state.noSecondServer"), missing: false } : { tone: "mid", label: t("settings.state.noServer"), missing: true };
    if (!card.connected) return { tone: "mid", label: t("settings.state.botNotThere"), missing: true };
    if (!card.permissions) return { tone: "", label: t("settings.state.rightsUnknown"), missing: false };
    const n = card.missing.length;
    if (n) return { tone: "mid", label: t("settings.state.rightsMissing", { count: n }), missing: true };
    return { tone: "ok", label: t("settings.state.connected"), missing: false };
}

/**
 * The sidebar badge of "Discord-Server": how many cards need attention. An
 * empty event-server list is not itself an issue (nothing configured yet is
 * not the same as a broken connection) — only entries that exist are scored.
 */
export function serverIssues(servers: { events: ServerCardLike[]; talk: ServerCardLike | null } | null | undefined): number {
    if (!servers) return 0;
    const eventIssues = servers.events.filter((card) => serverCardState(card, false).missing).length;
    return eventIssues + (serverCardState(servers.talk, true).missing ? 1 : 0);
}

/**
 * The PATCH body of the edit dialog. Mirrors the server's normaliser
 * (settingsStore.js's normalizeEventGuildEntry/normalizeDiscordServers) so the
 * body sent is already clean: every event-server entry's fields trimmed, a
 * half-set overview target (guild without channel or the reverse) cleared to
 * "", and a talk server equal to one of the event servers cleared to "" (it is
 * no second server). Blank rows (no guild picked yet) are dropped. The note
 * channel may sit on any server and is kept as it is.
 */
export function discordServersPatch(fields: ServerFields): { discordServers: ServerFields } {
    const v = (value) => String(value || "").trim();
    const eventGuilds = fields.eventGuilds
        .map((entry) => {
            const overviewGuildId = v(entry.overviewGuildId);
            const overviewChannelId = v(entry.overviewChannelId);
            const hasTarget = !!overviewGuildId && !!overviewChannelId;
            return {
                guildId: v(entry.guildId),
                label: v(entry.label),
                overviewGuildId: hasTarget ? overviewGuildId : "",
                overviewChannelId: hasTarget ? overviewChannelId : "",
            };
        })
        .filter((entry) => entry.guildId);
    const talkGuildIdRaw = v(fields.talkGuildId);
    const talkGuildId = eventGuilds.some((e) => e.guildId === talkGuildIdRaw) ? "" : talkGuildIdRaw;
    return {
        discordServers: {
            eventGuilds,
            talkGuildId,
            talkPingChannelId: v(fields.talkPingChannelId),
            signupNoteChannelId: v(fields.signupNoteChannelId),
        },
    };
}

/** "198 von 212" plus its tone: how many event members are on the talk server too. */
export function overlapBadge(overlap: OverlapLike | null): { label: string; tone: "ok" | "mid" | ""; tip: string } | null {
    if (!overlap) return null;
    if (overlap.error || overlap.both === null || overlap.eventCount === null) {
        return { label: t("settings.overlap.unknown"), tone: "", tip: overlap.error || t("settings.overlap.membersError") };
    }
    const share = overlap.eventCount ? overlap.both / overlap.eventCount : 1;
    return {
        label: t("settings.overlap.label", { both: overlap.both, total: overlap.eventCount }),
        tone: share >= 0.9 ? "ok" : "mid",
        tip: t("settings.overlap.tip", { both: overlap.both, total: overlap.eventCount }),
    };
}

// ---- categories: the raid ones as a list, the rest folded away ----

export type RaiderCharSummary = { members: number; assigned: number; error: string | null };

/** The row's "22 / 25": members holding the category's roles, and how many have a fixed character. */
export function summarizeRaiderChars(info: { members: { id: string }[]; assignments: Record<string, string>; membersError: string | null }): RaiderCharSummary {
    const assigned = info.members.filter((m) => String(info.assignments[m.id] || "").trim()).length;
    return { members: info.members.length, assigned, error: info.membersError };
}

export type CategoryRow = { id: string; name: string; unknown: boolean };

/**
 * The guild's live categories plus every configured id Discord no longer knows
 * (a deleted category). Dropping those silently would delete their settings on
 * the next save without anyone seeing it happen.
 */
export function categoryRows(categories: { id: string; name: string }[], configured: string[]): CategoryRow[] {
    const known = new Set(categories.map((c) => c.id));
    const extra = [];
    for (const id of configured) {
        if (known.has(id)) continue;
        known.add(id);
        extra.push({ id, name: id, unknown: true });
    }
    return [...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })), ...extra];
}

/**
 * Which rows the list shows and which fold into "n weitere Discord-Kategorien":
 * the active categories and every unknown id always show; the rest only with
 * "Alle Discord-Kategorien".
 */
export function splitCategoryRows(rows: CategoryRow[], activeIds: string[], showAll: boolean): { shown: CategoryRow[]; folded: CategoryRow[] } {
    const shown = [];
    const folded = [];
    for (const row of rows) {
        if (showAll || row.unknown || activeIds.includes(row.id)) shown.push(row);
        else folded.push(row);
    }
    return { shown, folded };
}

// ---- pings, reminders and role sync across both servers (#264) ----

export type RoleSyncDirection = "toTalk" | "toEvent" | "both";

export const DIRECTION_LABEL: Record<RoleSyncDirection, string> = { toTalk: "→", toEvent: "←", both: "↔" };
export function directionText(direction: RoleSyncDirection): string {
    return t(`settings.direction.${direction}`);
}

export function targetText(target: PingTarget): string {
    return t(`settings.target.${target}`);
}

/**
 * The options of the "Wohin" segment. Without a talk server and its ping
 * channel only the event channel exists, and the segment is not shown at all.
 */
export function pingTargetOptions(info: { talk: boolean; talkGuildName?: string; talkChannelName?: string } | null | undefined): { value: PingTarget; label: string; tip: string }[] {
    if (!info || !info.talk) return [];
    const where = info.talkChannelName ? `#${info.talkChannelName}` : t("raidModals.target.pingChannel");
    const server = info.talkGuildName || t("raidModals.target.talkServer");
    return [
        { value: "event", label: t("raidModals.target.event"), tip: t("raidModals.target.eventTip") },
        { value: "talk", label: t("raidModals.target.talk"), tip: t("raidModals.target.talkTip", { where, server }) },
        { value: "both", label: t("raidModals.target.both"), tip: t("raidModals.target.bothTip", { where }) },
    ];
}

/** The modal hint of ping and sign-up call: where the message goes, so the head says it without a second line. */
export function targetHint(target: PingTarget, eventChannel: string, info: PingTargetInfo | undefined): string | undefined {
    const talk = info && info.talkChannelName ? `#${info.talkChannelName}` : "Talk";
    const event = eventChannel ? `#${eventChannel}` : "";
    if (target === "talk") return t("raidModals.target.in", { where: talk });
    if (target === "both") return t("raidModals.target.in", { where: event ? `${event} + ${talk}` : talk });
    return event ? t("raidModals.target.in", { where: event }) : undefined;
}

/** The PATCH body of the role mapping: complete pairs only, one per pair, the list replaces the stored one. */
export function roleSyncPatch(rules: RoleSyncRule[]): { roleSync: RoleSyncRule[] } {
    const seen = new Set();
    const out = [];
    for (const r of rules) {
        const eventRoleId = String(r.eventRoleId || "").trim();
        const talkRoleId = String(r.talkRoleId || "").trim();
        const key = eventRoleId + ":" + talkRoleId;
        if (!eventRoleId || !talkRoleId || seen.has(key)) continue;
        seen.add(key);
        out.push({ eventRoleId, talkRoleId, direction: r.direction || "toTalk" });
    }
    return { roleSync: out };
}

/** The mapping with one entry replaced (index) or appended (index -1). */
export function withRoleRule(rules: RoleSyncRule[], index: number, rule: RoleSyncRule): RoleSyncRule[] {
    if (index < 0 || index >= rules.length) return [...rules, rule];
    return rules.map((r, i) => (i === index ? rule : r));
}

/** The small badge of the role sync head: how many members kept a synced role the source lost. */
export function driftBadge(total: number, error: string | null): { label: string; tone: "ok" | "mid" | ""; tip: string } {
    if (error) return { label: t("settings.drift.unknown"), tone: "", tip: error };
    if (!total) return { label: t("settings.drift.none"), tone: "ok", tip: t("settings.drift.noneTip") };
    return {
        label: t("settings.drift.count", { count: total }),
        tone: "mid",
        tip: t("settings.drift.tip"),
    };
}

/** Whether a category sends no reminder at all. */
export function reminderOff(rule: ReminderRule | null | undefined): boolean {
    return !rule || !(rule.missingHours > 0 || rule.signedHours > 0);
}

/** "24 h vor Schluss · 1 h vor Raid", or "aus". */
export function reminderSummary(rule: ReminderRule | null | undefined): string {
    if (!rule || reminderOff(rule)) return t("settings.reminderSummary.off");
    const parts = [];
    if (rule.missingHours > 0) parts.push(t("settings.reminderSummary.missing", { hours: rule.missingHours }));
    if (rule.signedHours > 0) parts.push(t("settings.reminderSummary.signed", { hours: rule.signedHours }));
    return parts.join(" · ");
}

/** Hours from an input: whole numbers 1–168, anything else 0 (= off) — the server's rule. */
export function reminderHours(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, 168);
}

/** The PATCH body with one category's rule set; both hours 0 removes the category. */
export function remindersPatch(current: Record<string, ReminderRule>, categoryId: string, rule: ReminderRule): { categoryReminders: Record<string, ReminderRule> } {
    const next = { ...current };
    const missingHours = reminderHours(rule.missingHours);
    const signedHours = reminderHours(rule.signedHours);
    if (!missingHours && !signedHours) delete next[categoryId];
    else next[categoryId] = { missingHours, signedHours, target: rule.target || "event" };
    return { categoryReminders: next };
}

// ---- raid overview on the talk server (#257) ----

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "vor 2 T"; "" for never. */
export function agoText(ms: number, now: number): string {
    if (!ms) return "";
    const minutes = Math.max(0, Math.round((now - ms) / 60000));
    if (minutes < 1) return t("settings.ago.now");
    if (minutes < 60) return t("settings.ago.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return t("settings.ago.hours", { count: hours });
    return t("settings.ago.days", { count: Math.round(hours / 24) });
}

/** The overview's one badge: state as label, the times and any error in the tooltip. */
export function talkOverviewBadge(status: TalkOverviewStatus | null, now: number): { label: string; tone: "ok" | "mid" | ""; tip: string; tipSub: string } {
    if (!status || !status.configured) {
        return { label: t("settings.overviewBadge.notSet"), tone: "", tip: t("settings.overviewBadge.title"), tipSub: t("settings.overviewBadge.notSetSub") };
    }
    const times = [
        status.postedAt ? t("settings.overviewBadge.posted", { ago: agoText(status.postedAt, now) }) : "",
        status.editedAt ? t("settings.overviewBadge.edited", { ago: agoText(status.editedAt, now) }) : "",
        status.checkedAt ? t("settings.overviewBadge.checked", { ago: agoText(status.checkedAt, now) }) : "",
    ].filter(Boolean);
    if (status.error) {
        return { label: t("common.error"), tone: "mid", tip: t("settings.overviewBadge.errorTip"), tipSub: [status.error, ...times].join("\n") };
    }
    if (!status.messageId) {
        return { label: t("settings.overviewBadge.notPosted"), tone: "", tip: t("settings.overviewBadge.title"), tipSub: t("settings.overviewBadge.notPostedSub") };
    }
    const label = status.editedAt
        ? t("settings.overviewBadge.editedLabel", { ago: agoText(status.editedAt, now) })
        : t("settings.overviewBadge.postedLabel", { ago: agoText(status.postedAt, now) });
    return {
        label,
        tone: "ok",
        tip: t("settings.overviewBadge.current"),
        tipSub: [...times, t("settings.overviewBadge.currentSub")].join("\n"),
    };
}
