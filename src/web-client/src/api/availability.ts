import { get, send } from "./client";
import type { SignupStatus } from "./raidDetail";

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
