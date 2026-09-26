import { get, send } from "./client";
import type { LootSystemKey, LootSystem } from "./dashboard";
import type { Role, PingTarget, PingTargetInfo, ItemSearchResult, Raidsheet } from "./settings";
import type { NotifyTemplate } from "./notifyTemplates";
import type { LootItem } from "./history";
import type { EventSignupEntry } from "./signups";

/** Role bucket of a raidplan spec — mirrors roleOf() in src/utils/setupView.js. */
export type SetupRole = "tank" | "healer" | "melee" | "ranged" | "dps";
export type SetupPlayer = { name: string; classColor: string; specName: string; className: string; iconUrl: string; role?: SetupRole; group?: number };
export type SetupGroup = { label: string; players: SetupPlayer[] };
export type EventSetup = { total: number; groups: SetupGroup[]; roleCounts?: Partial<Record<SetupRole, number>> } | null;

/** One step of the Raid-Detail progress bar — built by src/web/raidDetailSteps.js. */
export type RaidStepKey = "signup" | "setup" | "sheet" | "softres" | "loot" | "logs";
export type RaidDetailModal = "notify" | "sheet" | "softres" | "lootsystem" | "loot" | "log" | "ping" | "invite" | "move" | "cancel" | "raider" | "history" | "delete";
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

/**
 * Das Raid-Cockpit eines eigenen Events (#319) — die fünf Schritte aus
 * src/web/raidDetailSteps.js' eventSteps(). Ein Raid-Helper-Event hat keines
 * (`steps: null`) und behält die Leiste von #219.
 */
export type RaidEventStepId = "created" | "signup" | "setup" | "approval" | "after";
export type RaidEventStepState = "done" | "current" | "todo" | "skipped" | "cancelled";
/** Die eine Tat eines Schritts: ein Menü-Eintrag, ein Dialog, ein Tab oder eine Auswertung. */
export type RaidStepDeed = {
    id: string;
    label: string;
    icon: string;
    /** Ein Eintrag von „Event verwalten“ (lib/eventManage.ts' ManageAction). */
    manage?: "edit" | "signups" | "reopen";
    modal?: RaidDetailModal;
    tab?: "roster" | "setup" | "loot" | "logs";
    evaluate?: { logId: string; section: LogSection };
};
export type RaidEventStep = {
    id: RaidEventStepId;
    label: string;
    icon: string;
    state: RaidEventStepState;
    /** Die große Zahl, ihre kleine Einheit und eine Randnotiz ("3 auf der Warteliste"). */
    value: string;
    unit: string;
    note: string;
    fill?: number | null;
    /** Der eine erklärende Satz — er steht im Tooltip, nicht auf der Fläche. */
    hint: string;
    action: RaidStepDeed | null;
};
export type RaidEventSteps = {
    steps: RaidEventStep[];
    current: RaidEventStepId | "";
    /** Die Haupt-Tat: die des offenen Schritts, bei einem abgesagten Event der Weg zurück. */
    action: RaidStepDeed | null;
    cancelled: boolean;
    note: string;
};

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
    /** The event has a raid plan: always an own event, a Raid-Helper event once the orga switched it on (docs/raidplan.md). */
    raidplanEnabled?: boolean;
    /** Raid-Helper is switched off in the settings: a Raid-Helper event's plan works from the line-up it saved last. */
    raidhelperDisabled?: boolean;
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
    /** Wo die freigegebene Setup-Nachricht steht (#290), soweit die Leiste sie nennt. */
    ownSetupPost?: { channelId: string; messageId: string; version: number; dms: { total: number; sent: number; failed: number } | null } | null;
    attendanceRoleIds: string[];
    membersError: string | null;
    signupTarget: number;
    lootItems: LootItem[];
    lootTool: string;
    /** Softres, Loot-Council, … — whether the softres step and menu entry are offered. */
    lootSystem?: LootSystem;
    eventLogs: RaidLogRow[];
    unlinkedLogs: RaidLogRow[];
    /** The progress bar and the head's primary action. */
    progress: RaidProgress;
    /** Die Schritt-Leiste eines eigenen Events (#319); null bei Raid-Helper. */
    steps: RaidEventSteps | null;
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

/** "Invite callen": who of groups 1–5 would be pinged, and the line — nothing is posted. */
export function previewInviteCall(csrfToken: string | null, event: string): Promise<{ count: number; text: string; groups: number[] }> {
    return send("POST", "/api/raids/invite-call", csrfToken, { event, dryRun: true });
}

/** "Invite callen": ping groups 1–5 of the approved setup with "/w <Charakter> inv". */
export function callInvite(csrfToken: string | null, event: string): Promise<{ message: string; count: number; text: string }> {
    return send("POST", "/api/raids/invite-call", csrfToken, { event });
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

/** This raid's loot system where it differs from its category's (`system` "" = like the category). */
export function setRaidLootSystem(
    csrfToken: string | null,
    input: { event: string; system: LootSystemKey | ""; softres: boolean },
): Promise<{ message: string; lootSystem: LootSystem }> {
    return send("POST", "/api/raids/loot-system", csrfToken, input);
}
