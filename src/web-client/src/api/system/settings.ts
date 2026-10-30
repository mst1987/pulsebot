import { get, send, type ApiError } from "../client";
import { t } from "../../i18n";
import type { Area, Access, RolePermissions } from "./session";
import type { Category } from "../discord/channels";
import type { DiscordServers, DiscordServerCard } from "../discord/discordServers";
import type { EventSource, PlanningMode } from "../events/raidDetail";
import type { TextChannel } from "./recruitment";
import type { BotAccessRule } from "../discord/botCommands";
import type { VersionOverrides, VersionSettingsBlock } from "../../lib/settings/versionLinks";
import type { CapabilityMatrix } from "../../lib/settings/versionFeatures";
import type { AddonSetting } from "./addons";
import type { WclGuild, WclGuildInput } from "./wclGuilds";

/**
 * `color`: the role's Discord colour as hex, "" when it has none. `managed`: a
 * role a bot or an integration owns (@MEE6) — nobody can be given it, so the
 * role pickers leave it out (lib/settings/assignableRoles.ts, #745).
 */
export type Role = { id: string; name: string; color?: string; managed?: boolean };

/** A role of any configured server, for the full admin roles (#925): named with its server. */
export type AdminRole = Role & { guildId?: string; guildName?: string };

// The Battle.net client. The secret never comes back from the server — only
// whether one is stored. Read: { …, hasClientSecret }. Write: { …, clientSecret? }
// — omit clientSecret to keep the stored one, "" to clear it. The realm the
// armory asks (region, realm slug, namespace) is per game version since #542:
// AdminConfig.versionSettings.
export type BlizzardConfig = {
    clientId: string;
    hasClientSecret?: boolean;
    clientSecret?: string;
};

/** The switches of the drawn pictures in bot messages (Einstellungen → Raid-Standardwerte). */
export type DiscordVisuals = { overviewWeekStrip: boolean; setupImage: boolean; eventCover: boolean };

/** A log channel of a server and the game version its logs count for (#921); "" = the log's site decides. */
export type LogChannel = { channelId: string; versionId: string };

/** A log channel as the settings page sends it: without a version the server derives it (#921). */
export type LogChannelInput = { channelId: string; versionId?: string };

export type AdminConfig = {
    adminRoleIds: string[];
    // Per-role area rights; only sent to (and savable by) full admins.
    rolePermissions?: RolePermissions;
    // What every logged-in account gets without a role — same gate as above.
    baseAccess?: Access;
    // Area rights for single Discord accounts (keyed by user id), for areas that
    // go to named people rather than to a group — same gate as above.
    userPermissions?: RolePermissions;
    // The roles that count as orga (the rest are raider roles) — same gate as above.
    orgaRoleIds?: string[];
    // Who may use which bot command (Berechtigungen → Bot-Befehle) — same gate as above.
    botCommandAccess?: Record<string, BotAccessRule>;
    guildId: string;
    // The servers and their links (#890); full admins only, like the access keys.
    discordServers?: DiscordServers;
    raidhelperServerId: string;
    // #924: these four are the active server's values (serverSettings); a PATCH writes them there.
    officerRoleId: string;
    applicationChannelId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    /**
     * Settings per Discord server (#917): the log channels with their version
     * (#921), its own armory/log templates and realm per version (#923), the
     * Warcraft Logs guilds per version (#922).
     */
    serverSettings?: Record<string, { logChannels?: LogChannel[]; versionOverrides?: VersionOverrides; wclGuilds?: WclGuild[] }>;
    raidDefaults: { channelId: string };
    // The default raid template per category (category id → template id).
    categoryRaidTemplate: Record<string, string>;
    /** The game version the guild plays (#541); missing = "tbc". */
    mainVersion?: string;
    /**
     * The version every active category plays (#738): category id → version
     * id. The server refuses an active category without one; the main version
     * is only the default of a category switched on just now.
     */
    categoryVersion?: Record<string, string>;
    /** The sections of a category (#738): one per version it played, oldest first (read only). */
    categoryEras?: Record<string, CategoryEra[]>;
    /**
     * Write only, with a version switch (#738): what the confirmation dialog
     * chose for the category's series — "pause" or a template id of the new version —
     * and for its roster (#739): start one for the new version, with the people, with roles.
     */
    categorySwitchFixes?: Record<string, { series: string; roster?: RosterSwitchChoice }>;
    /** "Andere Versionen ausblenden" (#563): only the main version everywhere. */
    hideOtherVersions?: boolean;
    /**
     * Language of the bot's public messages on the active server (#924), default for its raiders:
     * the server's own value, else the global default; without an active server the default itself.
     */
    botLanguage?: "de" | "en";
    /** The global default every server without an own value gets (#924, new servers too). */
    botLanguageDefault?: "de" | "en";
    /** Whether the active server has its own bot language. */
    botLanguageOwn?: boolean;
    /**
     * The drawn pictures in bot messages (a test); missing switch = on. #961: what the active
     * server draws (its own switches, else the global default); without a server the default itself.
     */
    discordVisuals?: Partial<DiscordVisuals>;
    /** The global default every server without own switches gets (#961). */
    discordVisualsDefault?: Partial<DiscordVisuals>;
    /** Whether the active server has its own picture switches (#961). */
    discordVisualsOwn?: boolean;
    /** "Neue Gildenrekorde posten" (Einstellungen → Dungeon-Bestzeiten); missing = off. */
    dungeonRecords?: { post: boolean; channelId: string };
    /**
     * Settings per game version (#542): armory realm, armory/WCL templates,
     * Wowhead path, softres edition, default raidsheet. Every known version is
     * present; an empty field = not there for that version (no link).
     * `disabled` (#761): the features switched off for the version, only when there are any.
     */
    versionSettings?: Record<string, VersionSettingsBlock & { disabled?: string[] }>;
    blizzard: BlizzardConfig;
    // Claude phrases the log recommendations for the raiders. The key itself
    // never comes back from the server — only whether one is stored.
    // Read: { model, hasApiKey }. Write: { model, apiKey? } — omit apiKey to keep, "" to clear.
    anthropic?: { model: string; hasApiKey?: boolean; apiKey?: string };
    // Warcraft Logs v2 API client for the raid DPS/HPS and boss-health curves
    // of the fight timeline. Same contract as above: the secret never comes
    // back. Read: { clientId, hasClientSecret }. Write: { clientId, clientSecret? }.
    warcraftlogsV2?: { clientId: string; hasClientSecret?: boolean; clientSecret?: string };
    // GitHub token for the private addon repos (#818), full admins only. Same
    // contract: the token never comes back. Read: { hasToken }. Write: { token }.
    github?: { hasToken?: boolean; token?: string };
    // The addons of the page "Addons" (#818), full admins only; sent whole and
    // alone (Einstellungen → Module → Addons is the only sender).
    addonDownloads?: AddonSetting[];
    // Read: whether an admin edited that list (only then may it stay empty).
    addonDownloadsCustomized?: boolean;
    // Write only: "Standard wiederherstellen" - the default addons again, sent alone.
    addonDownloadsReset?: boolean;
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
    /**
     * Raid-Helper of the active server (#927), write only: omit `apiKey` to keep
     * the stored key, "" clears it. What the page reads back is `RaidhelperServer`.
     */
    raidhelper?: { enabled?: boolean; serverId?: string; apiKey?: string };
    // Setup-DMs per category (#290): only switched-on categories are listed.
    categorySetupDms?: Record<string, boolean>;
    /** The language of a category's posts: "de" / "en"; missing = the server language (botLanguage). */
    categoryLanguage?: Record<string, string>;
    /** Attendance per category (Abwesenheiten page): only what differs from shown / 11 raids / in the overview. */
    categoryAttendance?: Record<string, { show?: boolean; window?: number; absences?: boolean }>;
    // A Discord event per raid (#305): only switched-on categories are listed.
    categoryDiscordEvent?: Record<string, boolean>;
    // Left out of the server overview (/createoverview scope:server): only `false` entries are listed;
    // a `true` sent back drops the entry (shown again).
    categoryServerOverview?: Record<string, boolean>;
    // The voice channel a category's raids meet in (#305), keyed by category id.
    categoryVoiceChannel?: Record<string, string>;
    // The look of a category's signup message: raid picture below it (default on)
    // and the size of the title tiles ("normal" | "large" | "huge", default "large").
    // Only what differs from the default is listed.
    categoryMessageLook?: Record<string, { raidArt?: boolean; titleSize?: string }>;
    // "Beim Anlegen ankündigen" per category (#306): only switched-on ones are
    // listed; the announcement always goes to the event channel (#894).
    categoryAnnounce?: Record<string, { enabled: boolean }>;
    // The message with "Vielleicht" / "Absagen" per category: "required" |
    // "none"; a category without an entry is "optional".
    categorySignupNotes?: Record<string, string>;
    // Where a category's messages go instead of its server's signup note channel (#335, #924).
    categorySignupNoteChannel?: Record<string, string>;
    // How many own characters one signup may name per category (1..8); a
    // category without an entry allows 8 (signupCharacters.maxCharactersFor).
    categorySignupCharacters?: Record<string, number>;
    // A fixed Google Sheet per category, keyed by category id. A raid in that
    // category links this sheet unless the app made it a copy of its own.
    categorySheets: Record<string, { url: string; name: string }>;
    // How a category plans its raids: the raid plan or a Google Sheet, never both.
    // Only picked modes are listed; without one a category with a fixed sheet is
    // "sheet", every other "raidplan" (src/services/events/planning.js).
    categoryPlanning?: Record<string, PlanningMode>;
    // Role sync between pairs of servers (#264, pairs since #896); full admins only.
    roleSync?: RoleSyncRule[];
    // Automatic reminders per raid category (#264).
    categoryReminders?: Record<string, ReminderRule>;
};

/** One role pair between two servers of the list (#896): toTarget copies from -> to, toSource to -> from. */
export type RoleSyncRule = { fromGuildId: string; fromRoleId: string; toGuildId: string; toRoleId: string; direction: "toTarget" | "toSource" | "both" };
/** Reminders go to the raid's own server; whoever is not on it gets a DM (#894). */
export type ReminderRule = { missingHours: number; signedHours: number };

export type RoleSyncDriftGroup = {
    ruleIndex: number;
    /** The server the members kept the synced role on, and the server of the source role. */
    guildId: string;
    sourceGuildId: string;
    roleId: string;
    roleName: string;
    sourceRoleId: string;
    sourceRoleName: string;
    guildName: string;
    sourceGuildName: string;
    members: { userId: string; name: string; notOnSource: boolean; profileUrl: string }[];
};
export type RoleSyncRun = {
    at: number;
    added: number;
    failed: number;
    /** The servers the bot may not manage roles on (guild ids). */
    missingPermission: string[];
    errors: string[];
    error: string | null;
};
export type RoleSyncServer = { guildId: string; label: string; name: string; connected: boolean; canManage: boolean; roles: Role[] };
export type RoleSyncOverlap = { fromGuildId: string; toGuildId: string; fromCount: number | null; toCount: number | null; both: number | null; error: string | null };
export type RoleSyncData = {
    roleSync: RoleSyncRule[];
    /** Every server of the list with its roles; a pair picks two of them. */
    servers: RoleSyncServer[];
    /** Member overlap per server pair of the mapping; the pair is sorted. */
    overlaps: RoleSyncOverlap[];
    drift: RoleSyncDriftGroup[];
    driftTotal: number;
    /** Set when no member list could be read: the drift is unknown. */
    driftError: string | null;
    /** Servers that could not be read while others could; the drift above still counts. */
    driftErrors?: string[];
    lastRun: RoleSyncRun | null;
};
export type RemindersData = {
    categoryReminders: Record<string, ReminderRule>;
    /** `active: false`: a deactivated category (#744) — its rule stays but reminds nobody. */
    categories: { id: string; name: string; roleCount: number; active?: boolean }[];
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

/** Wowhead item search for the top-item page (settings area), in a version's Wowhead section. */
export function searchSettingsItems(q: string, version = ""): Promise<{ items: ItemSearchResult[] }> {
    const v = version ? `&version=${encodeURIComponent(version)}` : "";
    return get<{ items: ItemSearchResult[] }>(`/api/settings/item-search?q=${encodeURIComponent(q)}${v}`);
}

/** One boss of a version's loot table with everything it drops (#952). */
export type TopItemBoss = { name: string; items: TopItem[] };
export type TopItemRaid = { id: string; label: string; short: string; tierLabel: string; bosses: TopItemBoss[] };
/**
 * Einstellungen → Server → Top-Items (#952): the active server's picked items
 * of one version, with the version's loot table raid by raid (empty for a
 * version without one - Classic Era, Forever) and how many each version has.
 */
export type TopItemsPage = {
    guildId: string;
    versionId: string;
    mainVersion: string;
    versions: { id: string; label: string; short: string; count: number }[];
    raids: TopItemRaid[];
    items: TopItem[];
    max: number;
    wowheadPath: string;
};

export function getTopItems(version = ""): Promise<TopItemsPage> {
    return get<TopItemsPage>(`/api/settings/top-items${version ? `?version=${encodeURIComponent(version)}` : ""}`);
}

/** Switch one item on or off for the loaded server; 409 `server_switched` after a switch in another tab. */
export function putTopItem(input: { versionId: string; item: TopItem; on: boolean; serverSettingsGuildId: string }): Promise<{ guildId: string; versionId: string; items: TopItem[] }> {
    return send("PUT", "/api/settings/top-items", input);
}

export type Raidsheet = {
    id: string;
    name: string;
    spreadsheetId: string;
    sheetName: string;
    gid: string;
    keywords: string[];
};

/**
 * Raid-Helper of the active server as the page sees it (#927): never the key,
 * only whether there is one and - for a key entered here - its last 4 characters.
 */
export type RaidhelperServer = {
    enabled: boolean;
    /** The id Raid-Helper is asked under; "" = the Discord server's own id. */
    serverId: string;
    hasKey: boolean;
    keyLast4: string;
    /** The key comes from the bot's .env (the server Raid-Helper ran for before #927). */
    envKey: boolean;
    /** Switched on and a key at hand: the sync reads this server. */
    active: boolean;
    at: number;
    byName: string;
};

export type SettingsData = {
    config: AdminConfig;
    /** Raid-Helper of the active server (#927); null for a limited settings user. */
    raidhelper?: RaidhelperServer | null;
    /** Whether the active server reads Raid-Helper at all - without it a category offers only EventHelper. */
    raidhelperActive?: boolean;
    // False for a non-admin who only holds write access to "Einstellungen":
    // the "Zugang"/"Berechtigungen" tabs stay hidden and the server rejects them.
    canManageAccess: boolean;
    areas: Area[];
    // Display names for the accounts holding a per-user grant, so the
    // permissions tab shows people instead of 18-digit ids. Best-effort: an id
    // Discord could not resolve simply has no entry.
    userNames?: Record<string, string>;
    // Their Discord pictures, only for the accounts the bot knows one of.
    userAvatars?: Record<string, string>;
    raidsheets: Raidsheet[];
    // The raid templates, for the default-template select per category.
    raidTemplates?: { id: string; name: string; versionId: string; size: number | null }[];
    /** Einstellungen → Spielversion (#541): the versions to pick from. */
    gameVersions?: { id: string; label: string; short: string; color?: string; /** the version's launcher icon (#951), a file under public/versions */ icon?: string }[];
    /**
     * The standard values per version (#553) the "Standardwerte übernehmen"
     * button takes over; an all-empty block = the version has none yet.
     */
    versionDefaults?: Record<string, VersionSettingsBlock>;
    /** "Funktionen je Version" (#761): per version and feature possible / on / why not, from the saved settings. */
    versionCapabilities?: CapabilityMatrix;
    /** The coming raids per version (#563), for the warning before hiding the other versions. */
    upcomingByVersion?: Record<string, { id: string; title: string; startTime: number }[]>;
    /** The versions something is stored for (#563): the archive export names only those. */
    dataVersions?: string[];
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
    // The server cards; null for a limited settings user.
    servers?: { events: DiscordServerCard[] } | null;
    /** #744: configured categories Discord no longer has (only known while the bot sees every server). */
    missingCategories?: MissingCategory[];
    activeGuildId: string;
    /** Full admins only (#925): the roles of every server, for Alle Server › Voll-Admins; [] for anyone else. */
    adminRoles?: AdminRole[];
    /** Full admins only (#925): the server a listed role lives on, resolved over every server of the bot. */
    roleOrigins?: Record<string, AdminRole>;
} & ServerCategories;

/**
 * #926: `config.categoryIds` is one list over every Discord server. The server
 * answers with the active server's part of it; categories without a proven,
 * configured server show on the first server and can never be closed.
 */
export type ServerCategories = {
    serverCategoryIds?: string[];
    unprovenCategoryIds?: string[];
    /** Configured categories (any category setting) shown on another server — their rows stay off this page. */
    otherServerCategoryIds?: string[];
    /** False when the active server is not in the server list (no category of it can be closed). */
    serverListed?: boolean;
};

/** Only the per-server category fields of an answer (to copy onto the page's data). */
export function serverCategoriesOf(answer: ServerCategories): ServerCategories {
    const out: ServerCategories = {};
    if (answer.serverCategoryIds) out.serverCategoryIds = answer.serverCategoryIds;
    if (answer.unprovenCategoryIds) out.unprovenCategoryIds = answer.unprovenCategoryIds;
    if (answer.otherServerCategoryIds) out.otherServerCategoryIds = answer.otherServerCategoryIds;
    if (typeof answer.serverListed === "boolean") out.serverListed = answer.serverListed;
    return out;
}

/** The config as the active server sees it: `categoryIds` is only that server's part (#926). */
export function forServer<T extends { config: AdminConfig } & ServerCategories>(answer: T): T {
    if (!Array.isArray(answer.serverCategoryIds)) return answer;
    return { ...answer, config: { ...answer.config, categoryIds: answer.serverCategoryIds } };
}

export function getSettings(): Promise<SettingsData> {
    return get<SettingsData>("/api/settings").then(forServer);
}

/** A section of a category (#738): `from` = ms of the switch (0 = always), `name` = the category name then. */
export type CategoryEra = { versionId: string; from: number; name: string };

/** The switch dialog's choice for the roster (#739): a roster for the new version, the people taken over, its Discord roles. */
export type RosterSwitchChoice = { create: boolean; copyMembers: boolean; roleIds: string[] };

/** What a switch did to the category's roster (#739). */
export type SwitchRosterResult = {
    closed: { id: string; name: string } | null;
    reopened: { id: string; name: string } | null;
    created: { id: string; name: string; members: number } | null;
    mirrored: boolean;
};

/** A category the save switched to another version (#738), with what happened to its series and its roster (#739). */
export type SwitchedCategory = {
    categoryId: string; fromVersion: string; toVersion: string; at: number; name: string; series: "" | "paused" | "template";
    roster?: SwitchRosterResult;
};

export type SettingsUpdate = {
    config: AdminConfig;
    raidhelper?: RaidhelperServer;
    wclGuilds?: WclGuild[];
    switchedCategories?: SwitchedCategory[];
    deactivatedCategories?: DeactivatedCategory[];
    missingCategories?: MissingCategory[];
} & ServerCategories;

/**
 * PATCH /api/settings. Server-bound keys (logChannels #921, raidhelper #927)
 * go with `serverSettingsGuildId` — the server the page loaded; a session
 * switched to another server since answers 409 `server_switched`. The answer's
 * categories are narrowed to the active server (#926).
 */
export function updateSettings(partial: Partial<AdminConfig> & { logChannels?: LogChannelInput[]; wclGuilds?: WclGuildInput[]; serverSettingsGuildId?: string }): Promise<SettingsUpdate> {
    return send<SettingsUpdate>("PATCH", "/api/settings", partial).then(forServer, explainUnknownServer);
}

/**
 * #962: values of a server that is not entered under Alle Server › Discord-Server
 * would be lost — the server refuses them with 400 `unknown_server`; the message
 * then says where to enter the server first.
 */
export function explainUnknownServer(err: ApiError): never {
    throw err && err.code === "unknown_server" ? { ...err, message: t("settings.unknownServer") } : err;
}

type SwitchVersion = { id: string; label: string; short: string };

/** GET /api/settings/category-switch: what switching a category to another version means (#738). */
export type CategorySwitchPreview = {
    categoryId: string;
    name: string;
    from: SwitchVersion;
    to: SwitchVersion;
    switching: boolean;
    eras: CategoryEra[];
    /** The category's coming raids of another version: they keep it (the orga may cancel them). */
    upcoming: { id: string; title: string; startTime: number; versionId: string; source: EventSource }[];
    /** The category's series; `fits` = its template (own or the default) is of the new version. */
    series: { enabled: boolean; usesDefault: boolean; template: { id: string; name: string; versionId: string } | null; fits: boolean } | null;
    defaultTemplate: { id: string; name: string; versionId: string; fits: boolean } | null;
    /** The templates of the new version, to pick one for the series or as the default. */
    templates: { id: string; name: string }[];
    /**
     * The roster (#739): the one of the old version that will be closed, the one of the new version that already
     * exists (`reopens`: a switch closed it, it opens again), and whether a new one can be created (only from an old one).
     */
    roster?: {
        closing: { id: string; name: string; members: number } | null;
        existing: { id: string; name: string; closed: boolean; reopens: boolean } | null;
        canCreate: boolean;
    };
};

export function getCategorySwitch(categoryId: string, versionId: string): Promise<CategorySwitchPreview> {
    return get<CategorySwitchPreview>(`/api/settings/category-switch?categoryId=${encodeURIComponent(categoryId)}&versionId=${encodeURIComponent(versionId)}`);
}

/** A category's series as the lifecycle dialogs name it (#744). */
export type CategorySeriesInfo = { enabled: boolean; weekdays: number[]; time: string };

/** What deactivating a category pauses (#744): its series and reminders rest, its coming raids stay. */
export type DeactivatedCategory = {
    categoryId: string; name?: string; series: CategorySeriesInfo | null; reminders: boolean; upcoming: number;
};

/**
 * GET /api/settings/category-deactivate?next=…&guild=…: what saving these active categories pauses (#744).
 * `guildId` is the server the page loaded (#926): 409 `server_switched` when the session switched since.
 */
export function getCategoryDeactivate(next: string[], guildId = ""): Promise<{ categories: DeactivatedCategory[]; emptyBlocked: boolean }> {
    return get(`/api/settings/category-deactivate?next=${encodeURIComponent(next.join(","))}&guild=${encodeURIComponent(guildId)}`);
}

/** A configured category Discord no longer has (#744), with what "Kategorie abschließen" removes. */
export type MissingCategory = {
    categoryId: string;
    name: string;
    /** The Discord server the category was proven on (#926). */
    guildId?: string;
    active: boolean;
    series: CategorySeriesInfo | null;
    reminders: boolean;
    /** The category settings that go (config keys). */
    settings: string[];
    councilProfile: boolean;
    kaders: { kaderId: string; name: string }[];
    /** The category's rosters, one per game version (#739); closing the category closes them. */
    rosters: { id: string; name: string; versionId?: string; closed?: boolean }[];
    upcoming: number;
};

export type CategoryCloseResult = {
    ok: true;
    name: string;
    removed: { series: boolean; reminders: boolean; settings: string[]; active: boolean; councilProfile: boolean; kaders: number };
    /** The category's rosters, now closed (#739). */
    rosters: { id: string; name: string; versionId?: string; closed?: boolean }[];
    config: AdminConfig;
    missingCategories: MissingCategory[];
} & ServerCategories;

/** POST /api/settings/category-close: close a category deleted in Discord (#744). */
export function closeCategory(categoryId: string): Promise<CategoryCloseResult> {
    return send<CategoryCloseResult>("POST", "/api/settings/category-close", { categoryId }).then(forServer);
}

export function saveRaidsheet(input: Partial<Raidsheet>): Promise<Raidsheet> {
    return send("POST", "/api/settings/raidsheets", input);
}

export function deleteRaidsheet(id: string): Promise<{ id: string }> {
    return send("POST", "/api/settings/raidsheets/delete", { id });
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
    /** The Discord server the token works on (#994); "" = minted before, sees every server. */
    guildId: string;
    /** A personal key (#1000): the Discord account it belongs to, and that account's name. */
    ownerId?: string;
    ownerName?: string;
};

/** A configured server a token can be assigned to. */
export type IngestTokenServer = { guildId: string; name: string; label: string };

export function getIngestTokens(): Promise<{ tokens: IngestToken[]; servers?: IngestTokenServer[] }> {
    return get<{ tokens: IngestToken[]; servers?: IngestTokenServer[] }>("/api/settings/ingest-tokens");
}

/** Binds a token without a server to one (#994; full admins only). */
export function assignIngestToken(id: string, guildId: string): Promise<{ record: IngestToken }> {
    return send("POST", "/api/settings/ingest-tokens/assign", { id, guildId });
}

/** Mints a token. `token` is the plaintext and is returned exactly once. */
export function createIngestToken(
    name: string,
): Promise<{ token: string; record: IngestToken }> {
    return send("POST", "/api/settings/ingest-tokens", { name });
}

export function deleteIngestToken(id: string): Promise<{ id: string }> {
    return send("POST", "/api/settings/ingest-tokens/delete", { id });
}

/**
 * Saves the active server's own armory/log templates and realm per version
 * (#923). The map is sent whole for that server: a version left out falls back
 * to the standard. A wrong template comes back as 400 invalid_version_settings.
 * `guildId` is the server the page loaded (`serverSettingsGuildId`): a session
 * switched to another server since answers 409 `server_switched` (#921).
 */
export function saveVersionOverrides(guildId: string, versionOverrides: VersionOverrides): Promise<{ config: AdminConfig }> {
    return send<{ config: AdminConfig }>("PATCH", "/api/settings", { versionOverrides, serverSettingsGuildId: guildId }).catch(explainUnknownServer);
}
