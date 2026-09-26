import { get, send } from "./client";
import type { Area, Access, RolePermissions } from "./session";
import type { Category } from "./channels";
import type { DiscordServers, DiscordServerCard } from "./discordServers";
import type { EventSource } from "./raidDetail";
import type { TextChannel } from "./recruitment";
import type { BotAccessRule } from "./botCommands";

/** `color`: the role's Discord colour as hex, "" when it has none. */
export type Role = { id: string; name: string; color?: string };

// The Battle.net client. The secret never comes back from the server — only
// whether one is stored. Read: { …, hasClientSecret }. Write: { …, clientSecret? }
// — omit clientSecret to keep the stored one, "" to clear it.
export type BlizzardConfig = {
    clientId: string;
    hasClientSecret?: boolean;
    clientSecret?: string;
    region: string;
    realmSlug: string;
    namespace: string;
};

export type AdminConfig = {
    adminRoleIds: string[];
    // Per-role area rights; only sent to (and savable by) full admins.
    rolePermissions?: RolePermissions;
    // What every logged-in account gets without a role — same gate as above.
    baseAccess?: Access;
    // Area rights for single Discord accounts (keyed by user id), for areas that
    // go to named people rather than to a group — same gate as above.
    userPermissions?: RolePermissions;
    // Who may use which bot command (Berechtigungen → Bot-Befehle) — same gate as above.
    botCommandAccess?: Record<string, BotAccessRule>;
    guildId: string;
    // Event and talk server (#251); full admins only, like the access keys.
    discordServers?: DiscordServers;
    raidhelperServerId: string;
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidDefaults: { channelId: string };
    // The default raid template per category (category id → template id).
    categoryRaidTemplate: Record<string, string>;
    blizzard: BlizzardConfig;
    // Claude phrases the log recommendations for the raiders. The key itself
    // never comes back from the server — only whether one is stored.
    // Read: { model, hasApiKey }. Write: { model, apiKey? } — omit apiKey to keep, "" to clear.
    anthropic?: { model: string; hasApiKey?: boolean; apiKey?: string };
    // Warcraft Logs v2 API client for the raid DPS/HPS and boss-health curves
    // of the fight timeline. Same contract as above: the secret never comes
    // back. Read: { clientId, hasClientSecret }. Write: { clientId, clientSecret? }.
    warcraftlogsV2?: { clientId: string; hasClientSecret?: boolean; clientSecret?: string };
    // Which loot addon a Discord category raids with ("gargul" | "rclc" | ""),
    // keyed by category id — preselects the parser on the loot import and tells
    // the raid-detail loot tab which export to ask for.
    categoryLootTool: Record<string, string>;
    // Which loot system a category's raids run on, keyed by category id. Missing
    // = follows the loot addon (RCLootcouncil = Loot-Council, else Softres).
    categoryLootSystem?: Record<string, string>;
    // Where NEW events of a category are created, keyed by category id. Missing
    // = signupSourceDefault; Raid-Helper events stay in use either way.
    categorySignupSource?: Record<string, EventSource>;
    // The source of a category without an entry (#291): "eventhelper" for new
    // categories; an older install keeps its categories pinned to Raid-Helper.
    signupSourceDefault?: EventSource;
    // Raid-Helper switched off (#291, Verbindungen): no request goes there any more.
    raidhelperRetirement?: { disabled: boolean; at: number; byName: string };
    // Setup-DMs per category (#290): only switched-on categories are listed.
    categorySetupDms?: Record<string, boolean>;
    // A Discord event per raid (#305): only switched-on categories are listed.
    categoryDiscordEvent?: Record<string, boolean>;
    // The voice channel a category's raids meet in (#305), keyed by category id.
    categoryVoiceChannel?: Record<string, string>;
    // The look of a category's signup message: raid picture below it (default on)
    // and the size of the title tiles ("normal" | "large" | "huge", default "large").
    // Only what differs from the default is listed.
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    // "Beim Anlegen ankündigen" per category (#306): only switched-on ones are
    // listed; `target` is a ping target ("event" | "talk" | "both").
    categoryAnnounce?: Record<string, { enabled: boolean; target: string }>;
    // The message with "Vielleicht" / "Absagen" per category: "required" |
    // "none"; a category without an entry is "optional".
    categorySignupNotes?: Record<string, string>;
    // Where a category's messages go instead of discordServers.signupNoteChannelId (#335).
    categorySignupNoteChannel?: Record<string, string>;
    // A fixed Google Sheet per category, keyed by category id. A raid in that
    // category links this sheet unless the app made it a copy of its own.
    categorySheets: Record<string, { url: string; name: string }>;
    // The drops the guild counts as "big", picked from the Wowhead search in
    // Einstellungen → Loot. The dashboard highlights their awards.
    topItems: TopItem[];
    // Role sync between event and talk server (#264); full admins only.
    roleSync?: RoleSyncRule[];
    // Automatic reminders per raid category (#264).
    categoryReminders?: Record<string, ReminderRule>;
};

export type PingTarget = "event" | "talk" | "both";
export type RoleSyncRule = { eventRoleId: string; talkRoleId: string; direction: "toTalk" | "toEvent" | "both" };
export type ReminderRule = { missingHours: number; signedHours: number; target: PingTarget };
/** Whether the talk server's ping channel exists as a target of pings and reminders. */
export type PingTargetInfo = { talk: boolean; talkGuildName: string; talkChannelName: string };

export type RoleSyncDriftGroup = {
    ruleIndex: number;
    /** The server the members kept the synced role on. */
    side: "event" | "talk";
    roleId: string;
    roleName: string;
    sourceRoleId: string;
    sourceRoleName: string;
    guildName: string;
    members: { userId: string; name: string; notOnSource: boolean; profileUrl: string }[];
};
export type RoleSyncRun = {
    at: number;
    added: number;
    failed: number;
    missingPermission: ("event" | "talk")[];
    errors: string[];
    error: string | null;
};
export type RoleSyncData = {
    roleSync: RoleSyncRule[];
    eventRoles: Role[];
    talkRoles: Role[];
    canManage: { event: boolean; talk: boolean };
    drift: RoleSyncDriftGroup[];
    driftTotal: number;
    driftError: string | null;
    lastRun: RoleSyncRun | null;
};
export type RemindersData = {
    categoryReminders: Record<string, ReminderRule>;
    categories: { id: string; name: string; roleCount: number }[];
    pingTargets: PingTargetInfo;
    lastRun: { at: number; sent: number; failed: number; skipped: number; error: string | null } | null;
};

export function getRoleSync(): Promise<RoleSyncData> {
    return get<RoleSyncData>("/api/settings/role-sync");
}

export function getReminders(): Promise<RemindersData> {
    return get<RemindersData>("/api/settings/reminders");
}

// One hit of a Wowhead item search — what both item pickers (softres hard
// reserves, top items) render and store.
export type ItemSearchResult = { id: number; name: string; iconUrl?: string; quality?: number | null };

export type TopItem = { id: number; name: string; iconUrl: string; quality: number | null };

/** Wowhead item search for the top-item picker (settings area, see api docs). */
export function searchSettingsItems(q: string): Promise<{ items: ItemSearchResult[] }> {
    return get<{ items: ItemSearchResult[] }>(`/api/settings/item-search?q=${encodeURIComponent(q)}`);
}

export type Raidsheet = {
    id: string;
    name: string;
    spreadsheetId: string;
    sheetName: string;
    gid: string;
    keywords: string[];
};

export type SettingsData = {
    config: AdminConfig;
    // False for a non-admin who only holds write access to "Einstellungen":
    // the "Zugang"/"Berechtigungen" tabs stay hidden and the server rejects them.
    canManageAccess: boolean;
    areas: Area[];
    // Display names for the accounts holding a per-user grant, so the
    // permissions tab shows people instead of 18-digit ids. Best-effort: an id
    // Discord could not resolve simply has no entry.
    userNames?: Record<string, string>;
    raidsheets: Raidsheet[];
    // The raid templates, for the default-template select per category.
    raidTemplates?: { id: string; name: string; versionId: string; size: number | null }[];
    roles: Role[];
    categories: Category[];
    // The text channels the bot can post in, for the channel pickers; empty
    // while the bot is offline (the fields then take a raw id).
    channels?: TextChannel[];
    // The server's voice channels, for the voice channel per category (#305).
    voiceChannels?: TextChannel[];
    // The channel of "Vielleicht" / "Absagen" per category (#335): the text
    // channels of both servers and the default channel's id.
    noteChannels?: { defaultId: string; channels: TextChannel[] };
    // Status line of the "Discord & Raid-Helper" connection card.
    bot?: { online: boolean; readySince: number; guildName: string };
    // The event and talk server cards; null for a limited settings user.
    servers?: { events: DiscordServerCard[]; talk: DiscordServerCard | null } | null;
    activeGuildId: string;
};

export function getSettings(): Promise<SettingsData> {
    return get<SettingsData>("/api/settings");
}

export function updateSettings(csrfToken: string | null, partial: Partial<AdminConfig>): Promise<{ config: AdminConfig }> {
    return send("PATCH", "/api/settings", csrfToken, partial);
}

export function saveRaidsheet(csrfToken: string | null, input: Partial<Raidsheet>): Promise<Raidsheet> {
    return send("POST", "/api/settings/raidsheets", csrfToken, input);
}

export function deleteRaidsheet(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/settings/raidsheets/delete", csrfToken, { id });
}

// ---- loot-sync API tokens (full admins only) ----

export type IngestToken = {
    id: string;
    name: string;
    /** Last 4 chars of the secret, so several tokens are tellable apart. */
    hint: string;
    createdAt: number;
    createdBy: string;
    lastUsedAt: number;
    uses: number;
};

export function getIngestTokens(): Promise<{ tokens: IngestToken[] }> {
    return get<{ tokens: IngestToken[] }>("/api/settings/ingest-tokens");
}

/** Mints a token. `token` is the plaintext and is returned exactly once. */
export function createIngestToken(
    csrfToken: string | null,
    name: string,
): Promise<{ token: string; record: IngestToken }> {
    return send("POST", "/api/settings/ingest-tokens", csrfToken, { name });
}

export function deleteIngestToken(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/settings/ingest-tokens/delete", csrfToken, { id });
}
