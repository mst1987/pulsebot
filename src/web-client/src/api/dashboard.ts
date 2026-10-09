import { get, send } from "./client";
import type { ChannelState } from "../lib/discord/discordLinks";
import type { VersionChoice } from "./raidTemplates";

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
    /** Whether the channel still exists (#537). */
    channelState?: ChannelState;
    categoryId?: string;
    categoryName: string;
    /** The game version this raid plays (#545): its own, else its category's. */
    versionId?: string;
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

/** Which loot system a raid runs on — src/web/lootSystem.js's resolveLootSystem(). */
export type LootSystemKey = "softres" | "lootcouncil" | "gdkp" | "other";
export type LootSystem = {
    system: LootSystemKey;
    label: string;
    /** Where it came from: the raid itself, the category setting, the RCLootcouncil addon, or the default. */
    source: "event" | "category" | "addon" | "default";
    categorySystem: LootSystemKey;
    categoryLabel: string;
    /** A non-softres raid that offers a softres list in addition. */
    softresExtra: boolean;
    /** Softres step, badge and menu entry are shown. */
    softres: boolean;
};

export type DashboardRaid = {
    id: string;
    title: string;
    startTime: number;
    channelId: string;
    channelName: string;
    /** Whether the channel still exists (#537). */
    channelState?: ChannelState;
    categoryId: string;
    /** The Discord category the raid's channel sits in ("" = none known). */
    categoryName: string;
    /** How the category plans: the raid plan or a Google Sheet (planning.js) — only "sheet" raids have a sheet to miss. */
    planning: "raidplan" | "sheet";
    /** WoW icon name of the raid's final boss. */
    icon: string;
    size: number;
    signupCount: number;
    setupCount: number;
    roles: DashboardRole[];
    sheet: DashboardSheet;
    softres: { url: string } | null;
    lootSystem?: LootSystem;
};

export type DashboardTaskTone = "ok" | "mid" | "bad" | "accent";

/**
 * What a task's own button does: "Kanal neu anlegen" for a raid whose channel is gone (#537), or — for a
 * trial ending soon (#658) — "Übernehmen" (status core) and "Verlängern" (trialUntil = `extendTo`).
 */
export type DashboardTaskAction =
    | { kind: "recreateChannel"; eventId: string; label: string }
    | { kind: "rosterTrial"; rosterId: string; userId: string; extendTo: string; label: string };

export type DashboardTask = {
    /** "sheet", "logs", … — or "channel-missing:<eventId>", one per raid. */
    id: string;
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
    /** A button beside the row (orga with raid write access only). */
    action?: DashboardTaskAction;
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

// ---- "Für dich" (src/web/dashboard/dashboardPersonal.js) ----

/** The raider's own signup status; "" = not signed up yet. */
export type PersonalStatus = "" | "signed" | "late" | "tentative" | "bench" | "absence";

/** One of the raider's next raids with their own signup, setup place, softres list and published plan. */
export type PersonalRaid = {
    id: string;
    source: string;
    title: string;
    startTime: number;
    categoryName: string;
    icon: string;
    status: PersonalStatus;
    character: string;
    spec: string;
    specIcon: string;
    /** the approved setup's group, or the bench; null = no approved setup or not placed */
    placement: { group?: number; bench?: boolean; character?: string } | null;
    /** signup deadline in seconds; 0 = none */
    deadline: number;
    deadlinePassed: boolean;
    signupsClosed: boolean;
    cancelled: boolean;
    rosterOnly: boolean;
    softresUrl: string;
    /** a published raid plan's token (/p/<token>); "" = none published */
    planToken: string;
};

/** A past night of the raider: their status and that night's evaluation as they see it. */
export type PersonalNight = {
    eventId: string;
    title: string;
    startTime: number;
    categoryName: string;
    icon: string;
    /** present | bench | vacation | absence | noSignup | noShow (rosterAttendance.js) */
    status: string;
    attended: boolean;
    /** the newest evaluation: their player page and the approved recommendations for them (null hints = not in the log) */
    report: { url: string; hints: number | null } | null;
};

export type DashboardPersonal = {
    upcoming: PersonalRaid[];
    upcomingError: string | null;
    attendance: {
        attended: number;
        total: number;
        bench: number;
        last: { eventId: string; title: string; startTime: number; status: string; attended: boolean }[];
    } | null;
    recent: PersonalNight[];
    profile: { characters: number; hints: { kind: "noCharacters" | "noSpec"; character: string }[] };
};

export type DashboardData = {
    kicker: { guild: string; realm: string };
    /** Whether the orga part is shown (raid events readable). */
    orga: boolean;
    /** "Für dich"; null without a signup area of one's own. */
    personal: DashboardPersonal | null;
    nextRaid: DashboardRaid | null;
    followingRaid: DashboardRaid | null;
    nextRaidError: string | null;
    tasks: DashboardTask[];
    /** The orga's figures; null for a raider. */
    areas: {
        lastReport: DashboardLastReport | null;
        newLoot: { count: number; since: number };
        roster: { total: number; withoutDiscord: number } | null;
    } | null;
    recentEvents: { events: (RecentEvent & { icon: string })[]; error: string | null };
    // Latest awards of the items defined as "top items" in Einstellungen → Loot.
    // `configured` is how many are defined at all, which distinguishes "nothing
    // configured" from "configured, but nothing dropped yet".
    topLoot: { items: TopLootAward[]; configured: number };
    activeGuildId: string;
    // The version filter shared by the three raid/loot tiles (#545): what is
    // shown ("" = every version, "all" asked for), the default, and the choices.
    version: string;
    mainVersion: string;
    versions: VersionChoice[];
};

/** `version`: a version id, "all" for every version, "" (default) = the main version. */
export function getDashboard(version = ""): Promise<DashboardData> {
    return get<DashboardData>(`/api/dashboard${version ? `?version=${encodeURIComponent(version)}` : ""}`);
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

/**
 * The dashboard's trial row (#658): take a trial member over as core, or extend the trial to `extendTo`
 * (POST /api/rosters/members — area `roster` write and manager of that roster).
 */
export function decideTrial(action: { rosterId: string; userId: string; extendTo: string }, decision: "adopt" | "extend"): Promise<{ userId: string }> {
    const patch = decision === "adopt" ? { status: "core", trialUntil: null } : { trialUntil: action.extendTo };
    return send("POST", "/api/rosters/members", { rosterId: action.rosterId, userId: action.userId, mode: "update", ...patch });
}
