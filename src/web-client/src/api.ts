// Thin fetch wrapper for the /api/* JSON layer (src/web/apiRouter.js). No React
// Query — the app is small enough that useEffect + useState covers it (see the
// migration plan discussed for this project).

import type { SpecCatalogEntry } from "./lib/recruitmentSpecs";

export type ApiError = { code: string; message: string };

export type SessionUser = { id: string; name: string; isAdmin: boolean };
export type Session = { user: SessionUser | null; csrfToken: string | null };

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

async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: "include" });
    const body = await res.json();
    if (!res.ok) {
        const err: ApiError = body?.error || { code: "unknown", message: `HTTP ${res.status}` };
        throw err;
    }
    return body.data as T;
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
    const body = await res.json();
    if (!res.ok) {
        const err: ApiError = body?.error || { code: "unknown", message: `HTTP ${res.status}` };
        throw err;
    }
    return body.data as T;
}

export function getSession(): Promise<Session> {
    return get<Session>("/api/session");
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
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidDefaults: { templateId: string; channelId: string };
    blizzard: BlizzardConfig;
};

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
export type AttendancePerson = { id: string; displayName: string; character?: string; profile: AttendanceProfile | null };
export type Attendance = { responded: AttendancePerson[]; missing: AttendancePerson[] };

export type RaidDetailEvent = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    signupCount: number;
};

export type RaidDetailEventSheet = { url: string; eventTitle: string; deleteAfter: number } | null;
export type EventSoftres = { url: string; editUrl: string; instances: unknown[]; amount: number; hardReserveCount: number } | null;

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
    tankCandidates: TankCandidate[];
    eventSheet: RaidDetailEventSheet;
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
};

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

export type SoftresSearchItem = { id: number; name: string; iconUrl?: string };

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

export type LootSource = "gargul" | "rclc" | string;

export type LootEventSummary = {
    eventId: string;
    label: string;
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

export type LootItem = {
    itemId: number;
    itemName: string;
    itemIconUrl?: string;
    itemLink: string;
    character: string;
    response: string;
    offspec: boolean;
    boss: string;
    awardedAt: number;
    source: LootSource;
    eventId?: string;
    eventLabel?: string;
};

// A loot character with its resolved WoW class/spec (or blank if unresolved
// yet). classColor/iconUrl are computed server-side from config/classlist.js
// — never duplicated client-side, same rule as lib/recruitmentSpecs.ts's
// specCatalog.
export type AnnotatedCharacter = {
    key: string;
    character: string;
    realm: string;
    count: number;
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

export function deleteHistoryLog(csrfToken: string | null, logId: string): Promise<{ id: string }> {
    return send("POST", "/api/history/log-delete", csrfToken, { logId });
}

export type ImportLootInput = { data: string; tool: string; event: string; manualLabel: string };

export function importLoot(
    csrfToken: string | null,
    input: ImportLootInput,
): Promise<{ eventId: string; eventLabel: string; added: number; skipped: number }> {
    return send("POST", "/api/history/import", csrfToken, input);
}

export function saveCategoryLootTool(
    csrfToken: string | null,
    input: { categoryId: string; tool: string },
): Promise<{ categoryId: string; tool: string }> {
    return send("POST", "/api/history/category-tool", csrfToken, input);
}

export function clearHistoryEvent(csrfToken: string | null, event: string): Promise<{ removed: number }> {
    return send("POST", "/api/history/clear", csrfToken, { event });
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

export type GearItem = {
    slot: string;
    itemId: number | null;
    name: string;
    quality: string;
    level: number | null;
    enchants: string[];
    gems: string[];
    emptySockets: number;
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
    candidates: MatchCandidate[];
    matchAmbiguous: boolean;
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

export function createReport(csrfToken: string | null, link: string): Promise<{ id: string; url: string }> {
    return send("POST", "/api/cla", csrfToken, { link });
}

export function evalLog(
    csrfToken: string | null,
    logId: string,
): Promise<{ id?: string; url: string; alreadyEvaluated?: boolean }> {
    return send("POST", "/api/cla/eval", csrfToken, { logId });
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

export function unlinkLog(csrfToken: string | null, logId: string): Promise<{ logId: string; message: string }> {
    return send("POST", "/api/cla/log-unlink", csrfToken, { logId });
}

export function autoMatchLogs(csrfToken: string | null): Promise<{ matched: number; remaining: number; message: string }> {
    return send("POST", "/api/cla/log-automatch", csrfToken, {});
}
