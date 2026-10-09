import { get, send } from "./client";
import type { SignupStatus } from "./raidDetail";
import type { AttendanceOverride, AttendanceStatus } from "./roster";

// ---- Ab- & Anwesenheit (src/web/apiRoutes/availability.js) ----
// "Away from … to …" signs a raider off from every raid of that period, "there
// from … to … with this character" signs them up — now and for raids created
// later. The orga (`raids` write) may enter for another raider via `userId`.

export type AvailabilityKind = "absence" | "presence";

export type AvailabilityEntry = {
    id: string;
    kind: AvailabilityKind;
    /** "yyyy-MM-dd", server time. */
    from: string;
    to: string;
    comment: string;
    character: string;
    spec: string;
    specLabel: string;
    versionId: string;
    /** Set when the entry was made at a category's Discord panel. */
    categoryId: string;
    categoryName: string;
    /** Entered by the raid lead for the raider. */
    byOrga: boolean;
    /** How many raids it changed so far. */
    done: number;
};

export type AvailabilityCharacter = {
    key: string;
    name: string;
    className: string;
    versionId: string;
    specs: { key: string; label: string; gear: string }[];
};

export type AvailabilityData = {
    userId: string;
    name: string;
    /** Whether the caller may enter for other raiders. */
    orga: boolean;
    /** "yyyy-MM-dd" of today in server time. */
    today: string;
    /** How many days one entry may span. */
    maxDays: number;
    entries: AvailabilityEntry[];
    /** In the raider's own order — the first is the one to suggest (there is no main). */
    characters: AvailabilityCharacter[];
};

export type AvailabilityInput = {
    kind: AvailabilityKind;
    from: string;
    to: string;
    /** The character's key (attendance only). */
    character?: string;
    spec?: string;
    /** Somebody else's account — the orga only. */
    userId?: string;
};

export type AvailabilityRaid = {
    id: string;
    title: string;
    /** Unix seconds. */
    startTime: number;
    categoryName: string;
    /** The raider's current signup in it, "" = none. */
    status: SignupStatus | "";
    url: string;
};

export type AvailabilitySkip = "" | "already_absent" | "already_signed" | "absent";

export type AvailabilityResult = {
    eventId: string;
    title: string;
    startTime: number;
    ok: boolean;
    skipped: AvailabilitySkip;
    error: string;
};

export type AvailabilityPanel = { categoryId: string; channelId: string; postedAt: number; url: string };

export function getAvailability(userId = ""): Promise<AvailabilityData> {
    return get<AvailabilityData>(userId ? `/api/availability?userId=${encodeURIComponent(userId)}` : "/api/availability");
}

export function previewAvailability(input: AvailabilityInput): Promise<{ raids: AvailabilityRaid[] }> {
    return send("POST", "/api/availability/preview", input);
}

export function saveAvailability(input: AvailabilityInput & { comment: string; eventIds: string[] }): Promise<{
    entry: AvailabilityEntry;
    results: AvailabilityResult[];
    /** Whether the DM to the raider went out. */
    dm: boolean;
}> {
    return send("POST", "/api/availability", input);
}

export function deleteAvailability(id: string): Promise<{ id: string }> {
    return send("DELETE", "/api/availability", { id });
}

/** One link button of a category's raider organizer in Discord. */
export type AvailabilityLink = { label: string; url: string };

export type AvailabilityPanelsData = {
    panels: AvailabilityPanel[];
    /** The organizer's link buttons per category id. */
    links: Record<string, AvailabilityLink[]>;
    /** How many links one category may have. */
    maxLinks: number;
};

export function getAvailabilityPanels(): Promise<AvailabilityPanelsData> {
    return get("/api/availability/panels");
}

/** Replace a category's link buttons; empty rows are dropped, an empty list removes them. */
export function saveAvailabilityLinks(categoryId: string, links: AvailabilityLink[]): Promise<{ categoryId: string; links: AvailabilityLink[] }> {
    return send("PUT", "/api/availability/links", { categoryId, links });
}

export function postAvailabilityPanel(categoryId: string, channelId: string): Promise<{ panel: AvailabilityPanel }> {
    return send("POST", "/api/availability/panel", { categoryId, channelId });
}

export function removeAvailabilityPanel(categoryId: string): Promise<{ categoryId: string }> {
    return send("DELETE", "/api/availability/panel", { categoryId });
}

// ---- the orga's overview: Roster › Abwesenheiten (src/services/signups/absenceOverview.js) ----

/** Who a row or chip is: the first character of their latest signup, else of their profile. */
export type AbsenceIdentity = {
    userId: string;
    /** The Discord name, else the profile's, else the character. */
    name: string;
    character: string;
    /** "Druid-Restoration", "" unknown. */
    spec: string;
    specLabel: string;
    classId: string;
    /** The class colour of the rule set ("#FF7D0A"), "" unknown. */
    classColor: string;
    /** The spec's WoW icon name, "" unknown. */
    specIcon: string;
    role: string;
};

export type AbsencePeriodState = "planned" | "running" | "past";

/** One entered period ("Abwesend eintragen" / "Anwesend eintragen"). */
export type AbsencePeriod = {
    id: string;
    kind: AvailabilityKind;
    /** "yyyy-MM-dd", server time, both counted. */
    from: string;
    to: string;
    days: number;
    /** The reason; "" for anyone but the raid lead. */
    comment: string;
    /** Set when the period holds for one category only. */
    categoryId: string;
    categoryName: string;
    byOrga: boolean;
    state: AbsencePeriodState;
};

/** A single raid signed off from without a period covering it. */
export type AbsenceSingle = { eventId: string; day: string; title: string };

/** "3 of the last 4 raids of a category signed off one by one". */
export type AbsenceHintInfo = { categoryId: string; categoryName: string; count: number; of: number; days: string[] };

export type AbsenceRaider = AbsenceIdentity & {
    periods: AbsencePeriod[];
    singles: AbsenceSingle[];
    /** Days of the longest absence. */
    longest: number;
    long: boolean;
    awayToday: boolean;
    hint: AbsenceHintInfo | null;
    /** Only attendance periods, no absence. */
    onlyPresence: boolean;
    firstDay: string;
};

export type AbsenceHint = AbsenceIdentity & AbsenceHintInfo;

export type AbsenceRoleGap = { need: number; have: number; away: number };

export type AbsenceRaid = {
    id: string;
    title: string;
    /** Unix seconds. */
    startTime: number;
    day: string;
    categoryId: string;
    categoryName: string;
    size: number;
    signed: number;
    away: number;
    roles: { tank: AbsenceRoleGap; healer: AbsenceRoleGap };
    absent: { userId: string; how: "period" | "single"; until: string; comment: string }[];
    url: string;
};

export type AbsenceOverview = {
    /** This Monday … the last day shown, "yyyy-MM-dd". */
    from: string;
    to: string;
    today: string;
    weeks: number;
    categories: { id: string; name: string }[];
    /** The categories the view is filtered to (`category=a,b`); empty = all. `categories` names every one regardless. */
    picked?: string[];
    raids: AbsenceRaid[];
    /** Sorted by the server: away today, the longest, the first day, the name. */
    raiders: AbsenceRaider[];
    hints: AbsenceHint[];
    tiles: {
        today: string[];
        nextWeek: string[];
        long: string[];
        biggest: null | { raidId: string; day: string; title: string; away: number; healers: number; tanks: number };
    };
    /** Whether the caller may enter and delete (the raid lead). */
    canEdit: boolean;
    withReasons: boolean;
};

export type AbsenceHistoryStatus = "in" | "off" | "none" | "other";

export type AbsenceRaiderDetail = AbsenceIdentity & {
    entries: (AbsencePeriod & { done: number; character: string; spec: string })[];
    /** The last raids of their categories, oldest first. */
    history: { eventId: string; day: string; title: string; status: AbsenceHistoryStatus }[];
    counts: Record<AbsenceHistoryStatus, number>;
    canEdit: boolean;
};

export function getAbsenceOverview(weeks: number, category = ""): Promise<AbsenceOverview> {
    const q = new URLSearchParams({ weeks: String(weeks) });
    if (category) q.set("category", category);
    return get(`/api/availability/overview?${q.toString()}`);
}

export function getAbsenceRaider(userId: string): Promise<AbsenceRaiderDetail> {
    return get(`/api/availability/overview/raider?userId=${encodeURIComponent(userId)}`);
}

// ---- "Meine Anwesenheit": one raider's attendance per raid category and raid (src/web/availability/raiderAttendance.js) ----

/**
 * One counted raid night and its verdict: `status` the code (#677), `detail` why, `override` when the orga set it by
 * hand; `reason` is the server's German word ("im Log", "keine Anmeldung" …), kept for older answers.
 */
export type AttendanceRaid = {
    eventId: string; title: string; startTime: number; attended: boolean; reason: string;
    status?: AttendanceStatus; detail?: string; override?: AttendanceOverride;
};

/** A coming raid of the category with the raider's own signup status ("" = none). */
export type AttendanceUpcoming = { eventId: string; title: string; startTime: number; status: SignupStatus | ""; url: string };

export type AttendanceCategory = {
    id: string;
    name: string;
    /** WoW icon of the raid the category mostly runs, "" when none is known. */
    icon?: string;
    /** 0–100, null while no raid counts. */
    pct: number | null;
    attended: number;
    total: number;
    /** "auto": the characters were matched automatically, "manual": assigned by the orga. */
    link: "manual" | "auto";
    /** How many raids count at most (the last n). */
    window: number;
    raids: AttendanceRaid[];
    upcoming: AttendanceUpcoming[];
};

export type RaiderAttendanceData = {
    userId: string;
    name: string;
    /** The character of the newest signup, "" none — the name when there is no other. */
    character?: string;
    /** The caller's own attendance. */
    own: boolean;
    /** Whether the caller is the raid lead (may look at anyone's). */
    orga: boolean;
    /** The caller may set a night by hand (admin or raids write, #677). */
    canEdit?: boolean;
    categories: AttendanceCategory[];
};

/** The own attendance, or a raider's for the orga. */
export function getRaiderAttendance(userId = ""): Promise<RaiderAttendanceData> {
    return get(userId ? `/api/availability/attendance?userId=${encodeURIComponent(userId)}` : "/api/availability/attendance");
}
