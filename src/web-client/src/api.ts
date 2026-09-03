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
export type SessionGuild = { id: string; name: string };
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

export type EventSheet = { filledAt: string; playerCount?: number } | null;

export type UpcomingEvent = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    signupCount: number;
    playerCount: number;
    sheet: EventSheet;
};

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

export type RecentReport = {
    id: string;
    title: string;
    zone: string;
    generatedAt: number;
    issueCount: number;
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

export type DashboardData = {
    stats: {
        reportsTotal: number;
        reportsWithIssues: number;
        templates: number;
        posts: number;
        categories: number;
        adminRoles: number;
    };
    recentReports: RecentReport[];
    upcoming: { events: UpcomingEvent[]; error: string | null };
    recentEvents: { events: RecentEvent[]; error: string | null };
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
};
export type ChannelsData = { categories: Category[]; channels: Channel[]; activeGuildId: string };

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

export type Role = { id: string; name: string };

export type BlizzardConfig = {
    clientId: string;
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
    guildId: string;
    raidhelperServerId: string;
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidDefaults: { templateId: string; channelId: string };
    blizzard: BlizzardConfig;
    // Which loot addon a Discord category raids with ("gargul" | "rclc" | ""),
    // keyed by category id — preselects the parser on the loot import and tells
    // the raid-detail loot tab which export to ask for.
    categoryLootTool: Record<string, string>;
    // A fixed Google Sheet per category, keyed by category id. A raid in that
    // category links this sheet unless the app made it a copy of its own.
    categorySheets: Record<string, { url: string; name: string }>;
    // The drops the guild counts as "big", picked from the Wowhead search in
    // Einstellungen → Loot. The dashboard highlights their awards.
    topItems: TopItem[];
};

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
    roles: Role[];
    categories: Category[];
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
};

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
    classes: RosterClassShare[];
};

export type RosterData = { chars: RosterChar[]; categories: Category[]; stats: RosterStats; activeGuildId: string };

export function getRoster(): Promise<RosterData> {
    return get<RosterData>("/api/roster");
}

export type RaidEvent = {
    id: string;
    title: string;
    startTime: number;
    leaderId: string;
    channelId: string;
    channelName: string;
    categoryId: string;
    templateId: string;
    description: string;
    signupCount: number;
};
export type RaidEventGroup = { categoryId: string; categoryName: string; events: RaidEvent[] };
export type RaidsData = { groups: RaidEventGroup[]; error: string | null; activeGuildId: string };

export function getRaids(): Promise<RaidsData> {
    return get<RaidsData>("/api/raids");
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

export type SetupPlayer = { name: string; classColor: string; specName: string; className: string; iconUrl: string };
export type SetupGroup = { label: string; players: SetupPlayer[] };
export type EventSetup = { total: number; groups: SetupGroup[] } | null;

export type AttendanceProfile = { classColor: string; specName: string; className: string; iconUrl: string };
// What the raider's reaction said — mirrors SIGNUP_STATUSES in
// src/utils/attendance.js. Only set on `responded`; someone who has not reacted
// has no status at all.
export type SignupStatus = "signed" | "tentative" | "late" | "bench" | "absence";
export type AttendancePerson = { id: string; displayName: string; character?: string; status?: SignupStatus; profile: AttendanceProfile | null };
export type Attendance = { responded: AttendancePerson[]; missing: AttendancePerson[] };

export type RaidDetailEvent = {
    id: string;
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
};

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
    attendanceRoleIds: string[];
    membersError: string | null;
    signupTarget: number;
    lootItems: LootItem[];
    lootTool: string;
    eventLogs: RaidLogRow[];
    unlinkedLogs: RaidLogRow[];
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
    input: { event: string; templateId: string; channelId: string; roleIds: string[] },
): Promise<{ message: string }> {
    return send("POST", "/api/raids/notify", csrfToken, input);
}

export function pingMissingRaiders(
    csrfToken: string | null,
    input: { event: string; text: string },
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

export type RaidTemplate = { id: string; name: string };

export type ReusableEvent = {
    id: string;
    title: string;
    templateId: string;
    description: string;
    channelId: string;
    channelName: string;
};

export type RaidCreateContext = {
    defaults: { templateId: string; channelId: string };
    leaderId: string;
    channels: Channel[];
    templates: RaidTemplate[];
    reusableEvents: ReusableEvent[];
};

export function getRaidCreateContext(): Promise<RaidCreateContext> {
    return get<RaidCreateContext>("/api/raids/new");
}

export type CreateRaidInput = {
    title: string;
    date: string;
    time: string;
    templateId: string;
    channelId?: string;
    channelName?: string;
    sourceEventId?: string;
    leaderId: string;
    description: string;
};

export function createRaid(csrfToken: string | null, input: CreateRaidInput): Promise<{ id?: string }> {
    return send("POST", "/api/raids", csrfToken, input);
}

export function getRaidTemplates(): Promise<{ templates: RaidTemplate[] }> {
    return get<{ templates: RaidTemplate[] }>("/api/raid-templates");
}

export function createRaidTemplate(csrfToken: string | null, input: { id: string; name: string }): Promise<RaidTemplate> {
    return send("POST", "/api/raid-templates", csrfToken, input);
}

export function deleteRaidTemplate(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("POST", "/api/raid-templates/delete", csrfToken, { id });
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
};

export type TextChannel = { id: string; name: string; category: string };
export type Emoji = { id: string; name: string; animated: boolean; code: string; url: string };

export type RecruitmentView = "templates" | "posts" | "applications";

export type RecruitmentData = {
    view: RecruitmentView | "";
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

export function getLootInbox(): Promise<{ sessions: InboxSession[] }> {
    return get<{ sessions: InboxSession[] }>("/api/history/inbox");
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

export type ReportSummary = {
    id: string;
    title: string;
    zone: string;
    generatedAt: number;
    reportId: string;
    reportUrl: string;
    playerCount: number;
    issueCount: number;
    // Raid assignment, resolved via the tracked log this report came from
    // (annotateReportEvents). All empty when there is no log / no raid.
    logId: string;
    eventId: string;
    eventLabel: string;
    eventStartTime: number;
};

// A candidate raid event a detected log could belong to, ranked by how close
// its start time is to the log's post time — mirrors matchOptionLabel()'s input.
export type MatchCandidate = {
    eventId: string;
    title: string;
    startTime: number;
    categoryName: string;
    diffMs: number;
    sameCategory: boolean;
};

export type LogRow = {
    id: string;
    guildId: string;
    channelId: string;
    messageId: string;
    reportId: string;
    link: string;
    title: string;
    status: "open" | "done";
    postedAt: number;
    detectedAt: number;
    categoryId: string;
    categoryName: string;
    channelName: string;
    eventId: string;
    eventLabel: string;
    eventStartTime: number;
    eventLinkSource: "manual" | "auto" | "";
    reportUrl: string;
    reportRefId: string;
    /**
     * Time-matched event candidates. Absent for logs that are already linked —
     * the backend's annotateMatches() skips those, so this must stay optional.
     */
    candidates?: MatchCandidate[];
    matchAmbiguous?: boolean;
    /** Which analyses already ran for this log ("cla" / "rpb"). */
    sections?: string[];
};

export type ClaData = {
    view: "reports" | "logs";
    reportPage: ClaPage<ReportSummary> | null;
    logPage: ClaPage<LogRow> | null;
    matchEventsError: string | null;
    unlinkedCount: number;
    counts: { reports: number; logs: number };
    logChannelsConfigured: boolean;
    activeGuildId: string;
};

export function getClaData(view: "reports" | "logs", sort?: string, dir?: string, page?: number): Promise<ClaData> {
    const qs = new URLSearchParams();
    qs.set("view", view);
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
};

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
    opts: { force?: boolean } = {},
): Promise<{ id: string; url: string }> {
    const started = await send<{ jobId: string }>("POST", "/api/cla", csrfToken, { link, force: !!opts.force });
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
            throw { code, message: state.error || failMessage } as ApiError;
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

export function unlinkReport(
    csrfToken: string | null,
    reportId: string,
): Promise<{ reportId: string; logId: string; message: string }> {
    return send("POST", "/api/cla/report-unlink", csrfToken, { reportId });
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
    /** Stat-weight value of the swap. Negative means it would be a downgrade. */
    value: number;
    /**
     * Why this raider's gain is not comparable to the others': what would come
     * off carries no caster stats at all, so the comparison measures against an
     * empty slot and credits them the item's full worth. Empty in the normal
     * case.
     */
    inflatedBy: { itemName: string; note: string }[];
    isBis: boolean;
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
        /** Slots still held by a boss-specific piece the comparison reads as empty. */
        situational: number;
        /** Slots filled from an older raid instead of one. */
        substituted: number;
        /** Everything they wear, in character-sheet order. */
        items: WornItem[];
    } | null;
    bis: {
        tier: string;
        /** False when the list is from an earlier tier than the one asked for. */
        exact: boolean;
        /** Set when the list belongs to another spec (Fire mage borrows Arcane). */
        borrowedFrom: string;
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

export type LootCouncilData = {
    roster: CouncilRaider[];
    avgLootCount: number;
    /** Set aside, and offerable back. */
    excluded: ExcludedRaider[];
    gaps: CouncilGap[];
    focus: { item: CouncilItem; candidates: CouncilCandidate[] } | null;
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
    /** All nine caster DPS specs — including the four that borrow a list. */
    specs: {
        key: string;
        label: string;
        className: string;
        spec: string;
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
