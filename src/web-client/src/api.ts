// Thin fetch wrapper for the /api/* JSON layer (src/web/apiRouter.js). No React
// Query — the app is small enough that useEffect + useState covers it (see the
// migration plan discussed for this project).

import type { SpecCatalogEntry } from "./lib/recruitmentSpecs";

export type ApiError = { code: string; message: string };

// One admin-menu section a role can be given access to (src/config/permissions.js).
export type Area = { id: string; tab: string; label: string; description: string };
// What a user may do per area. Full admins hold every area at write level.
export type AreaAccess = { read: boolean; write: boolean };
export type Access = Record<string, AreaAccess | undefined>;
export type RolePermissions = Record<string, Record<string, AreaAccess>>;

export type SessionUser = { id: string; name: string; isAdmin: boolean; access: Access };
/** "event" | "talk" = the server's fixed role from Einstellungen → Discord-Server, "" = none. */
export type GuildRole = "event" | "talk" | "";
export type SessionGuild = { id: string; name: string; role?: GuildRole };
export type Session = {
    user: SessionUser | null;
    csrfToken: string | null;
    areas: Area[];
    guilds: SessionGuild[];
    activeGuildId: string;
};

/** Whether the session user may read (or write) the given area. */
export function canAccess(user: SessionUser | null, area: string, level: "read" | "write" = "read"): boolean {
    if (!user) return false;
    if (user.isAdmin) return true;
    const entry = user.access && user.access[area];
    if (!entry) return false;
    return level === "write" ? !!entry.write : !!(entry.read || entry.write);
}

/**
 * Whether the user may read (or write) at least one of the given areas — the
 * client-side twin of userCanAny() in src/config/permissions.js, for a tab that
 * more than one area opens (Historie & Loot: "history" fully, "loot" partly).
 */
export function canAccessAny(user: SessionUser | null, areas: string[], level: "read" | "write" = "read"): boolean {
    return areas.some((area) => canAccess(user, area, level));
}

export type EventLog = {
    title?: string;
    reportId?: string;
    status?: string;
    reportUrl?: string;
    reportRefId?: string;
    link?: string;
    zone?: string;
};

export type RecentEvent = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    categoryName: string;
    logs: EventLog[];
    // Logs that fit this raid time-wise but stayed unassigned (the automatic
    // match was ambiguous) — an open decision, never one of the raid's logs.
    pendingLogCount?: number;
    lootCount: number;
    softres: { url?: string } | null;
};

// One awarded top item on the dashboard's "Latest Loot" card: the loot row's
// trimmed shape (see lootStore.js's charLootPreview) plus who got it, including
// that character's class/spec look (colour + spec icon, resolved server-side
// from the character store — empty when nobody resolved the class yet).
export type TopLootAward = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    /** See LootItem.itemQuality. */
    itemQuality: number | null;
    itemLink: string;
    character: string;
    realm: string;
    boss: string;
    response: string;
    offspec: boolean;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    contentId: string;
    categoryId: string;
    eventId: string;
    eventLabel: string;
    awardedAt: number;
    className: string;
    spec: string;
    classColor: string;
    specIconUrl: string;
};

// ---- Übersicht (src/web/dashboardOverview.js decides each part) ----

export type DashboardRole = { key: "tank" | "healer" | "dps"; label: string; icon: string; filled: number; target: number };

/** A raid's sheet: its own filled copy or the category's fixed sheet; null = missing. */
export type DashboardSheet = { url: string; playerCount: number; filledAt: string } | null;

export type DashboardRaid = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    categoryId: string;
    /** WoW icon name of the raid's final boss. */
    icon: string;
    size: number;
    signupCount: number;
    setupCount: number;
    roles: DashboardRole[];
    sheet: DashboardSheet;
    softres: { url: string } | null;
};

export type DashboardTaskTone = "ok" | "mid" | "bad" | "accent";

export type DashboardTask = {
    id: "sheet" | "recommendations" | "logs" | "inbox" | "channels" | "rolesync";
    tone: DashboardTaskTone;
    /** Tile tint when it differs from the tone (the inbox wears the history area's colour). */
    tile?: string;
    icon: string;
    title: string;
    /** What the task is about: a raid/report with its date, or a ready text. */
    ref: { title?: string; at?: number; text?: string };
    count: number;
    href: string;
    tip: string;
    tipSub: string;
};

export type DashboardLastReport = {
    id: string;
    title: string;
    zone: string;
    icon: string;
    generatedAt: number;
    bosses: number;
    kills: number;
    deaths: number | null;
    avoidableDeaths: number | null;
    gear: number;
    consumables: number;
    buffs: number;
    problems: number;
    open: number;
};

export type DashboardData = {
    kicker: { guild: string; realm: string };
    nextRaid: DashboardRaid | null;
    followingRaid: DashboardRaid | null;
    nextRaidError: string | null;
    tasks: DashboardTask[];
    areas: {
        lastReport: DashboardLastReport | null;
        newLoot: { count: number; since: number };
        recruitment: { posts: number };
        roster: { total: number; withoutDiscord: number } | null;
    };
    recentEvents: { events: (RecentEvent & { icon: string })[]; error: string | null };
    // Latest awards of the items defined as "top items" in Einstellungen → Loot.
    // `configured` is how many are defined at all, which distinguishes "nothing
    // configured" from "configured, but nothing dropped yet".
    topLoot: { items: TopLootAward[]; configured: number };
    activeGuildId: string;
};

export type Category = { id: string; name: string };
export type Channel = {
    id: string;
    name: string;
    type: number;
    typeLabel: string;
    category: string;
    parentId: string;
    // Whether the bot may see / post in the channel (true while unknown).
    botCanView?: boolean;
    botCanSend?: boolean;
};

export type PurposeStatus = { tone: "ok" | "mid" | "bad" | ""; label: string; tip: string };

// What the bot uses which channel for (src/web/channelPurposes.js). Stored in
// the admin config like before; `key` is the config key a change is saved under.
export type ChannelPurpose = {
    id: string;
    label: string;
    icon: string;
    key: string;
    kind: "channel" | "category";
    multiple: boolean;
    need: "send" | "read" | null;
    section: string;
    hint: string;
    ids: string[];
    items: { id: string; name: string; found: boolean; status: PurposeStatus }[];
    status: PurposeStatus;
};

export type ChannelsData = {
    categories: Category[];
    channels: Channel[];
    activeGuildId: string;
    guildName: string;
    connected: boolean;
    purposes: ChannelPurpose[];
    purposeSummary: { set: number; missing: number; warnings: number };
    /** Tracked recruitment posts per channel id. */
    recruitmentPosts: Record<string, number>;
    /** Topic, slowmode and permission sync per channel id (issue #259). */
    details: Record<string, ChannelDetails>;
    /** Whether the bot may manage channels on this server; null while unknown. */
    canManage: boolean | null;
    /** The raid event a channel belongs to: upcoming ("event") or over ("past"). */
    events: Record<string, ChannelEvent>;
    archive: ChannelArchive;
    /** Stored quick-create schema per category id. */
    schemas: Record<string, ChannelSchema>;
    /** Whether the viewer may use "gleich Event anlegen" (raids write). */
    canCreateEvents?: boolean;
    /** Per category: its default raid template and the source of new events. */
    eventDefaults?: Record<string, ChannelEventDefaults>;
    defaultSchema: string;
    placeholders: { key: string; hint: string }[];
};

export type ChannelDetails = { topic: string; rateLimitPerUser: number; permissionsLocked: boolean | null };
export type ChannelEvent = { status: "event" | "past"; title: string; startTime: number; eventId: string };
/** `time` = the start time "gleich Event anlegen" last used in the category. */
export type ChannelSchema = { schema: string; raid: string; templateChannelId: string; time?: string };
export type ChannelEventDefaults = { templateId: string; templateName: string; source: "raidhelper" | "eventhelper" };
export type ChannelArchiveRow = {
    id: string;
    name: string;
    /** When it was archived (epoch ms), 0 when moved there by hand. */
    at: number;
    by: string;
    fromCategory: string;
    waitingDays: number | null;
    overdue: boolean;
};
export type ChannelArchive = {
    categoryId: string;
    count: number;
    overdue: number;
    hintDays: number;
    rows: ChannelArchiveRow[];
};

/** One channel's outcome of a bulk action. */
export type ChannelResult = {
    id: string;
    ok: boolean;
    error?: string;
    name?: string;
    /** Quick-create with "gleich Event anlegen": the event made in this channel, or why none. */
    eventId?: string;
    eventError?: string;
};
export type ChannelBulkResult = { results: ChannelResult[]; done: number; failed: number; message: string };
export type ChannelChanges = { name?: string; topic?: string; parentId?: string; rateLimitPerUser?: number };

/** Change channels; only the fields present in `changes` are applied. */
export function patchChannels(csrfToken: string | null, ids: string[], changes: ChannelChanges): Promise<ChannelBulkResult> {
    return send("PATCH", "/api/channels", csrfToken, { ids, changes });
}

export function archiveChannels(csrfToken: string | null, ids: string[]): Promise<ChannelBulkResult> {
    return send("POST", "/api/channels/archive", csrfToken, { ids });
}

/** Delete from the archive; `confirm` is the channel's name, or LÖSCHEN for several. */
export function deleteChannels(csrfToken: string | null, ids: string[], confirm: string): Promise<ChannelBulkResult> {
    return send("POST", "/api/channels/delete", csrfToken, { ids, confirm });
}

/**
 * Where a channel name comes from (#285): like the previous event channel of the
 * category ("previous"), its stored schema ("schema"), the default schema
 * ("default") or a schema typed into the dialog ("typed"). `label` is the badge,
 * `detail` and `design` its tooltip.
 */
export type ChannelNaming = {
    source: "previous" | "schema" | "default" | "typed";
    label: string;
    detail: string;
    design: string;
    fromChannel: string;
    templateChannelId: string;
    templateChannelName: string;
};
export type ChannelNameSuggestion = ChannelNaming & { name: string; replaced: { part: string; from: string; to: string }[] };

export type RenamePreviewRow = { id: string; from: string; to: string; hasDate: boolean; conflict: boolean; naming?: ChannelNaming | null };

export function renamePreview(csrfToken: string | null, input: { ids: string[]; schema: string; raid: string }): Promise<{ rows: RenamePreviewRow[] }> {
    return send("POST", "/api/channels/rename-preview", csrfToken, input);
}

export type QuickCreateInput = {
    categoryId: string;
    schema: string;
    raid: string;
    from: string;
    count: number;
    interval: "once" | "weekly";
    templateChannelId: string;
    saveSchema?: boolean;
    dryRun?: boolean;
    /** "gleich Event anlegen": an event per created channel at `time` ("19:30"). */
    withEvent?: boolean;
    time?: string;
};
export type QuickCreatePlanRow = { date: string; name: string; exists: boolean };

export function quickCreateChannels(csrfToken: string | null, input: QuickCreateInput): Promise<{ plan: QuickCreatePlanRow[]; naming?: ChannelNaming | null } & Partial<ChannelBulkResult> & { skipped?: number }> {
    return send("POST", "/api/channels/batch", csrfToken, input);
}

export function saveChannelConfig(
    csrfToken: string | null,
    input: { archiveCategoryId?: string; archiveDeleteHintDays?: number; createArchiveCategory?: string },
): Promise<{ config: { archiveCategoryId: string; archiveDeleteHintDays: number } }> {
    return send("POST", "/api/channels/config", csrfToken, input);
}

/**
 * Store a purpose's channels (or categories). The assignment is a setting, so
 * it goes through PATCH /api/settings and needs write access to Einstellungen.
 */
export function saveChannelPurpose(csrfToken: string | null, purpose: ChannelPurpose, ids: string[]): Promise<{ config: AdminConfig }> {
    const clean = [...new Set(ids.filter(Boolean))];
    const partial: Record<string, unknown> = purpose.key === "raidDefaults.channelId"
        ? { raidDefaults: { channelId: clean[0] || "" } }
        : { [purpose.key]: purpose.multiple ? clean : (clean[0] || "") };
    return send("PATCH", "/api/settings", csrfToken, partial);
}

/**
 * Read a response body as JSON without letting a non-JSON body escape as a bare
 * "Unexpected token". Anything that is not JSON — a gateway timeout page from a
 * reverse proxy in front of a slow route, an HTML error page — is turned into a
 * readable ApiError that names the status instead of the parser's complaint.
 */
async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        const snippet = text.trim().slice(0, 120);
        throw {
            code: "bad_response",
            message: res.ok
                ? `Unerwartete Antwort vom Server (kein JSON): ${snippet}`
                : `Serverfehler (HTTP ${res.status}). Antwort: ${snippet}`,
        } as ApiError;
    }
}

function errorFrom(body: Record<string, unknown> | null, res: Response): ApiError {
    const err = body && (body.error as ApiError | undefined);
    return err || { code: "unknown", message: `HTTP ${res.status}` };
}

async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: "include" });
    const body = await parseJson(res);
    if (!res.ok) throw errorFrom(body, res);
    return (body?.data ?? null) as T;
}

// Mutating requests carry the CSRF token from GET /api/session as a header
// (the SSR forms use a hidden _csrf field instead — see src/web/auth.js).
async function send<T>(method: string, path: string, csrfToken: string | null, jsonBody?: unknown): Promise<T> {
    const res = await fetch(path, {
        method,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(jsonBody ?? {}),
    });
    const body = await parseJson(res);
    if (!res.ok) throw errorFrom(body, res);
    return (body?.data ?? null) as T;
}

export function getSession(): Promise<Session> {
    return get<Session>("/api/session");
}

export function switchGuild(csrfToken: string | null, guildId: string): Promise<{ activeGuildId: string }> {
    return send("POST", "/api/session/guild", csrfToken, { guildId });
}

export function getDashboard(): Promise<DashboardData> {
    return get<DashboardData>("/api/dashboard");
}

export type NextRaidNotSigned = {
    id: string;
    name: string;
    className: string;
    classColor: string;
    role: string;
    status: "none" | "tentative" | "bench" | "absence";
    statusLabel: string;
};

export type NextRaidDetails = DashboardRaid & {
    classes: { className: string; label: string; classColor: string; icon: string; count: number }[];
    notSignedUp: NextRaidNotSigned[];
    rolesConfigured: boolean;
    membersError: string | null;
    fetchedAt: number;
};

/** The "Raid-Details" modal of the start page, loaded when it opens. */
export function getNextRaidDetails(eventId: string): Promise<{ raid: NextRaidDetails; activeGuildId: string }> {
    return get(`/api/dashboard/next-raid?event=${encodeURIComponent(eventId)}`);
}

export function getChannels(): Promise<ChannelsData> {
    return get<ChannelsData>("/api/channels");
}

export function createChannel(
    csrfToken: string | null,
    input: { name: string; type: string; parentId: string },
): Promise<{ id: string; name: string }> {
    return send("POST", "/api/channels", csrfToken, input);
}

export function duplicateChannel(
    csrfToken: string | null,
    input: { channelId: string; name: string },
): Promise<{ id: string; name: string }> {
    return send("POST", "/api/channels/duplicate", csrfToken, input);
}

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
    // Where NEW events of a category are created, keyed by category id. Missing
    // = "raidhelper"; Raid-Helper events stay in use either way.
    categorySignupSource?: Record<string, EventSource>;
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
    // Status line of the "Discord & Raid-Helper" connection card.
    bot?: { online: boolean; readySince: number; guildName: string };
    // The event and talk server cards; null for a limited settings user.
    servers?: { event: DiscordServerCard | null; talk: DiscordServerCard | null } | null;
    activeGuildId: string;
};

export type DiscordServers = {
    eventGuildId: string;
    talkGuildId: string;
    talkOverviewChannelId: string;
    talkPingChannelId: string;
};

export type BotPermission = { key: string; label: string; ok: boolean };

/** One configured server as the settings card shows it (src/web/guildRoles.js). */
export type DiscordServerCard = {
    role: "event" | "talk";
    id: string;
    name: string;
    connected: boolean;
    memberCount: number | null;
    iconUrl: string;
    /** null = not knowable (bot offline or not on that server). */
    permissions: BotPermission[] | null;
    missing: string[];
};

export type MemberOverlap = { eventCount: number | null; talkCount: number | null; both: number | null; error: string | null };

export type DiscordServersData = {
    discordServers: DiscordServers;
    event: DiscordServerCard | null;
    talk: DiscordServerCard | null;
    /** null in the one-server setup. */
    overlap: MemberOverlap | null;
    guilds: (SessionGuild & { channels: TextChannel[] })[];
};

export function getDiscordServers(): Promise<DiscordServersData> {
    return get<DiscordServersData>("/api/settings/discord-servers");
}

/** The raid overview on the talk server (#257, src/web/talkOverview.js). Times are epoch ms, 0 = never. */
export type TalkOverviewStatus = {
    configured: boolean;
    channelId: string;
    messageId: string;
    messageUrl: string;
    postedAt: number;
    editedAt: number;
    checkedAt: number;
    error: string;
};

export function getTalkOverview(): Promise<{ status: TalkOverviewStatus }> {
    return get<{ status: TalkOverviewStatus }>("/api/settings/talk-overview?preview=0");
}

export function repostTalkOverview(csrfToken: string | null): Promise<{ result: { status: string; error?: string }; status: TalkOverviewStatus }> {
    return send("POST", "/api/settings/talk-overview", csrfToken, { repost: true });
}

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

// Manual raider->character-per-category assignments (see raiderCharactersStore.js
// on the backend). Used to enrich the Raid-Detail attendance tab's "missing" list
// with the character a raider actually plays for that raid category.
export type RaiderCharactersData = {
    members: { id: string; displayName: string }[];
    membersError: string | null;
    roleIds: string[];
    assignments: Record<string, string>;
    knownCharacters: string[];
};

export function getRaiderCharacters(categoryId: string): Promise<RaiderCharactersData> {
    return get<RaiderCharactersData>(`/api/raider-characters?category=${encodeURIComponent(categoryId)}`);
}

export function saveRaiderCharacters(
    csrfToken: string | null,
    categoryId: string,
    assignments: Record<string, string>,
): Promise<{ assignments: Record<string, string> }> {
    return send("POST", "/api/raider-characters", csrfToken, { categoryId, assignments });
}

// ===== Roster (all characters per raid category) =====
// Assembled server-side by src/web/roster.js from the manual per-category
// assignments plus the imported loot; gear issues come from the newest CLA
// evaluation that contains the character (src/web/charGearIssues.js). Colours,
// icons and links are computed server-side, same rule as AnnotatedCharacter.

// One gear finding from a CLA evaluation ("kein Item", "keine Verzauberung",
// "leerer Sockel", …) — mirrors utils/logcheck/gearIssues.js's issue objects.
// High findings come first (see charGearIssues.js), so a capped list always
// leads with what actually costs the raid something.
export type GearIssue = {
    kind: string;
    label: string;
    severity: "high" | "medium";
    itemId: string;
    itemName: string;
    /** "Kopf", "Ring 1", … — empty when the report carried no usable slot. */
    slotName: string;
    /** Paperdoll slot key ("HEAD", "FINGER_1", …) the finding belongs to; "" without a slot. */
    slotKey?: string;
    iconUrl: string;
};

// The newest evaluation a character appears in, plus its findings for them.
// `reportRefId` addresses the locally stored report (/r/<id>), `reportUrl` the
// Warcraft-Logs report it was built from.
export type CharGearReport = {
    character: string;
    className: string;
    issues: GearIssue[];
    issueCount: number;
    reportRefId: string;
    reportId: string;
    reportUrl: string;
    reportTitle: string;
    zone: string;
    generatedAt: number;
};

export type RosterChar = {
    key: string;
    character: string;
    realm: string;
    categoryIds: string[];
    /** Has a manual raider->character assignment (vs. only known from loot). */
    assigned: boolean;
    raiderIds: string[];
    lootCount: number;
    items: CharLootPreview[];
    className: string;
    spec: string;
    source: string;
    classColor: string;
    iconUrl: string;
    armoryUrl: string;
    wclUrl: string;
    gear: CharGearReport | null;
    /** The newest log's role, else the spec's; "" when unknown (web/rosterAttendance.js). */
    role: RosterRole;
    /** Per category id: attendance over its last raid nights. */
    attendance: Record<string, RosterAttendance>;
};

export type RosterRole = "tank" | "healer" | "dps" | "";

export type RosterNight = { eventId: string; title: string; startTime: number; attended: boolean; reason: string };

export type RosterAttendance = {
    attended: number;
    total: number;
    /** null when no night could be counted. */
    pct: number | null;
    missed: Omit<RosterNight, "attended">[];
    /** Night by night — only in the character page's answer. */
    raids?: RosterNight[];
};

/** What a category's group head says: counted nights, its raids, the newest raid's boss icon. */
export type RosterCategoryInfo = { raids: number; contents: string[]; icon: string };

/** One segment of the roster's class distribution — see web/rosterStats.js. */
export type RosterClassShare = { className: string; classColor: string; count: number };

/**
 * The header band's numbers, folded server-side over the same rows the table
 * below renders. They describe the *whole* roster: the filter bar underneath
 * narrows the table, not the headline.
 */
export type RosterStats = {
    total: number;
    assigned: number;
    fromLootOnly: number;
    categories: number;
    uncategorized: number;
    loot: number;
    evaluated: number;
    withIssues: number;
    clean: number;
    issues: number;
    highIssues: number;
    /** Mean attendance share in percent; null when no character had a counted night. */
    avgAttendance: number | null;
    attendanceCounted: number;
    classes: RosterClassShare[];
};

/** Why and since when a character is off the roster (web/rosterHiddenStore.js). */
export type RosterHiddenNote = { character: string; reason: string; at: number; by: string };

export type RosterData = {
    chars: RosterChar[];
    /** Taken off the roster — the page's "Ausgeblendet" tab, not part of `stats`. */
    hiddenChars: (RosterChar & { hidden: RosterHiddenNote })[];
    categories: Category[];
    categoryInfo: Record<string, RosterCategoryInfo>;
    stats: RosterStats;
    activeGuildId: string;
};

export function getRoster(): Promise<RosterData> {
    return get<RosterData>("/api/roster");
}

/**
 * Take a character off the roster, or put it back.
 *
 * Deletes nothing — the loot history, the evaluations and the character page
 * stay whole; the roster simply stops listing them.
 */
export function setRosterHidden(
    csrfToken: string | null,
    character: string,
    hidden: boolean,
    reason = "",
): Promise<{ character: string; hidden: boolean }> {
    return send("POST", "/api/roster/hide", csrfToken, { character, hide: hidden, reason });
}

/** A spec whose BiS list carries an item — see lootCouncil.js's bisSpecsView(). */
export type RosterBisSpec = { specKey: string; label: string; iconUrl: string; classColor: string; role: string; tier: string; alsoFor: string[] };

export type RosterItemFacts = { itemId: number; contentId: string; content: string; boss: string; tier: string; bisSpecs: RosterBisSpec[] };

export type RosterCharData = {
    character: string;
    role: RosterRole;
    categories: (RosterCategoryInfo & { id: string; name: string })[];
    attendance: Record<string, RosterAttendance>;
    items: Record<string, RosterItemFacts>;
};

/** The character page's roster facts: role, attendance night by night, drop source and BiS per worn item. */
export function getRosterChar(name: string, itemIds: number[] = []): Promise<RosterCharData> {
    const items = itemIds.length ? `&items=${itemIds.join(",")}` : "";
    return get<RosterCharData>(`/api/roster/char?name=${encodeURIComponent(name)}${items}`);
}

// A row of the Raid-Events list — mirrors src/web/raidListing.js. `contentIds`
// are the raid(s) the event is (for the boss icon), [] when nothing was
// recognised; `contentSources` says where that came from.
type RaidListBase = {
    id: string;
    source?: EventSource;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    contentIds: string[];
    contentSources: string[];
    softres: { url: string } | null;
};
export type UpcomingRaid = RaidListBase & {
    signupCount: number;
    /** 10 for a ten-player night, else 25; `raidSizeKnown` false = only the default. */
    raidSize: number;
    raidSizeKnown: boolean;
};
export type PendingRaidLog = { title: string; alsoFits: string[] };
export type PastRaid = RaidListBase & {
    logs: EventLog[];
    pendingLogs: PendingRaidLog[];
    pendingLogCount: number;
    lootCount: number;
};
export type RaidsData = { events: UpcomingRaid[]; error: string | null; activeGuildId: string; guildName: string };
export type PastRaidsData = { events: PastRaid[]; error: string | null; activeGuildId: string };

export function getRaids(): Promise<RaidsData> {
    return get<RaidsData>("/api/raids");
}

export function getPastRaids(): Promise<PastRaidsData> {
    return get<PastRaidsData>("/api/raids/past");
}

// ===== Raid detail (per-event page) =====
// Part A (Setup/Anwesenheit/Loot, read-only) — see renderAdmin.js's renderEventDetail().
// Part B (this section's remainder): the mutating tabs (Anmeldung & Sheet, Softres) +
// header quick-post buttons, plus the standalone Notify-Templates CRUD page.

// Anmelde-Aufruf template — same shape src/web/settingsStore.js's listNotify()/saveNotify()
// persist (id/name/title/body; createdAt/updatedAt are stored but not surfaced here).
export type NotifyTemplate = { id: string; name: string; title: string; body: string };

export function getNotifyTemplates(): Promise<{ templates: NotifyTemplate[] }> {
    return get<{ templates: NotifyTemplate[] }>("/api/notify-templates");
}

export function saveNotifyTemplate(
    csrfToken: string | null,
    input: { id?: string; name: string; title: string; body: string },
): Promise<{ template: NotifyTemplate }> {
    return send("POST", "/api/notify-templates", csrfToken, input);
}

export function deleteNotifyTemplate(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/notify-templates/delete", csrfToken, { id });
}

/** Role bucket of a raidplan spec — mirrors roleOf() in src/utils/setupView.js. */
export type SetupRole = "tank" | "healer" | "melee" | "ranged" | "dps";
export type SetupPlayer = { name: string; classColor: string; specName: string; className: string; iconUrl: string; role?: SetupRole; group?: number };
export type SetupGroup = { label: string; players: SetupPlayer[] };
export type EventSetup = { total: number; groups: SetupGroup[]; roleCounts?: Partial<Record<SetupRole, number>> } | null;

/** One step of the Raid-Detail progress bar — built by src/web/raidDetailSteps.js. */
export type RaidStepKey = "signup" | "setup" | "sheet" | "softres" | "loot" | "logs";
export type RaidDetailModal = "notify" | "sheet" | "softres" | "loot" | "log" | "ping" | "move" | "cancel" | "raider" | "history";
export type RaidStep = {
    key: RaidStepKey;
    label: string;
    icon: string;
    tone: "ok" | "mid" | "bad" | "none";
    value: string;
    unit: string;
    fill?: number | null;
    badge: { label: string; tone?: "ok" | "mid" | "bad" | "accent" };
    tip: { head: string; sub: string };
    open: { modal?: RaidDetailModal; tab?: "roster" | "setup" | "loot" | "logs" };
    done: boolean;
    next: boolean;
};
export type RaidPrimaryAction = {
    label: string;
    icon: string;
    modal?: RaidDetailModal;
    href?: string;
    /** Open a tab of the page (an own event's setup editor). */
    tab?: "setup";
    evaluate?: { logId: string; section: LogSection };
};
export type RaidProgress = { steps: RaidStep[]; next: RaidStepKey | ""; primary: RaidPrimaryAction | null };

/** What the player dialog shows beyond this raid — src/web/raidPlayerSummary.js. */
export type RaidPlayerSummary = {
    /** Raids of the category in the last 8 weeks the raider was in; null = unknown. */
    raids: number | null;
    raidsOf: number;
    /** Real loot (no shards/bank/offspec) in the last 8 weeks. */
    loot: number;
    lastLootAt: number;
    recent: Array<{
        itemId: number; itemName: string; itemIconUrl: string; itemQuality: number | null; itemLink: string;
        response: string; reasonLabel: string; reasonTone: string; awardedAt: number;
    }>;
};

export type AttendanceProfile = { classColor: string; specName: string; className: string; iconUrl: string };
// What the raider's reaction said — mirrors SIGNUP_STATUSES in
// src/utils/attendance.js. Only set on `responded`; someone who has not reacted
// has no status at all.
export type SignupStatus = "signed" | "tentative" | "late" | "bench" | "absence";
export type AttendancePerson = { id: string; displayName: string; character?: string; status?: SignupStatus; profile: AttendanceProfile | null };
export type Attendance = { responded: AttendancePerson[]; missing: AttendancePerson[] };

/** Where an event lives: at Raid-Helper, or in the EventHelper's own store (src/web/eventSources.js). */
export type EventSource = "raidhelper" | "eventhelper";

export type RaidDetailEvent = {
    id: string;
    source?: EventSource;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    signupCount: number;
    // The raid already started.
    isPast?: boolean;
    // false → the signup roster is UNKNOWN (a past raid whose signups Raid-Helper
    // dropped and that was never snapshotted), not empty. Never render it as 0.
    signupsKnown?: boolean;
    // The roster shown was restored from the local snapshot, not answered live.
    signUpsFromSnapshot?: boolean;
    // Event verwalten (#288), only on an own event.
    status?: "active" | "cancelled";
    signupsClosed?: boolean;
    cancelReason?: string;
    cancelArchived?: boolean;
    logCount?: number;
};

// ---- Event verwalten (#288): GET/POST /api/raids/manage* ----

export type ManageLogEntry = { at: number; action: string; label: string; by: string; byName: string; detail: string };
export type ManageInfo = {
    event: {
        id: string; title: string; startTime: number; when: string; signupDeadline: number;
        status: "active" | "cancelled"; signupsClosed: boolean; cancel: { reason: string; at: number; by: string; byName: string; archived: boolean } | null;
        channelId: string; channelName: string; categoryId: string;
    };
    started: boolean;
    counts: { attending: number; size: number; tentative: number; bench: number; absence: number };
    recipients: { userId: string; name: string; character: string; status: SignupStatus }[];
    archive: { configured: boolean };
    log: ManageLogEntry[];
};
export type MovePlan = {
    eventId: string;
    title: string;
    from: { startTime: number; label: string };
    to: { startTime: number; label: string };
    signupDeadline: number;
    deadlineLabel: string;
    channel: { id: string; current: string; next: string; rename: boolean; label: string; detail: string; reason: string };
    recipients: number;
};
export type ManageResult = { message: string; warnings?: string[] };
export type ManageSpec = { key: string; label: string; role: GameRole; icon: string };
export type ManageRaider = {
    userId: string;
    name: string;
    characters: { key: string; name: string; className: string; main: boolean; specs: ManageSpec[] }[];
    signup: { character: string; spec: string; status: SignupStatus } | null;
};
export type ManageCandidates = {
    raiders: ManageRaider[];
    classes: { id: string; label: string; color: string; icon: string; specs: ManageSpec[] }[];
};

export function getManageInfo(eventId: string): Promise<ManageInfo> {
    return get<ManageInfo>(`/api/raids/manage?event=${encodeURIComponent(eventId)}`);
}

export function getMovePreview(eventId: string, date: string, time: string): Promise<MovePlan> {
    const q = new URLSearchParams({ event: eventId, date, time });
    return get<MovePlan>(`/api/raids/manage/move?${q.toString()}`);
}

export function moveRaid(csrfToken: string | null, input: { event: string; date: string; time: string; renameChannel: boolean; notify: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/move", csrfToken, input);
}

export function setRaidSignupsOpen(csrfToken: string | null, input: { event: string; open: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/signups", csrfToken, input);
}

export function getRaiderCandidates(eventId: string): Promise<ManageCandidates> {
    return get<ManageCandidates>(`/api/raids/manage/raider?event=${encodeURIComponent(eventId)}`);
}

export function addRaiderToRaid(
    csrfToken: string | null,
    input: { event: string; userId: string; character: string; spec: string; status: SignupStatus },
): Promise<ManageResult & { profileChanged?: boolean }> {
    return send("POST", "/api/raids/manage/raider", csrfToken, input);
}

export function removeRaiderFromRaid(csrfToken: string | null, input: { event: string; userId: string }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/raider/remove", csrfToken, input);
}

export function cancelRaid(csrfToken: string | null, input: { event: string; reason: string; archiveChannel: boolean; notify: boolean }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/cancel", csrfToken, input);
}

export function reopenRaid(csrfToken: string | null, input: { event: string }): Promise<ManageResult> {
    return send("POST", "/api/raids/manage/reopen", csrfToken, input);
}

export type RaidDetailEventSheet = {
    url: string; eventTitle: string; deleteAfter: number;
    postedChannelId?: string; postedMessageId?: string; postedMessage?: string;
} | null;
export type EventSoftres = {
    url: string; editUrl: string; instances: unknown[]; amount: number; hardReserveCount: number;
    postedChannelId?: string; postedMessageId?: string; postedMessage?: string;
} | null;

// A raider in the current raidplan setup whose spec/class can tank — offered as
// 3rd-tank candidates on the "Raidsheet füllen" form. Mirrors src/utils/setupView.js's
// tankCandidates(): className is always a string there, but empty when unresolved.
export type TankCandidate = { name: string; specName: string; className?: string };

// A single softres.it raid instance, and its edition-grouped catalogue — mirrors
// src/utils/softres.js's instancesForEdition()/catalogue() (an instance's `slots`
// exists server-side too but isn't needed by this UI).
export type SoftresInstance = { code: string; name: string; slots?: number };
export type SoftresCatalogueGroup = { edition: string; label: string; instances: SoftresInstance[] };

export type RaidDetailData = {
    event: RaidDetailEvent;
    categoryName: string;
    guildId: string;
    eventsWarning: string | null;
    notifyTemplates: NotifyTemplate[];
    roles: Role[];
    /** Whether the ping/notify modals may offer the talk server (#264). */
    pingTargets?: PingTargetInfo;
    raidsheets: Raidsheet[];
    matchedSheetId: string;
    setup: EventSetup;
    setupError: string | null;
    // The setup shown was restored from the local snapshot (Raid-Helper no longer
    // serves the raidplan of this finished raid).
    setupFromSnapshot?: boolean;
    tankCandidates: TankCandidate[];
    eventSheet: RaidDetailEventSheet;
    // Which sheet this raid actually links: its own filled copy ("event"), else
    // the fixed sheet assigned to its category ("category"), else null.
    sheetLink: { url: string; name: string; source: "event" | "category" } | null;
    eventSoftres: EventSoftres;
    softresCatalogue: SoftresCatalogueGroup[];
    softresEdition: string;
    softresSuggested: string[];
    attendance: Attendance;
    /** An own event's signups with "kann auch" and comment; null for a Raid-Helper event. */
    ownSignups?: EventSignupEntry[] | null;
    /** An own event's setup state (#263): counts only, the lineup comes from GET /api/raids/setup. */
    ownSetup?: { status: "draft" | "approved"; changedSinceApproval: boolean; version: number; placed: number; size: number; bench: number; ok: boolean; approvedAt: number } | null;
    attendanceRoleIds: string[];
    membersError: string | null;
    signupTarget: number;
    lootItems: LootItem[];
    lootTool: string;
    eventLogs: RaidLogRow[];
    unlinkedLogs: RaidLogRow[];
    /** The progress bar and the head's primary action. */
    progress: RaidProgress;
    /** Keyed by the lowercased character name. */
    playerSummaries: Record<string, RaidPlayerSummary>;
};

// Trimmed-down LogRow (see below) for the raid detail page's Logs tab — same
// shape as what the CLA logs list uses, minus the match-candidate fields that
// only apply there.
export type RaidLogRow = {
    id: string;
    title: string;
    reportId: string;
    link: string;
    status: "open" | "done";
    reportUrl: string;
    reportRefId: string;
    /** Which analyses already ran for this log ("cla" / "rpb"). */
    sections?: string[];
};

/** The two analysis halves a log can be evaluated for. */
export type LogSection = "cla" | "rpb";

export function getRaidDetail(eventId: string): Promise<RaidDetailData> {
    return get<RaidDetailData>(`/api/raids/detail?event=${encodeURIComponent(eventId)}`);
}

// ---- Raid detail Part B: mutating actions (Anmeldung & Sheet, Softres tabs, header quick-posts) ----

export function notifyRaid(
    csrfToken: string | null,
    input: { event: string; templateId: string; channelId: string; roleIds: string[]; target?: PingTarget },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/notify", csrfToken, input);
}

export function pingMissingRaiders(
    csrfToken: string | null,
    input: { event: string; text: string; target?: PingTarget },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/ping-missing", csrfToken, input);
}

export function fillRaidsheet(
    csrfToken: string | null,
    input: { event: string; sheetId: string; tank3: string; eventTitle: string; eventStartTime: number },
): Promise<{ message: string; playerCount: number }> {
    return send("POST", "/api/raids/fill", csrfToken, input);
}

export function postRaidSheet(
    csrfToken: string | null,
    input: { event: string; message?: string },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/post-sheet", csrfToken, input);
}

export function postRaidSoftres(
    csrfToken: string | null,
    input: { event: string; message?: string },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/post-softres", csrfToken, input);
}

export type SoftresSearchItem = ItemSearchResult;

export function searchSoftresItems(edition: string, q: string): Promise<{ items: SoftresSearchItem[] }> {
    const qs = new URLSearchParams({ edition, q });
    return get<{ items: SoftresSearchItem[] }>(`/api/raids/softres/item-search?${qs.toString()}`);
}

export function createSoftres(
    csrfToken: string | null,
    input: {
        event: string;
        instanceCodes: string[];
        amount: number;
        faction: string;
        hardReserves: Array<{ id: number; name: string }>;
        hideReserves: boolean;
        /** softres.it "User Protection": Login-Pflicht zum Reservieren; ohne Angabe aktiv. */
        protection?: boolean;
    },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/softres", csrfToken, input);
}

export function linkSoftres(
    csrfToken: string | null,
    input: { event: string; softresUrl: string; softresEditUrl: string },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/softres/link", csrfToken, input);
}

// Raid templates (#266, src/web/raidTemplates.js): what an evening looks like.
export type RoleRange = { min: number; max: number | null };

export type RaidTemplateInput = {
    id?: string;
    name: string;
    versionId: string;
    /** from the rule set only (GET /api/game-versions) */
    instanceIds: string[];
    /** null = not set yet (a migrated Raid-Helper template) */
    size: number | null;
    composition: { tank: number; healer: number; melee: RoleRange | null; ranged: RoleRange | null };
    /** buff keys of the version */
    requiredBuffs: string[];
    signupDeadline: { hoursBefore: number } | null;
    fairness: boolean;
    wishes: boolean;
    raidhelperTemplateId: string;
};

export type RaidTemplate = RaidTemplateInput & {
    id: string;
    createdAt?: number;
    updatedAt?: number;
    /** migrated without size: badge "Größe ergänzen" */
    needsSize?: boolean;
    /** an instance still "Infos fehlen" */
    incomplete?: boolean;
    /** the categories using it as their default */
    defaultFor?: string[];
};

export type ReusableEvent = {
    id: string;
    title: string;
    templateId: string;
    description: string;
    channelId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    startTime: number;
    contentIds: string[];
};

/** An EventHelper event as src/web/eventStore.js hands it out (the fields the dialog reads). */
export type OwnEvent = {
    id: string;
    source: "eventhelper";
    guildId: string;
    categoryId: string;
    categoryName: string;
    channelId: string;
    channelName: string;
    title: string;
    description: string;
    leaderId: string;
    /** unix seconds */
    startTime: number;
    versionId: string;
    instanceIds: string[];
    size: number;
    /** melee/ranged: the minimum (0 = no target) */
    composition: { tank: number; healer: number; melee: number; ranged: number };
    /** the optional maxima of melee/ranged, null = open */
    compositionMax: { melee: number | null; ranged: number | null };
    requiredBuffs: string[];
    raidTemplateId: string;
    /** unix seconds, 0 = none */
    signupDeadline: number;
    fairness: boolean;
    wishes: boolean;
    autoSuggest: boolean;
};

export type RaidCreateContext = {
    /** templateId: the Raid-Helper template of the default channel's category */
    defaults: { templateId: string; channelId: string };
    /** category id → Raid-Helper template id of its default raid template */
    categoryTemplates: Record<string, string>;
    leaderId: string;
    channels: Channel[];
    templates: RaidTemplate[];
    reusableEvents: ReusableEvent[];
    /** category id → "eventhelper" for categories whose new events live in the EventHelper */
    signupSources?: Record<string, EventSource>;
    // The planning step (#261).
    categories?: { id: string; name: string }[];
    /** category id → raid template id of its default */
    categoryRaidTemplates?: Record<string, string>;
    /** the raid templates with their badges (needsSize, incomplete, defaultFor) */
    raidTemplates?: RaidTemplate[];
    versions?: GameVersion[];
    defaultVersion?: string;
    /** category id → its channel naming schema (Kanäle) */
    channelSchemas?: Record<string, { schema: string; raid: string }>;
    defaultSchema?: string;
    /** the own event ?event= names, for the edit mode */
    editEvent?: OwnEvent | null;
};

/**
 * The name a new event channel gets and where it comes from (#285) — the create
 * dialog's suggestion. `sourceEventId` names the event whose channel is cloned.
 */
export function getChannelNameSuggestion(input: { categoryId: string; date: string; instanceIds: string[]; sourceEventId?: string }): Promise<ChannelNameSuggestion> {
    const q = new URLSearchParams({ categoryId: input.categoryId, date: input.date, instanceIds: input.instanceIds.join(",") });
    if (input.sourceEventId) q.set("sourceEventId", input.sourceEventId);
    return get<ChannelNameSuggestion>(`/api/raids/channel-name?${q.toString()}`);
}

/** The create dialog's material; with an own event id also that event, for editing it. */
export function getRaidCreateContext(eventId = ""): Promise<RaidCreateContext> {
    return get<RaidCreateContext>(eventId ? `/api/raids/new?event=${encodeURIComponent(eventId)}` : "/api/raids/new");
}

/** The planning fields of an EventHelper event, as POST and PATCH /api/raids take them. */
export type EventPlanInput = {
    raidTemplateId: string;
    versionId: string;
    instanceIds: string[];
    size: number;
    composition: { tank: number; healer: number; melee: RoleRange | null; ranged: RoleRange | null };
    requiredBuffs: string[];
    /** hours before the start, 0 = no deadline — counted in Berlin time on the server */
    signupDeadlineHours: number;
    fairness: boolean;
    wishes: boolean;
    autoSuggest: boolean;
};

export type CreateRaidInput = Partial<EventPlanInput> & {
    title: string;
    date: string;
    time: string;
    templateId: string;
    channelId?: string;
    channelName?: string;
    sourceEventId?: string;
    /** a new channel in the category; an empty name is filled from the category's schema (same shape as /event anlegen) */
    newChannel?: { name: string; categoryId: string; templateChannelId?: string };
    /** overrides the category's default source */
    signupSource?: EventSource;
    leaderId: string;
    description: string;
};

export function createRaid(csrfToken: string | null, input: CreateRaidInput): Promise<{ id?: string; messageError?: string | null }> {
    return send("POST", "/api/raids", csrfToken, input);
}

export type UpdateRaidInput = Partial<EventPlanInput> & {
    id: string;
    title: string;
    date: string;
    time: string;
    leaderId: string;
    description: string;
};

/** Edit an own (EventHelper) event with the same dialog (#261). */
export function updateRaid(csrfToken: string | null, input: UpdateRaidInput): Promise<{ id: string; messageError?: string | null }> {
    return send("PATCH", "/api/raids", csrfToken, input);
}

// Rule sets per game version (src/config/gameVersions, GET /api/game-versions).
export type GameRole = "tank" | "healer" | "melee" | "ranged";

export type GameSpec = {
    /** "<Class>-<Spec>" in Warcraft Logs' spelling, e.g. "Druid-Guardian" */
    key: string;
    id: string;
    classId: string;
    label: string;
    role: GameRole;
    /** raidBuffs.js vocabulary: which buffs the spec wants */
    buffRole: "tank" | "healer" | "melee" | "caster";
    icon: string;
    canTank: boolean;
    canHeal: boolean;
};

export type GameClass = { id: string; label: string; color: string; icon: string; specs: GameSpec[] };

export type Composition = { tanks: number; healers: number; source: "instance" | "default" };

export type GameInstance = {
    id: string;
    name: string;
    short: string;
    sizes: number[];
    defaultSize: number;
    icon: string;
    bosses: string[];
    /** "" while the instance is incomplete */
    finalBoss: string;
    /** "incomplete" = plannable, but the menu shows "Infos fehlen" */
    status: "complete" | "incomplete";
    /** suggested tanks/healers per allowed size */
    suggested: Record<string, Composition>;
};

export type GameBuff = {
    key: string;
    label: string;
    icon: string;
    scope: "party" | "raid";
    /** spec keys that bring the buff */
    providers: string[];
    /** spec keys the buff is worth having on */
    beneficiaries: string[];
};

export type GameVersion = {
    id: "tbc" | "classic" | "forever" | string;
    label: string;
    short: string;
    roles: { id: GameRole; label: string }[];
    classes: GameClass[];
    instances: GameInstance[];
    partyBuffs: GameBuff[];
    raidBuffs: GameBuff[];
};

export type GameVersionsData = { versions: GameVersion[]; defaultVersion: string };

export function getGameVersions(): Promise<GameVersionsData> {
    return get<GameVersionsData>("/api/game-versions");
}

export type RaidTemplatesData = { templates: RaidTemplate[]; categoryNames: Record<string, string> };

export function getRaidTemplates(): Promise<RaidTemplatesData> {
    return get<RaidTemplatesData>("/api/raid-templates");
}

/** Create (no id) or update (id) a raid template. */
export function saveRaidTemplate(csrfToken: string | null, input: RaidTemplateInput): Promise<RaidTemplate> {
    return input.id
        ? send("PATCH", "/api/raid-templates", csrfToken, input)
        : send("POST", "/api/raid-templates", csrfToken, input);
}

/** 409 while a category uses it as its default — the message names the category. */
export function deleteRaidTemplate(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("DELETE", "/api/raid-templates", csrfToken, { id });
}

export function importRaidTemplates(csrfToken: string | null): Promise<{ added: number; updated: number; templates: RaidTemplate[] }> {
    return send("POST", "/api/raid-templates/import", csrfToken, {});
}

export type RecruitmentTemplate = {
    id: string;
    name: string;
    content: string;
    title: string;
    body: string;
    buttonLabel: string;
    createdAt?: number;
    updatedAt?: number;
};

export type RecruitmentPost = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string;
    channelName: string;
    content: string;
    title: string;
    body: string;
    buttonLabel: string;
    source: "web" | "scan";
    /** The template it was posted from; "" for a message the scan found. */
    templateId?: string;
    postedAt?: number;
    updatedAt?: number;
};

export type Application = {
    threadId: string;
    name: string;
    url: string;
    createdAt: number;
    archived: boolean;
    applicantId: string;
    displayName: string;
    character: string;
    classSpec: string;
    armory: string;
    wcl: string;
    description: string;
    discordName: string;
    date: string;
    // Added by src/web/recruitmentApplications.js.
    className: string;
    spec: string;
    classColor: string;
    classIcon: string;
    specIcon: string;
    status: "neu" | "offen" | "archiviert";
};

export type TextChannel = { id: string; name: string; category: string };
export type Emoji = { id: string; name: string; animated: boolean; code: string; url: string };

export type RecruitmentView = "templates" | "posts" | "applications";

export type RecruitmentData = {
    view: RecruitmentView | "";
    /** The active Discord server's name, "" without one. */
    guildName: string;
    templates: RecruitmentTemplate[];
    editing: RecruitmentTemplate | null;
    editingPost: RecruitmentPost | null;
    posts: RecruitmentPost[];
    channels: TextChannel[];
    emojis: Emoji[];
    specCatalog: SpecCatalogEntry[];
    applications: Application[] | null;
    applicationsError: string | null;
    applicationChannelId: string;
    activeGuildId: string;
};

export function getRecruitmentData(params: { view?: string; edit?: string; editpost?: string } = {}): Promise<RecruitmentData> {
    const qs = new URLSearchParams();
    if (params.view) qs.set("view", params.view);
    if (params.edit) qs.set("edit", params.edit);
    if (params.editpost) qs.set("editpost", params.editpost);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<RecruitmentData>(`/api/recruitment${suffix}`);
}

export function saveRecruitmentTemplate(
    csrfToken: string | null,
    input: { id?: string; name: string; content: string; buttonLabel: string },
): Promise<RecruitmentTemplate> {
    return send("POST", "/api/recruitment", csrfToken, input);
}

export function deleteRecruitmentTemplate(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/delete", csrfToken, { id });
}

export function postRecruitmentTemplate(
    csrfToken: string | null,
    input: { templateId: string; channelId: string },
): Promise<RecruitmentPost> {
    return send("POST", "/api/recruitment/post", csrfToken, input);
}

export function updateRecruitmentPost(
    csrfToken: string | null,
    input: { id: string; content: string; buttonLabel: string },
): Promise<RecruitmentPost> {
    return send("POST", "/api/recruitment/post-update", csrfToken, input);
}

export function deleteRecruitmentPost(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/recruitment/post-delete", csrfToken, { id });
}

export function scanRecruitmentPosts(csrfToken: string | null): Promise<{ count: number }> {
    return send("POST", "/api/recruitment/scan", csrfToken, {});
}

export type HistoryEvent = { id: string; title: string; startTime: number; categoryId: string };
export type RaidRow = RecentEvent;

// "manual" is a row entered in the admin menu rather than exported by an addon.
export type LootSource = "gargul" | "rclc" | "manual" | string;

export type LootEventSummary = {
    eventId: string;
    label: string;
    /**
     * Discord raid category the bucket is filed under, "" when it has none —
     * the normal case for loot imported without a Raid-Helper event, which
     * setLootCategory() assigns after the fact.
     */
    categoryId: string;
    count: number;
    importedAt?: number;
    awardedAt?: number;
    sources: LootSource[];
};

export type LootLog = {
    id: string;
    title?: string;
    reportId?: string;
    link?: string;
    zone?: string;
    status?: string;
    reportUrl?: string;
    reportRefId?: string;
    eventId?: string;
    eventLabel?: string;
    eventStartTime?: number;
    postedAt?: number;
};

// `reason`/`reasonLabel`/`reasonTone` are the normalized award reason the server
// derived from the addon's free-text `response` (see utils/lootReasons.js) — the
// tone picks the badge colour, the raw response stays visible on hover.
// `contentId` is the raid the item drops in, resolved by item id
// (config/tbcContent.js) and therefore also present for Gargul rows, which carry
// no instance at all.
export type LootItem = {
    /** Id of the stored row — the handle deleteLootItems() removes it by. */
    id: string;
    itemId: number;
    itemName: string;
    itemIconUrl?: string;
    /** Wowhead's 0-7 quality scale, resolved at import time; null/absent when
     *  the lookup never came back — see lib/itemQuality.ts. */
    itemQuality?: number | null;
    itemLink: string;
    character: string;
    response: string;
    offspec: boolean;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    contentId: string;
    tokenTier: string;
    boss: string;
    awardedAt: number;
    source: LootSource;
    eventId?: string;
    eventLabel?: string;
    // How the winner plays — joined onto the row on read (web/lootClassLook.js),
    // not stored with it: a raider's class is a fact about them, not about the
    // item. All four are "" for a character whose class nobody has resolved yet,
    // and their name then renders uncoloured.
    className?: string;
    spec?: string;
    classColor?: string;
    specIconUrl?: string;
};

// A loot character with its resolved WoW class/spec (or blank if unresolved
// yet). classColor/iconUrl are computed server-side from config/classlist.js
// — never duplicated client-side, same rule as lib/recruitmentSpecs.ts's
// specCatalog. categoryIds are the Discord raid categories (e.g. "Montagsraid",
// "Pug") the character got loot in — names are resolved client-side against
// HistoryData.categories, same live Discord list the "Loot-Tool je Kategorie"
// tab already uses. `items` is the character's loot in a trimmed shape (see
// lootStore.js's charLootPreview) — just enough for the Items-column hover to
// show icon, name and the award reason ("BiS", "Mainspec", …).
export type CharLootPreview = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    /** See LootItem.itemQuality. */
    itemQuality: number | null;
    itemLink: string;
    response: string;
    offspec: boolean;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    contentId: string;
    categoryId: string;
    eventId: string;
    eventLabel: string;
    awardedAt: number;
};

export type AnnotatedCharacter = {
    key: string;
    character: string;
    realm: string;
    count: number;
    categoryIds: string[];
    items: CharLootPreview[];
    className: string;
    spec: string;
    source: string;
    reportId: string;
    classColor: string;
    iconUrl: string;
};

export type HistoryData = {
    events: HistoryEvent[];
    upcomingRaids: { events: RaidRow[]; error: string | null };
    pastRaids: { events: RaidRow[]; error: string | null };
    lootEvents: LootEventSummary[];
    logs: LootLog[];
    categories: Category[];
    categoryLootTool: Record<string, string>;
    chars: AnnotatedCharacter[];
    activeGuildId: string;
};

export function getHistoryData(): Promise<HistoryData> {
    return get<HistoryData>("/api/history");
}

// ---- Loot overviews (Gründe / Items) ----------------------------------------
// Labels, colours (tone) and the raid/tier catalogs all come from the server
// (utils/lootReasons.js, config/tbcContent.js) — the client only maps a tone
// onto a CSS class, so a new reason or a new raid never needs a client change.

export type LootReason = { id: string; label: string; tone: string; order: number };
export type LootContent = { id: string; label: string; short: string; tier: string; zoneId: number };
export type LootTier = { id: string; label: string };

/** One reason bucket of one raider, with the items behind it (hover list). */
export type CharReasonBucket = {
    reason: string;
    /** What the badge says: the guild's own response wording when every item in
     *  the bucket carries the same one, else the bucket name. */
    label: string;
    /** The bucket name itself, for the tooltip and the filter. */
    reasonLabel: string;
    tone: string;
    order: number;
    count: number;
    items: CharLootPreview[];
};

export type CharReasonRow = {
    key: string;
    character: string;
    realm: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
    categoryIds: string[];
    count: number;
    reasons: CharReasonBucket[];
};

/** One award of an item: who got it, when, in which raid and for what reason. */
export type LootAward = {
    /** The stored row's id — what deleteLootItems() removes. */
    id: string;
    character: string;
    characterKey: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    response: string;
    eventId: string;
    eventLabel: string;
    categoryId: string;
    awardedAt: number;
    source: LootSource;
};

export type LootCatalogItem = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    /** See LootItem.itemQuality. */
    itemQuality: number | null;
    itemLink: string;
    /** "" when the content table doesn't know the item — shown as "Unbekannt". */
    contentId: string;
    tier: string;
    boss: string;
    /** "t4"/"t5"/"t6" on a tier-set token, "" otherwise. */
    tokenTier: string;
    /** The raid categories this item was ever awarded in. */
    categoryIds: string[];
    count: number;
    lastAwardedAt: number;
    awards: LootAward[];
};

export type LootStats = {
    reasons: LootReason[];
    contents: LootContent[];
    tiers: LootTier[];
    characters: CharReasonRow[];
    items: LootCatalogItem[];
    unknownContentCount: number;
};

export function getLootStats(): Promise<LootStats> {
    return get<LootStats>("/api/history/loot-stats");
}

// One page of the "Latest Loot" tab. The rows are the same awards the dashboard
// card shows (see web/lootAwards.js); filtering and paging happen on the server,
// because the loot store holds every row ever imported.
export type LootAwardsQuery = {
    /** false widens the list from the configured top items to all loot. */
    topOnly: boolean;
    search: string;
    category: string;
    content: string;
    reason: string;
    page: number;
};

export type LootAwardsData = {
    items: TopLootAward[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    /** How many top items are configured at all (Einstellungen → Loot). */
    topItemCount: number;
    contents: LootContent[];
    reasons: LootReason[];
    unknownContentCount: number;
};

export function getLootAwards(q: LootAwardsQuery): Promise<LootAwardsData> {
    const qs = new URLSearchParams({
        top: q.topOnly ? "1" : "0",
        q: q.search,
        category: q.category,
        content: q.content,
        reason: q.reason,
        page: String(q.page),
    });
    return get<LootAwardsData>(`/api/history/loot-awards?${qs.toString()}`);
}

export function deleteHistoryLog(csrfToken: string | null, logId: string): Promise<{ id: string }> {
    return send("POST", "/api/history/log-delete", csrfToken, { logId });
}

// `categoryId` only takes effect when the import ends up without a Raid-Helper
// event (manual title / no match) — an event brings its own Discord category,
// which always wins. See apiRoutes/history.js's importLoot.
export type ImportLootInput = { data: string; tool: string; event: string; manualLabel: string; categoryId?: string };

export function importLoot(
    csrfToken: string | null,
    input: ImportLootInput,
): Promise<{ eventId: string; eventLabel: string; categoryId: string; added: number; skipped: number }> {
    return send("POST", "/api/history/import", csrfToken, input);
}

/** File an already-imported loot bucket under a raid category ("" clears it). */
export function setLootCategory(
    csrfToken: string | null,
    input: { event: string; categoryId: string },
): Promise<{ eventId: string; categoryId: string; updated: number }> {
    return send("POST", "/api/history/loot-category", csrfToken, input);
}

export function clearHistoryEvent(csrfToken: string | null, event: string): Promise<{ removed: number }> {
    return send("POST", "/api/history/clear", csrfToken, { event });
}

/**
 * Delete single loot rows (LootItem.id) — the row-level counterpart to
 * clearHistoryEvent(), for the one item that was logged twice or awarded to the
 * wrong raider. Re-importing the same export brings it back (the import dedupes
 * against what is stored).
 */
export function deleteLootItems(csrfToken: string | null, ids: string[]): Promise<{ removed: number }> {
    return send("POST", "/api/history/loot-delete", csrfToken, { ids });
}

// ---- adding one award by hand ("Item nachtragen") ----

/** One possible drop of a raid, as the picker lists it. */
export type RaidDropItem = {
    id: number;
    name: string;
    iconUrl: string;
    itemLink: string;
    /** See LootItem.itemQuality — colours the name. */
    quality: number | null;
    /** "Trash" and "" are not encounters; see tbcContent.js's RAID_LOOT. */
    boss: string;
};

/** A raid with everything that can drop in it. */
export type LootCatalogContent = {
    id: string;
    label: string;
    short: string;
    tier: string;
    tierLabel: string;
    items: RaidDropItem[];
};

/** A raider the award can be credited to, with the look their name renders in. */
export type LootPickerCharacter = {
    character: string;
    className: string;
    spec: string;
    classColor: string;
    iconUrl: string;
};

export type LootPickerData = {
    contents: LootCatalogContent[];
    /** Which raid(s) this event was — the picker opens on the first of them. */
    suggested: string[];
    reasons: { id: string; label: string; tone: string }[];
    characters: LootPickerCharacter[];
};

/**
 * What the "Item nachtragen" form offers: the raid drop tables, the raid(s) the
 * event was, the award reasons and the known raiders. Static apart from the
 * per-event suggestion, so a page loads it once when the form is opened.
 */
export function getLootPicker(event: string, title = ""): Promise<LootPickerData> {
    return get<LootPickerData>(`/api/history/loot-picker?event=${encodeURIComponent(event)}&title=${encodeURIComponent(title)}`);
}

export type AddLootInput = {
    event: string;
    itemId: number;
    character: string;
    boss?: string;
    instance?: string;
    response?: string;
    offspec?: boolean;
    /** Unix ms; the server falls back to "now" when it is 0/absent. */
    awardedAt?: number;
};

/**
 * Add one award that no export carried (handed out after the raid, a night
 * nobody logged). Rejects with a 409 when the same item/raider/time is already
 * stored — that is a double submit, not a second drop.
 */
export function addLootItem(
    csrfToken: string | null,
    input: AddLootInput,
): Promise<{ eventId: string; eventLabel: string; added: number; skipped: number; item: LootItem }> {
    return send("POST", "/api/history/loot-add", csrfToken, input);
}

// ---- addon inbox: raid sessions the loot-sync tool uploaded, awaiting a decision ----

/** The event a session was matched to. A suggestion — the admin confirms it. */
export type InboxMatchEvent = {
    eventId: string;
    eventLabel: string;
    startTime: number;
    categoryId: string;
    categoryName: string;
};

export type InboxMatch = {
    /** More than one raid started that day — nothing is preselected. */
    ambiguous: boolean;
    suggested: InboxMatchEvent | null;
    candidates: InboxMatchEvent[];
};

export type InboxSession = {
    /** Handle for accept/dismiss. */
    id: string;
    /** The addon's own id for the raid night — stable across re-uploads. */
    sessionId: string;
    receivedAt: number;
    updatedAt: number;
    startedAt: number;
    endedAt: number;
    /** Was das Addon gemeldet hat — kann leer oder bloss ein Kontinent sein. */
    instance: string;
    /**
     * Der Raid, unter dem die Session angezeigt wird. Bevorzugt die Meldung des
     * Addons; ist die leer oder nur ein Kontinent, aus den Item-IDs abgeleitet
     * (siehe web/lootSessionContent.js).
     */
    contentLabel: string;
    /** Woher `contentLabel` stammt — "items" heisst: erschlossen, nicht gemeldet. */
    contentSource: "addon" | "items" | "";
    /** Wie viele Items sich einem Raid zuordnen liessen. */
    contentMatched: number;
    itemCount: number;
    /**
     * The session's loot, decorated exactly like stored history (reason badge,
     * raid, tier) although it isn't stored yet — so the preview looks like what
     * accepting will produce. `id` is absent: these rows have no store id.
     */
    items: LootItem[];
    realm: string;
    reporter: string;
    addonVersion: string;
    tokenName: string;
    match: InboxMatch | null;
};

/** An accepted session whose later uploads append to its event by themselves. */
export type InboxLinkedSession = {
    sessionId: string;
    eventId: string;
    eventLabel: string;
    contentLabel: string;
    startedAt: number;
    itemCount: number;
    /** Items later uploads appended without a click ("+6 nachgeliefert"). */
    appended: number;
    at: number;
};

export function getLootInbox(): Promise<{ sessions: InboxSession[]; linked?: InboxLinkedSession[] }> {
    return get<{ sessions: InboxSession[]; linked?: InboxLinkedSession[] }>("/api/history/inbox");
}

/** An event as the import preview names it; startTime in ms. */
export type ImportPreviewEvent = { id: string; title: string; startTime: number };

export type ImportPreview = {
    count: number;
    format: "rclc" | "gargul" | "eventhelper";
    formatLabel: string;
    /** Earliest award in the export (ms), 0 without any. */
    detectedAt: number;
    content: { contentIds: string[]; label: string; matched: number };
    match: { ambiguous: boolean; suggested: ImportPreviewEvent | null; candidates: ImportPreviewEvent[] };
    /** The event the rows would land in as far as known before importing. */
    targetEventId: string;
    /** Rows that event already holds — the import will skip them. */
    duplicates: number;
};

/** What importLoot() would do with this export, without storing anything. */
export function previewLootImport(
    csrfToken: string | null,
    input: { data: string; tool: string; event: string },
): Promise<ImportPreview> {
    return send("POST", "/api/history/import-preview", csrfToken, input);
}

/**
 * File a pending session under an event. `event` accepts the same vocabulary as
 * the paste import (an event id, "__auto__", "__manual__"); left empty it takes
 * the match the upload already suggested.
 */
export function acceptLootInbox(
    csrfToken: string | null,
    input: { id: string; event?: string; manualLabel?: string; categoryId?: string },
): Promise<{ eventId: string; eventLabel: string; categoryId: string; added: number; skipped: number }> {
    return send("POST", "/api/history/inbox-accept", csrfToken, input);
}

/** Throw a session away. The decision sticks — re-uploads will not bring it back. */
export function dismissLootInbox(
    csrfToken: string | null,
    id: string,
): Promise<{ id: string; sessionId: string }> {
    return send("POST", "/api/history/inbox-dismiss", csrfToken, { id });
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

// ---- Bot-Befehle (Einstellungen → Berechtigungen), full admins only ----

export type BotAccessMode = "everyone" | "roles" | "admins";
export type BotAccessRule = { mode: BotAccessMode; roleIds: string[] };

export type BotCommand = {
    name: string;
    description: string;
    group: string;
    kind: "slash" | "button";
    /** What the code proposes when nothing is stored. */
    defaultAccess: BotAccessRule;
    /** The stored setting, null = the default applies. */
    access: BotAccessRule | null;
    effective: BotAccessRule;
    /** Buttons, selects and modals that inherit this command's access. */
    inherits: string[];
};

export type BotCommandGroup = { id: string; label: string; icon: string };

/** A role of the event guild; memberCount is null when the bot cannot tell. */
export type BotRole = Role & { memberCount: number | null };

export type BotCommandsData = {
    groups: BotCommandGroup[];
    commands: BotCommand[];
    roles: BotRole[];
    guildId: string;
    guildName: string;
};

export function getBotCommands(): Promise<BotCommandsData> {
    return get<BotCommandsData>("/api/bot-commands");
}

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

export type HistoryEventData = { eventId: string; label: string; items: LootItem[] };

export function getHistoryEvent(eventId: string): Promise<HistoryEventData> {
    return get<HistoryEventData>(`/api/history/event?event=${encodeURIComponent(eventId)}`);
}

export type ResolveCharactersResult = {
    fromExport: number;
    fromReports: number;
    fromWcl: number;
    checkedReports: number;
    pendingReports: number;
    missing: string[];
    unlinked: string[];
    message: string;
};

export function resolveCharacters(csrfToken: string | null): Promise<ResolveCharactersResult> {
    return send("POST", "/api/history/characters-resolve", csrfToken, {});
}

export type GearSocket = {
    type: string;
    gemName: string | null;
    gemId: number | null;
    gemIconUrl: string;
    gemText: string;
};

export type GearItem = {
    slot: string;
    itemId: number | null;
    name: string;
    quality: string;
    level: number | null;
    enchants: string[];
    enchantIds: number[];
    sockets: GearSocket[];
    iconUrl: string;
};

export type CharSummary = {
    name: string;
    realm: string;
    level: number | null;
    itemLevel: number | null;
    lastLogin: number | null;
    className: string;
    faction: string;
    namespace: string;
};

// Mirrors getCharacter()'s stored record, enriched with the same classColor/
// iconUrl fields the "Charaktere" tab gets, so the char page's header can
// render the class/spec suffix the same way.
export type CharInfo = {
    key: string;
    character: string;
    className: string;
    spec: string;
    source: string;
    reportId: string;
    updatedAt: number;
    classColor: string;
    iconUrl: string;
};

export type HistoryCharData = {
    character: string;
    realm: string;
    items: LootItem[];
    armoryUrl: string;
    wclUrl: string;
    gear: GearItem[] | null;
    gearConfigured: boolean;
    gearError: string;
    charSummary: CharSummary | null;
    gearNamespace: string;
    info: CharInfo | null;
    /** The newest CLA evaluation's gear findings, or null if the character
     *  isn't in any of the stored evaluations. */
    gearIssues: CharGearReport | null;
};

export function getHistoryChar(name: string): Promise<HistoryCharData> {
    return get<HistoryCharData>(`/api/history/char?name=${encodeURIComponent(name)}`);
}

// ===== CLA / Logcheck =====
// A generic sorted+paged slice from the backend — mirrors renderAdmin.js's
// claSortHeader()/claPager() query-string contract (view/sort/dir/page).
export type ClaPage<T> = {
    items: T[];
    sort: string;
    dir: "asc" | "desc";
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
};

// A candidate raid event a detected log could belong to, ranked by how close
// its start time is to the log's post time (web/logEventMatch.js).
export type MatchCandidate = {
    eventId: string;
    title: string;
    startTime: number;
    categoryName: string;
    diffMs: number;
    sameCategory: boolean;
    /** The raid the event title names ("hyjal"), for its boss icon; "" when none. */
    contentId?: string;
};

// One raid a log covers and how far it got — raidProgress.raidSummary().
export type ClaRaid = {
    contentId: string;
    /** Short raid name, "Hyjal". */
    label: string;
    killed: number;
    total: number;
    finalKilled: boolean;
    finalBoss: string;
    /** Encounters still standing, in raid order. */
    missing: string[];
    /** Every encounter with its state; empty for a report stored before the grid existed. */
    bosses: { name: string; killed: boolean }[];
};

// A row of the Log-Auswertung list (web/reportList.js prepareClaList): a tracked
// log, or a report built from a pasted link that has no log ("report").
export type ClaRow = {
    kind: "log" | "report";
    id: string;
    logId: string;
    title: string;
    zone: string;
    reportId: string;
    wclUrl: string;
    /** Post time in the log channel (a link report: its build time), epoch ms. */
    postedAt: number;
    source: "channel" | "link";
    guildId: string;
    channelId: string;
    messageId: string;
    channelName: string;
    categoryId: string;
    categoryName: string;
    /** Which analyses already ran ("cla" / "rpb"). */
    sections: LogSection[];
    report: { id: string; url: string; generatedAt: number; playerCount: number; issueCount: number } | null;
    raids: ClaRaid[];
    eventId: string;
    eventLabel: string;
    eventStartTime: number;
    eventLinkSource: "manual" | "auto" | "";
    /** Time-matched events; absent on linked logs and link reports. */
    candidates?: MatchCandidate[];
    matchAmbiguous?: boolean;
};

export type ClaFilter = "all" | "open" | "unlinked" | "done";

export type ClaData = {
    filter: ClaFilter;
    page: ClaPage<ClaRow>;
    counts: Record<ClaFilter, number>;
    /** How many open logs "Automatisch zuordnen" would assign right now. */
    autoMatchCount: number;
    matchEventsError: string | null;
    logChannelsConfigured: boolean;
    activeGuildId: string;
};

export function getClaData(filter: ClaFilter, sort?: string, dir?: string, page?: number): Promise<ClaData> {
    const qs = new URLSearchParams();
    qs.set("filter", filter);
    if (sort) qs.set("sort", sort);
    if (dir) qs.set("dir", dir);
    if (page) qs.set("page", String(page));
    return get<ClaData>(`/api/cla?${qs.toString()}`);
}

export type JobPollStatus = {
    status: "running" | "done" | "error" | "unknown";
    url?: string;
    id?: string;
    error?: string;
    /** The job stopped because the raid's final boss is not down yet. */
    incomplete?: boolean;
    /** With `incomplete`: the raids of the log and which bosses still stand. */
    raids?: ClaRaid[];
};

/** A refused evaluation over a raid that is still running (code RAID_INCOMPLETE). */
export type IncompleteRaidError = ApiError & { raids?: ClaRaid[] };

/**
 * The error code a refused evaluation carries — the raid was still running.
 * Not a failure: the caller asks whether to run it anyway and retries with
 * force (see lib/confirmIncomplete.ts).
 */
export const RAID_INCOMPLETE = "raid_incomplete";

/**
 * Build a report from a pasted Warcraft-Logs link, to completion.
 *
 * Same shape as evalLog(): the POST only queues the build (it is the full CLA
 * analysis and takes far longer than a proxy holds a connection open), the
 * outcome is collected by polling. Callers run this through useJobs().run(),
 * so it keeps going while the admin browses elsewhere.
 */
export async function createReport(
    csrfToken: string | null,
    link: string,
    opts: { force?: boolean; sections?: LogSection[] } = {},
): Promise<{ id: string; url: string }> {
    const started = await send<{ jobId: string }>("POST", "/api/cla", csrfToken, { link, force: !!opts.force, sections: opts.sections });
    const state = await pollJob(
        () => get<JobPollStatus>(`/api/cla/report-status?jobId=${encodeURIComponent(started.jobId)}`),
        "Die Auswertung konnte nicht erstellt werden.",
    );
    return { id: state.id || "", url: state.url || "" };
}

/**
 * Poll a server-side job until it reports done/error. Shared by the report
 * build and the log evaluations — both answer with the same status shape.
 */
async function pollJob(
    read: () => Promise<JobPollStatus>,
    failMessage: string,
): Promise<JobPollStatus> {
    const startedAt = Date.now();
    const POLL_MS = 2000;
    // Generous ceiling: well past a slow RPB run, but not infinite.
    const TIMEOUT_MS = 10 * 60 * 1000;

    for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const state = await read();
        if (state.status === "done") return state;
        if (state.status === "error") {
            // A raid that is still running is a question, not a failure — the
            // caller offers "evaluate anyway" on this code.
            const code = state.incomplete ? RAID_INCOMPLETE : "job_failed";
            throw { code, message: state.error || failMessage, raids: state.raids } as IncompleteRaidError;
        }
        if (state.status === "unknown") {
            // the job vanished without leaving a result (server restart mid-run)
            throw { code: "job_lost", message: "Der Vorgang wurde unterbrochen. Bitte erneut starten." } as ApiError;
        }
        if (Date.now() - startedAt > TIMEOUT_MS) {
            throw {
                code: "job_timeout",
                message: "Der Vorgang dauert ungewöhnlich lange. Er läuft im Hintergrund weiter — lade die Seite später neu.",
            } as ApiError;
        }
    }
}

export function deleteReport(
    csrfToken: string | null,
    reportId: string,
): Promise<{ reportId: string; logId: string; message: string }> {
    return send("POST", "/api/cla/report-delete", csrfToken, { reportId });
}

/**
 * Run one half of a log's analysis — "cla" (gear/consumables) or "rpb"
 * (performance). Each half runs at most once; both write into the same report
 * page, so the returned url is stable across the two calls.
 */
export type EvalStart = {
    status?: "running" | "done";
    section?: LogSection;
    logId?: string;
    alreadyRunning?: boolean;
    alreadyEvaluated?: boolean;
    url?: string;
};

export type EvalStatus = {
    status: "running" | "done" | "error" | "unknown";
    url?: string;
    id?: string;
    error?: string;
    incomplete?: boolean;
    raids?: ClaRaid[];
    section?: LogSection;
    runningMs?: number;
};

/** Kick off one half of a log's analysis. Returns as soon as the job is queued. */
export function startEval(
    csrfToken: string | null,
    logId: string,
    section: LogSection = "cla",
    opts: { force?: boolean } = {},
): Promise<EvalStart> {
    return send("POST", "/api/cla/eval", csrfToken, { logId, section, force: !!opts.force });
}

/** Current state of a started evaluation. */
export function getEvalStatus(logId: string, section: LogSection): Promise<EvalStatus> {
    const qs = new URLSearchParams({ logId, section });
    return get<EvalStatus>(`/api/cla/eval-status?${qs.toString()}`);
}

/**
 * Discard one half of a log's evaluation so it can be run again — for a run that
 * came out incomplete, say. The other half stays; if this was the last one, the
 * report page goes away and the log falls back to "offen".
 */
export function resetEval(
    csrfToken: string | null,
    logId: string,
    section: LogSection,
): Promise<{ logId: string; section: LogSection; remaining: string[]; message: string }> {
    return send("POST", "/api/cla/eval-reset", csrfToken, { logId, section });
}

/**
 * Run one half of a log's analysis to completion.
 *
 * The request only starts the job — an RPB evaluation runs ~50s, far past the
 * point where a reverse proxy would drop a held-open connection — so the result
 * is collected by polling. Resolves with the finished report's url.
 *
 * Callers run this through useJobs().run(), which owns the pending promise —
 * so the evaluation (and its progress toast) survives leaving the CLA page.
 */
export async function evalLog(
    csrfToken: string | null,
    logId: string,
    section: LogSection = "cla",
    opts: { force?: boolean } = {},
): Promise<{ url: string; id?: string; alreadyEvaluated?: boolean; section?: LogSection }> {
    const started = await startEval(csrfToken, logId, section, opts);
    if (started.alreadyEvaluated) {
        return { url: started.url || "", alreadyEvaluated: true, section };
    }
    const state = await pollJob(() => getEvalStatus(logId, section), "Auswertung fehlgeschlagen.");
    return { url: state.url || "", id: state.id, section };
}

export function scanLogs(csrfToken: string | null): Promise<{ found: number; message: string }> {
    return send("POST", "/api/cla/scan", csrfToken, {});
}

export function deleteLogEntry(csrfToken: string | null, logId: string): Promise<{ logId: string }> {
    return send("POST", "/api/cla/log-delete", csrfToken, { logId });
}

export function linkLog(
    csrfToken: string | null,
    logId: string,
    eventId: string,
): Promise<{ logId: string; eventId: string; eventLabel: string; message: string }> {
    return send("POST", "/api/cla/log-link", csrfToken, { logId, eventId });
}

export function linkLogUrl(
    csrfToken: string | null,
    link: string,
    eventId: string,
): Promise<{ logId: string; eventId: string; eventLabel: string; message: string }> {
    return send("POST", "/api/cla/log-link-url", csrfToken, { link, eventId });
}

export function unlinkLog(csrfToken: string | null, logId: string): Promise<{ logId: string; message: string }> {
    return send("POST", "/api/cla/log-unlink", csrfToken, { logId });
}

export function autoMatchLogs(csrfToken: string | null): Promise<{ matched: number; remaining: number; message: string }> {
    return send("POST", "/api/cla/log-automatch", csrfToken, {});
}

// ── Loot-Council ─────────────────────────────────────────────────────────────
// The caster council view (src/web/apiRoutes/lootCouncil.js). Two speeds: the
// page itself comes from stored data in one call, the DPS simulation runs as a
// background job the client polls.

/** One item a raider was awarded, as the council list shows it. */
export type CouncilLootItem = {
    itemId: number;
    itemName: string;
    itemIconUrl: string;
    itemQuality: number | null;
    /** Equip slot (WCL numbering, the first of a doubled one); -1 when unknown. */
    slot: number;
    slotName: string;
    contentId: string;
    tier: string;
    boss: string;
    reason: string;
    reasonLabel: string;
    reasonTone: string;
    awardedAt: number;
    eventLabel: string;
};

/**
 * One piece a raider currently wears, as the gear row under their name and the
 * "Slot" column of the candidate list render it. Name and icon come from the
 * log (it saw what they actually wear); stats and raid come from the item table
 * where it knows the item.
 */
export type WornItem = {
    slot: number;
    slotName: string;
    itemId: number;
    itemName: string;
    iconUrl: string;
    quality: number | null;
    itemLevel: number;
    stats: Record<string, number>;
    contentId: string;
    boss: string;
    gemCount: number;
    /** Socketed gem ids and the enchant id, for the Wowhead tooltip. */
    gemIds: number[];
    enchantId: number;
    emptySockets: number;
    /** "ok" | "missing" | "bad" | "na" — "missing" is the one worth showing. */
    enchantStatus: string;
    /** Whether this piece is on that raider's own BiS list. */
    isBis: boolean;
    /** ...and whose lists it is on at all. */
    bisSpecs: BisSpec[];
    /**
     * Set when the piece only pays off against certain bosses (Mark of the
     * Champion and its like) and no older raid showed what they wear otherwise.
     * Every comparison reads such a slot as empty, so it has to be marked.
     */
    situational: { note: string } | null;
    /**
     * The other side of the same coin: this piece was taken from an older raid
     * because the newest one had a boss-specific item in the slot. Says what it
     * stands in for, and where it comes from.
     */
    replacedSituational: {
        itemId: number;
        itemName: string;
        iconUrl: string;
        note: string;
        seenAt: number;
        reportTitle: string;
        /**
         * The best case: the substitute is from the *same* raid, one boss away
         * — the evaluation walked the fights and found what they wore when the
         * boss-specific piece was off. Then `fight` names that boss and
         * `seenAt`/`reportTitle` are empty, because it is not an older set.
         */
        sameRaid?: boolean;
        fight?: string;
    } | null;
};

/**
 * A spec that has a given item on its BiS list.
 *
 * "BiS" on its own says nothing when nine specs share one item table — most
 * caster drops are contested — so every item carries whose list it is on.
 * `alsoFor` names the specs that borrow this one's list (WoWSims ships none of
 * their own), which is an assumption and shown as one.
 */
export type BisSpec = {
    specKey: string;
    label: string;
    iconUrl: string;
    classColor: string;
    role: string;
    tier: string;
    alsoFor: string[];
};

/** An item as the BiS list and the candidate view render it. */
export type CouncilItem = {
    id: number;
    name: string;
    iconUrl: string;
    ilvl: number;
    quality: number;
    stats: Record<string, number>;
    setName?: string;
    contentId: string;
    boss: string;
    /** Which specs have it on their BiS list for the tier being measured. */
    bisSpecs: BisSpec[];
    owned?: boolean;
};

/** What one raider would gain from one item. */
export type CouncilCandidate = {
    key: string;
    character: string;
    classColor: string;
    specKey: string;
    specLabel: string;
    specIconUrl: string;
    slot: number;
    slotName: string;
    /** What would come off — null when the slot is free. */
    replaces: WornItem | null;
    /**
     * Every slot the item could go in, with what sits there. Two rings, two
     * trinkets, or both hands for a two-hander; `chosen` marks where it lands
     * (both, for a two-hander, since it takes both).
     */
    slotOptions: { slot: number; slotName: string; chosen: boolean; item: WornItem | null }[];
    /** True when accepting it also costs the off-hand piece. */
    twoHanded: boolean;
    /**
     * Stat-weight value of the swap — the server's *ordering* while nothing is
     * simulated, never shown as a number: the page shows measured gains only.
     */
    value: number;
    /**
     * Why this raider's gain is not comparable to the others': what would come
     * off carries no caster stats at all, so the comparison measures against an
     * empty slot and credits them the item's full worth. Empty in the normal
     * case.
     */
    inflatedBy: { itemName: string; note: string }[];
    isBis: boolean;
    /** 1 when the item is on this raider's BiS list, else the server's non-BiS weight (0.5). */
    bisWeight: number;
    /** needScore × bisWeight: the need as it counts for this item. */
    itemNeedScore: number;
    /** The fairness half — the same numbers the roster table shows. */
    needScore: number;
    needParts: { drought: number; share: number; need: number };
    lootCount: number;
    lootTotal: number;
    /** See CouncilRaider.otherCount — off-spec, shards, bank. */
    otherCount: number;
    /** Their newest awards, so the loot count can be opened in a hover. */
    recentItems: CouncilLootItem[];
    daysSinceLoot: number | null;
    lastAwardAt: number;
    bisOwned: number;
    bisTotal: number;
    hasGear: boolean;
    simSupported: boolean;
};

/**
 * A raider who cannot equip the item at all — a warlock's tier helm for a
 * mage, a mail chest for a priest, a two-hander for a rogue. Never a
 * candidate; listed with the reason so a short list is explained.
 */
export type CouncilUnwearable = {
    key: string;
    character: string;
    classColor: string;
    specKey: string;
    specLabel: string;
    specIconUrl: string;
    /** "class" | "armor" | "weapon" | "ranged" */
    reason: string;
    /** The short German reason, e.g. "Kette — Magier trägt nur Stoff". */
    note: string;
};

/** The picked drop: the item, who could take it, who cannot. */
export type CouncilFocus = {
    item: CouncilItem;
    candidates: CouncilCandidate[];
    unwearable: CouncilUnwearable[];
};

export type CouncilRaider = {
    key: string;
    character: string;
    className: string;
    classColor: string;
    specIconUrl: string;
    spec: string;
    specKey: string;
    specLabel: string;
    /** True when the spec was assumed from the class (a mage is always a caster). */
    specAssumed: boolean;
    /** Their armory page, for checking the gear this page derived from a log. */
    armoryUrl: string;
    role: "caster" | "healer";
    /**
     * Als was der Raidlead sie eingeplant hat ("" = wie in den Daten). Ein
     * Heiler im Offspec ist für diesen Abend ein DPS, und das steht nirgends in
     * den Daten — also wird es festgelegt.
     */
    roleOverride: string;
    /** Was die Daten sagen: die Spec, mit der sie zuletzt geloggt wurden. */
    roleFromData: string;
    /** Welche Rollen ihre Klasse spielen kann. Eine = nichts zu wählen. */
    roleOptions: string[];
    /** Items in the current content filter; lootTotal counts all of them. */
    lootCount: number;
    lootTotal: number;
    /**
     * Off-spec rolls, shards and bank items. Deliberately *not* part of
     * lootCount: they did nothing for the raider's set, and counting them would
     * rank somebody who took three shards above one real upgrade.
     */
    otherCount: number;
    lastAwardAt: number;
    daysSinceLoot: number | null;
    items: CouncilLootItem[];
    gear: {
        seenAt: number;
        reportId: string;
        reportTitle: string;
        itemCount: number;
        spellHit: number;
        hitCap: number;
        /**
         * Whether the set read out of the log is this raider's damage kit or
         * their healing one ("caster" | "healer" | "" when too little is known).
         * Shamans and druids heal a night regularly, and judging them on that
         * set would mean no DPS and drops "replacing" healing pieces.
         */
        setRole: string;
        /** False when the two signals (heal ratio, spell hit) disagree. */
        setConfident: boolean;
        /** Every recent log showed the wrong role — the numbers are off. */
        roleMismatch: boolean;
        /** Newer raids skipped to find a set of the right role. */
        skippedReports: number;
        /**
         * Where this set comes from: "log" — the last evaluation, "wcl" — a
         * Warcraft-Logs report somebody loaded for this raider, "armory" —
         * what the character has on now, because somebody pressed the button.
         */
        source: "log" | "wcl" | "armory";
        /** When the armory answered (0 for a log set). */
        armoryAt: number;
        /** When the loaded log was fetched (0 unless source is "wcl"). */
        wclAt: number;
        /**
         * A log was loaded for this raider but not taken: "pvp" — an arena
         * set, "role" — the other role's set. The evaluation's set stays.
         */
        logRejected: "" | "pvp" | "role";
        /**
         * Why the armory's answer was *not* taken although there is one:
         * "pvp" — the character is in arena gear right now, which makes no
         * sense against a boss; "role" — a healing set for a raider judged as
         * a caster. The last raid's set stays in both cases.
         */
        armoryRejected: "" | "pvp" | "role";
        /** Every recent log showed PvP gear, so this set is one — and says so. */
        pvpGear: boolean;
        /**
         * Pieces that are new since the last raid: the armory names the item,
         * but its enchant ids are not the ones WoWSims uses, so no enchant is
         * claimed for them and the simulation runs them unenchanted.
         */
        unverifiedEnchants: number;
        /** Slots still held by a boss-specific piece the comparison reads as empty. */
        situational: number;
        /** Slots filled from another source (armory, another boss, an older raid). */
        substituted: number;
        /**
         * Boss-specific pieces taken out of the set entirely, because no source
         * could say what the raider wears there otherwise. Those slots count as
         * empty — which is what they are worth against every boss the council
         * plans for — and the page names them.
         */
        dropped: {
            slot: number;
            slotName: string;
            itemId: number;
            itemName: string;
            iconUrl: string;
            note: string;
        }[];
        /** Everything they wear, in character-sheet order. */
        items: WornItem[];
    } | null;
    bis: {
        tier: string;
        /** False when the list is from an earlier tier than the one asked for. */
        exact: boolean;
        /** Set when the list belongs to another spec (Fire mage borrows Arcane). */
        borrowedFrom: string;
        /** "wowsims" (simulated loadout) or "wowhead" (written, items only). */
        source: string;
        sourceLabel: string;
        total: number;
        owned: number;
        items: CouncilItem[];
    };
    simSupported: boolean;
    /** 0..1, higher = more due for an item. needParts shows what it is made of. */
    needScore: number;
    needParts: { drought: number; share: number; need: number };
};

export type CouncilGap = CouncilItem & {
    wantedBy: { key: string; character: string; specKey: string; specLabel: string; needScore: number }[];
    candidates: CouncilCandidate[];
    best: CouncilCandidate | null;
};

export type CouncilFilterOptions = {
    roles: { id: string; label: string }[];
    tiers: { id: string; label: string }[];
    contents: { id: string; label: string; short: string; tier: string }[];
    bisTiers: { id: string; label: string }[];
    categories: { id: string; name: string }[];
};

/** A raider the council has stopped planning with. */
export type ExcludedRaider = {
    key: string;
    character: string;
    reason: string;
    at: number;
    by: string;
};

/** One of the bot's newest logs, offered at a raider to load their gear from. */
export type CouncilLog = {
    reportId: string;
    title: string;
    postedAt: number;
    eventLabel: string;
    link: string;
};

export type LootCouncilData = {
    roster: CouncilRaider[];
    avgLootCount: number;
    recentLogs: CouncilLog[];
    /** Set aside, and offerable back. */
    excluded: ExcludedRaider[];
    gaps: CouncilGap[];
    focus: CouncilFocus | null;
    options: CouncilFilterOptions;
    filter: {
        role: string; tierIds: string[]; contentIds: string[]; categoryId: string;
        /** The BiS list actually measured against. */
        bisTier: string;
        /** True when nobody picked one and it came from the guild's newest loot. */
        bisTierDerived: boolean;
        /** How many raiders each filter removed — so a short list is explained. */
        skipped: { category: number; excluded: number };
        /**
         * What each source contributed to "who raids this category" — the logs
         * of its raids, the loot awarded there, and the maintained
         * raider→character assignment. All three zero means the filter found
         * nobody, which is why the list is empty; the page uses this to say
         * what to fix. null when no category is picked.
         */
        categorySources: { reports: number; loot: number; assigned: number } | null;
    };
    sim: { available: boolean; version: string; hint: string };
    activeGuildId: string;
};

export type CouncilFilter = {
    role?: string;
    tiers?: string[];
    contents?: string[];
    category?: string;
    bisTier?: string;
    item?: number;
};

export function getLootCouncil(filter: CouncilFilter = {}): Promise<LootCouncilData> {
    const params = new URLSearchParams();
    if (filter.role) params.set("role", filter.role);
    if (filter.tiers && filter.tiers.length) params.set("tiers", filter.tiers.join(","));
    if (filter.contents && filter.contents.length) params.set("contents", filter.contents.join(","));
    if (filter.category) params.set("category", filter.category);
    if (filter.bisTier) params.set("bisTier", filter.bisTier);
    if (filter.item) params.set("item", String(filter.item));
    const qs = params.toString();
    return get<LootCouncilData>(`/api/lootcouncil${qs ? `?${qs}` : ""}`);
}

/** Per raider: their simulated DPS, and what each candidate item would add. */
export type SimResult = Record<string, {
    baseline: number | null;
    hasGear: boolean;
    error?: string;
    items: Record<string, { dps: number | null; delta: number | null; slot: number; cached: boolean }>;
}>;

export type SimJob = {
    status: "running" | "done" | "error" | "unknown";
    progress?: number;
    total?: number;
    available?: boolean;
    result?: SimResult | null;
    error?: string;
};

export function startCouncilSim(
    csrfToken: string | null,
    id: string,
    subjects: { key: string; specKey: string }[],
    items: number[],
): Promise<{ status: string; alreadyRunning: boolean; id: string }> {
    return send("POST", "/api/lootcouncil/sim", csrfToken, { id, subjects, items });
}

export function getCouncilSim(id: string): Promise<SimJob> {
    return get<SimJob>(`/api/lootcouncil/sim?id=${encodeURIComponent(id)}`);
}

/**
 * Start a council simulation and poll it to the end.
 *
 * Its own poll loop rather than pollJob(): a sim job reports progress the page
 * shows while it runs ("7 von 24"), and pollJob only distinguishes running from
 * done. `onProgress` is called on every poll.
 */
export async function runCouncilSim(
    csrfToken: string | null,
    id: string,
    subjects: { key: string; specKey: string }[],
    items: number[],
    onProgress?: (job: SimJob) => void,
): Promise<SimResult> {
    await startCouncilSim(csrfToken, id, subjects, items);
    const startedAt = Date.now();
    const POLL_MS = 1500;
    // One raider is ~1s per item; a whole roster against a full BiS gap list is
    // the worst case this has to survive.
    const TIMEOUT_MS = 15 * 60 * 1000;
    for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const job = await getCouncilSim(id);
        if (onProgress) onProgress(job);
        if (job.status === "done") return job.result || {};
        if (job.status === "error") throw { code: "sim_failed", message: job.error || "Simulation fehlgeschlagen." } as ApiError;
        if (job.status === "unknown") throw { code: "sim_lost", message: "Die Simulation wurde unterbrochen. Bitte erneut starten." } as ApiError;
        if (Date.now() - startedAt > TIMEOUT_MS) {
            throw { code: "sim_timeout", message: "Die Simulation dauert ungewöhnlich lange. Bitte später erneut versuchen." } as ApiError;
        }
    }
}

/**
 * Items for the "this just dropped" picker.
 *
 * Searched in the bot's own caster item table, not on Wowhead: it answers
 * instantly, only offers items a caster can be handed, and every hit is
 * guaranteed to resolve to a slot and a stat block — which is what the
 * candidate list needs. Same result shape as the other item pickers, so
 * ItemSearchPicker takes it as-is.
 */
export function searchCouncilItems(q: string, tier = ""): Promise<{ items: CouncilItemHit[] }> {
    const qs = new URLSearchParams({ q });
    if (tier) qs.set("tier", tier);
    return get<{ items: CouncilItemHit[] }>(`/api/lootcouncil/item-search?${qs.toString()}`);
}

/**
 * A search hit, with the answer to the other direction on it: whose BiS list is
 * this piece on? An empty `bisSpecs` is that answer, not a missing field — most
 * items are on nobody's list.
 */
export type CouncilItemHit = ItemSearchResult & {
    /** The caster table knows the item level; the Wowhead pickers do not. */
    ilvl?: number;
    contentId: string;
    boss: string;
    bisSpecs: BisSpec[];
};

/** Which gear set is BiS for which caster DPS class and spec, as a matrix. */
export type BisListsData = {
    tier: string;
    /** Every tier, with the lists it has no set for (SWP has none for Shadow/Arcane). */
    tiers: { id: string; label: string; missing: string[] }[];
    /** Every caster and healer spec — including those that borrow a list. */
    specs: {
        key: string;
        label: string;
        className: string;
        spec: string;
        role: string;
        iconUrl: string;
        classColor: string;
        /** Whose list this spec plays. */
        listKey: string;
        ownList: boolean;
    }[];
    /** One column per list, carrying everyone who plays it. */
    columns: {
        key: string;
        label: string;
        iconUrl: string;
        classColor: string;
        role: string;
        /**
         * Where the list comes from: "wowsims" is a simulated loadout with gems
         * and enchants, "wowhead" a written recommendation naming items only.
         */
        source: string;
        sourceLabel: string;
        users: { key: string; label: string; ownList: boolean }[];
    }[];
    rows: {
        slot: number;
        slotName: string;
        cells: {
            column: string;
            item: CouncilItem | null;
            /** Sockets and enchant of the WoWSims reference set. */
            gems?: number;
            enchanted?: boolean;
            /** How many of the tier's lists want this item. */
            shared?: number;
        }[];
    }[];
    contested: number;
};

export function getBisLists(tier: string): Promise<BisListsData> {
    const qs = tier ? `?tier=${encodeURIComponent(tier)}` : "";
    return get<BisListsData>(`/api/lootcouncil/bislists${qs}`);
}

/**
 * Stop planning with a raider, or resume.
 *
 * Never deletes anything: the loot history stays whole, the raider simply drops
 * out of the roster and the candidate lists until somebody takes them back in.
 */
export function setCouncilExcluded(
    csrfToken: string | null,
    character: string,
    excluded: boolean,
    reason = "",
): Promise<{ character: string; excluded: boolean }> {
    return send("POST", "/api/lootcouncil/exclude", csrfToken, { character, exclude: excluded, reason });
}

/**
 * Als was ein Raider eingeplant ist. Ein leeres `role` nimmt die Festlegung
 * zurück, und die Seite folgt wieder dem, was die Daten sagen.
 */
export function setCouncilRole(
    csrfToken: string | null,
    character: string,
    role: "" | "caster" | "healer",
): Promise<{ character: string; role: string }> {
    return send("POST", "/api/lootcouncil/role", csrfToken, { character, role });
}

/**
 * Fetch these raiders' current gear from the armory.
 *
 * A button, not a page load: it is one call per raider to an API outside this
 * app, and "nimm den Stand von jetzt" is a decision the reader makes. The
 * council data has to be reloaded afterwards to show it.
 */
export function refreshCouncilArmory(
    csrfToken: string | null,
    characters: string[],
): Promise<{ asked: number; answered: number; configured: boolean }> {
    return send("POST", "/api/lootcouncil/armory", csrfToken, { characters });
}

/**
 * Load one raider's gear from a Warcraft-Logs report (one of the bot's logs by
 * id, any report by link, or — with neither — the newest log they are in), or
 * forget a loaded one with `clear`. The council data has to be reloaded
 * afterwards to show it.
 */
export function loadCouncilLogGear(
    csrfToken: string | null,
    body: { character: string; reportId?: string; link?: string; clear?: boolean },
): Promise<{ cleared?: boolean; reportId?: string; reportTitle?: string; reportStart?: number; items?: number; tried?: number }> {
    return send("POST", "/api/lootcouncil/loggear", csrfToken, body);
}

/**
 * A raider's loadout as a WoWSims "From JSON" import.
 *
 * Built from the same pieces as the page's own simulation — gear, talents, spec
 * options, rotation, consumables, buffs, encounter — so pasting it into
 * wowsims.github.io/tbc reproduces the number shown here. An export that
 * quietly differed would make the page look wrong when it is not.
 */
export type CouncilExport = {
    character: string;
    spec: string;
    specLabel: string;
    /** The WoWSims page it belongs on — the import does not switch class itself. */
    simUrl: string;
    seenAt: number;
    reportTitle: string;
    warnings: string[];
    json: string;
};

export function getCouncilExport(character: string): Promise<CouncilExport> {
    return get<CouncilExport>(`/api/lootcouncil/export?character=${encodeURIComponent(character)}`);
}

// ---- Mein Profil (#255, src/web/apiRoutes/profile.js) ----

export type GearLevel = "none" | "usable" | "ready";

/** "Laut Logs": seen = exactly this spec, other = in the logs with another spec, unknown = not in the logs. */
export type SpecEvidence = { status: "seen" | "other" | "unknown"; reports: number; source?: string; loggedSpec?: string };

export type ProfileSpec = {
    key: string;
    gear: GearLevel;
    label: string;
    specId: string;
    role: GameRole | "";
    icon: string;
    canTank: boolean;
    canHeal: boolean;
    logs: SpecEvidence;
};

export type RaiderRef = { userId: string; name: string; main: string; className: string };

export type ProfileCharacter = {
    key: string;
    name: string;
    realm: string;
    className: string;
    main: boolean;
    source: "log" | "armory" | "manual";
    armory: { level: number | null; guild: string; fetchedAt: number } | null;
    armoryUrl: string;
    specs: ProfileSpec[];
    /** Other accounts that added the same character. */
    claimedBy: { userId: string; name: string }[];
};

export type RaiderProfile = {
    userId: string;
    name: string;
    characters: ProfileCharacter[];
    canOfftank: boolean;
    canHeal: boolean;
    suggested: { canOfftank: boolean; canHeal: boolean };
    availability: string[];
    preferredRaids: string[];
    /** For the owner: whom they wished for — never whether it is mutual. */
    wishes: (RaiderRef & { mutual?: boolean })[];
    note: string;
    updatedAt: number;
    /** Only in the orga's view. */
    wishedBy?: RaiderRef[];
};

export type ProfileRaidGroup = {
    id: string;
    label: string;
    instances: { id: string; name: string; short: string; icon: string; status: string }[];
};

export type ProfileData = {
    profile: RaiderProfile;
    isNew: boolean;
    classes: GameClass[];
    roles: Record<GameRole, string>;
    raidGroups: ProfileRaidGroup[];
    weekdays: { id: string; label: string }[];
    gearLevels: { id: GearLevel; label: string }[];
    limits: { characters: number; wishes: number; note: number };
};

export type ProfilePatch = {
    canOfftank?: boolean | null;
    canHeal?: boolean | null;
    availability?: string[];
    preferredRaids?: string[];
    wishes?: string[];
    note?: string;
    characters?: { key: string; main?: boolean; specs?: { key: string; gear: GearLevel }[] }[];
};

export type LogCharacterSuggestion = {
    character: string;
    className: string;
    specKey: string;
    reports: number;
    lastSeen: number;
    match: "assigned" | "name" | "";
    claimedBy: { userId: string; name: string }[];
};

export type AddCharacterInput =
    | { source: "log"; name: string }
    | { source: "armory"; name: string; realm?: string; className?: string }
    | { source: "manual"; name: string; className: string; specs: string[] };

export type CharacterClaim = {
    key: string;
    character: string;
    className: string;
    claims: { userId: string; name: string; main: boolean }[];
};

export function getProfile(): Promise<ProfileData> {
    return get<ProfileData>("/api/profile");
}

export function saveProfile(csrfToken: string | null, patch: ProfilePatch): Promise<{ profile: RaiderProfile }> {
    return send("PUT", "/api/profile", csrfToken, patch);
}

export function getLogCharacters(q = ""): Promise<{ characters: LogCharacterSuggestion[] }> {
    return get(`/api/profile/log-characters?q=${encodeURIComponent(q)}`);
}

export function addProfileCharacter(csrfToken: string | null, input: AddCharacterInput): Promise<{
    character: ProfileCharacter;
    armory: { linked: boolean; fetched: boolean } | null;
    profile: RaiderProfile;
}> {
    return send("POST", "/api/profile/characters", csrfToken, input);
}

export function removeProfileCharacter(csrfToken: string | null, key: string): Promise<{ removed: boolean; profile: RaiderProfile }> {
    return send("POST", "/api/profile/characters", csrfToken, { remove: key });
}

export function searchRaiders(q: string): Promise<{ raiders: RaiderRef[] }> {
    return get(`/api/profile/raiders?q=${encodeURIComponent(q)}`);
}

export function getCharacterClaims(): Promise<{ claims: CharacterClaim[] }> {
    return get("/api/roster/character-claims");
}

// ---- Anmeldungen (#256): upcoming raids and the member's own signup ----

export type SignupRoleCount = { n: number; target: number };
export type SignupCounts = {
    tank: SignupRoleCount;
    healer: SignupRoleCount;
    dps: SignupRoleCount;
    attending: number;
    tentative: number;
    bench: number;
    absence: number;
    size: number;
};

/** An own signup, spec label and icon resolved by the server. */
export type OwnSignup = {
    status: SignupStatus;
    character: string;
    className: string;
    classColor: string;
    spec: string;
    specLabel: string;
    specIcon: string;
    role: GameRole | "";
    canAlso: GameRole[];
    comment: string;
};

type SignupEventBase = {
    id: string;
    title: string;
    startTime: number;
    categoryId: string;
    categoryName: string;
    contentIds: string[];
    contentSources: string[];
    /** The rule set's icon of the first planned instance ("" for Raid-Helper). */
    instanceIcon: string;
    size: number;
    attending: number;
    /** The event's post (own: the bot's message) or its channel in Discord. */
    discordUrl: string;
};

export type RaidHelperSignupRow = SignupEventBase & {
    source: "raidhelper";
    mine: { status: SignupStatus; specName: string } | null;
};

export type OwnSignupRow = SignupEventBase & {
    source: "eventhelper";
    versionId: string;
    deadline: number;
    deadlinePassed: boolean;
    started: boolean;
    /** What the member may pick right now — only absence/late after the deadline, nothing once started. */
    allowedStatuses: SignupStatus[];
    counts: SignupCounts;
    /** Whether the setup considers wishes (the dialog's hint text). */
    wishes: boolean;
    /** The member's own wish partners who already signed up. */
    wishPartners: { userId: string; name: string }[];
    mine: OwnSignup | null;
    /** Where the approved setup puts the member (#263) — never a draft; null before an approval. */
    placement?: SetupPlacement | null;
};

export type SignupEventRow = RaidHelperSignupRow | OwnSignupRow;

// ---- Setup editor of an own event (#263) — src/web/setupEditor.js, apiRoutes/setup.js ----

export type SetupPlacement =
    | { group: number; character: string; spec: string; role: GameRole | "" }
    | { bench: true; character: string; spec: string; role: GameRole | "" };

/** A raider in a group or on the bench, decorated for the page. */
export type SetupPerson = {
    userId: string;
    character: string;
    classId: string;
    spec: string;
    role: GameRole | "";
    /** Played as the signed spec; false = off-spec ("Zweitspec als Heiler"). */
    main?: boolean;
    status?: SignupStatus | "";
    locked?: boolean;
    /** Why they are where they are — shown in the tooltip only. */
    reasons?: string[];
    name: string;
    classColor: string;
    classLabel: string;
    specLabel: string;
    specIcon: string;
};

export type SetupEditorGroup = { index: number; slots: SetupPerson[] };

export type SetupRoleCheck = { count: number; min: number; max: number | null; ok: boolean };

export type SetupChecks = {
    ok: boolean;
    size: { count: number; size: number; ok: boolean };
    roles: Partial<Record<GameRole, SetupRoleCheck>>;
    buffs: {
        ok: boolean;
        required: { key: string; label: string; icon?: string; present: boolean }[];
        raid: { key: string; label: string; icon: string; present: boolean }[];
        party: { key: string; label: string; icon: string; groups: number[] }[];
    };
    wishes: { met: number; total: number };
};

export type SetupWeights = Record<string, number>;

export type StoredSetup = {
    status: "draft" | "approved";
    version: number;
    /** "auto" = drafted at the signup deadline without anybody asking (eventStore.saveSetupDraft). */
    origin: "proposal" | "manual" | "auto";
    groups: SetupEditorGroup[];
    bench: SetupPerson[];
    checks: SetupChecks;
    weights: SetupWeights;
    score: { total: number };
    warnings: string[];
    historySource: string;
    options: { weights: SetupWeights; fairness: boolean | null; wishes: boolean | null };
    updatedAt: number;
    approvedAt: number;
    approvedBy: string;
    changedSinceApproval: boolean;
    approved: ApprovedSetup | null;
    explanation: { text: string; model: string; at: number; version: number } | null;
};

export type ApprovedSetup = { version: number; approvedAt: number; approvedBy: string; groups: SetupEditorGroup[]; bench: SetupPerson[] };

export type SetupJob = { status: "running" | "done" | "error"; error: string } | null;

export type SetupEditorData = {
    eventId: string;
    event: { id: string; title: string; startTime: number; size: number; composition: Record<GameRole, number>; versionId: string; fairness: boolean; wishes: boolean };
    canWrite: boolean;
    approved: ApprovedSetup | null;
    /** Only for the orga (raids write) — a reader never receives the draft. */
    setup?: StoredSetup | null;
    groupCount?: number;
    signupCount?: number;
    absent?: number;
    defaults?: { weights: SetupWeights; maxWeight: number };
    hasApiKey?: boolean;
    explainJob?: SetupJob;
    message?: string;
};

/** What PUT /api/raids/setup takes: who stands where, and what is locked. */
export type SetupPlacementInput = {
    version: number;
    groups: { index: number; slots: { userId: string; spec: string; role: string; locked: boolean }[] }[];
    bench: { userId: string; locked: boolean }[];
    fairness?: boolean;
    wishes?: boolean;
    weights?: SetupWeights;
};

export function getRaidSetup(eventId: string): Promise<SetupEditorData> {
    return get(`/api/raids/setup?event=${encodeURIComponent(eventId)}`);
}

export function proposeRaidSetup(csrfToken: string | null, eventId: string, options: { weights?: SetupWeights; fairness?: boolean; wishes?: boolean } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/propose", csrfToken, { event: eventId, ...options });
}

export function saveRaidSetup(csrfToken: string | null, eventId: string, input: SetupPlacementInput): Promise<SetupEditorData> {
    return send("PUT", "/api/raids/setup", csrfToken, { event: eventId, ...input });
}

export function approveRaidSetup(csrfToken: string | null, eventId: string, version: number): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/approve", csrfToken, { event: eventId, version });
}

export function explainRaidSetup(csrfToken: string | null, eventId: string): Promise<{ eventId: string; status: string; alreadyRunning: boolean }> {
    return send("POST", "/api/raids/setup/explain", csrfToken, { event: eventId });
}

export function getRaidSetupExplain(eventId: string): Promise<{ eventId: string; job: SetupJob; explanation: StoredSetup["explanation"]; version: number }> {
    return get(`/api/raids/setup/explain?event=${encodeURIComponent(eventId)}`);
}

export type SignupProfileSpec = { key: string; label: string; icon: string; role: GameRole | ""; gear: GearLevel };
export type SignupProfileCharacter = { key: string; name: string; className: string; main: boolean; specs: SignupProfileSpec[] };
export type SignupProfile = { characters: SignupProfileCharacter[]; canOfftank: boolean; canHeal: boolean };
export type SignupClass = { id: string; label: string; color: string; icon: string };

export type SignupsData = {
    events: SignupEventRow[];
    profile: SignupProfile;
    classes: SignupClass[];
    error: string | null;
};

export type SignupInput = {
    eventId: string;
    character: string;
    spec: string;
    status: SignupStatus;
    canAlso: GameRole[];
    comment: string;
};

/** One signup of an own event as the orga sees it (raid detail, GET /api/signups/event). */
export type EventSignupEntry = OwnSignup & { userId: string; name: string; at: number };

export function getSignups(): Promise<SignupsData> {
    return get<SignupsData>("/api/signups");
}

export function saveSignup(csrfToken: string | null, input: SignupInput): Promise<{ signup: OwnSignup; counts: SignupCounts }> {
    return send("PUT", "/api/signups", csrfToken, input);
}

export function getEventSignups(eventId: string): Promise<{ eventId: string; counts: SignupCounts; signups: EventSignupEntry[] }> {
    return get(`/api/signups/event?id=${encodeURIComponent(eventId)}`);
}
