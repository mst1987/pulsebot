import { get } from "./client";
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

/** What a task's own button does (#537): "Kanal neu anlegen" for a raid whose channel is gone. */
export type DashboardTaskAction = { kind: "recreateChannel"; eventId: string; label: string };

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
