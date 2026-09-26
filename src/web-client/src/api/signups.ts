import { get, send } from "./client";
import type { SignupStatus } from "./raidDetail";
import type { GameRole } from "./raidTemplates";
import type { GearLevel } from "./profile";
import type { SetupPlacement } from "./setup";

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

/** One named character of a signup (#293), resolved by the server. */
export type SignupCharacter = {
    character: string;
    className: string;
    classColor: string;
    spec: string;
    specLabel: string;
    specIcon: string;
    role: GameRole | "";
    /** This character's own status (the Discord buttons move only the first); absent for an absence. */
    status?: SignupStatus;
};

/** An own signup, spec label and icon resolved by the server. */
export type OwnSignup = {
    /** Every named character in priority order; the fields below mirror the first. */
    characters: SignupCharacter[];
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

export type SignupEventBase = {
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
    /** The category's message with "Vielleicht" / "Absagen" (src/web/signupNotes.js); missing = optional. */
    noteMode?: "required" | "optional" | "none";
    /** The member's own wish partners who already signed up. */
    wishPartners: { userId: string; name: string }[];
    mine: OwnSignup | null;
    /** Where the approved setup puts the member (#263) — never a draft; null before an approval. */
    placement?: SetupPlacement | null;
};

export type SignupEventRow = RaidHelperSignupRow | OwnSignupRow;

export type SignupProfileSpec = { key: string; label: string; icon: string; role: GameRole | ""; gear: GearLevel };
export type SignupProfileCharacter = {
    key: string; name: string; className: string; main: boolean; specs: SignupProfileSpec[];
    /** This character's "kann offtanken / heilen" (signupView.profileForSignup). */
    canOfftank: boolean; canHeal: boolean;
};
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
    /**
     * Several own characters in priority order (#293): the first is the choice,
     * the rest "kann auch mit". Each may carry its own `status` (#320) — left
     * out, it takes the signup's, and the signup's own status mirrors the first
     * character's.
     */
    characters: { character: string; spec: string; status?: SignupStatus }[];
    status: SignupStatus;
    canAlso: GameRole[];
    comment: string;
};

/** One raid's answer to POST /api/signups/bulk (#293): saved, or refused with the reason. */
export type BulkSignupResult = {
    eventId: string;
    title: string;
    ok: boolean;
    error: string;
    code: string;
    /** Characters left out for this raid, each with why ("Klasse passt nicht zu diesem Raid"). */
    skipped: { character: string; spec: string; reason: string }[];
    /** the raid was full: the "Dabei" became the waiting list (#306) */
    waitlisted?: boolean;
    /** the German sentence that goes with it */
    notice?: string;
    signup: OwnSignup | null;
    counts: SignupCounts | null;
};

export function saveSignupsBulk(input: { eventIds: string[]; characters: { character: string; spec: string }[]; status: SignupStatus }): Promise<{ results: BulkSignupResult[] }> {
    return send("POST", "/api/signups/bulk", input);
}

/** One signup of an own event as the orga sees it (raid detail, GET /api/signups/event). */
export type EventSignupEntry = OwnSignup & { userId: string; name: string; at: number };

export function getSignups(): Promise<SignupsData> {
    return get<SignupsData>("/api/signups");
}

/** PUT /api/signups — plus what a full raid made of it (#306). */
export type SaveSignupResult = {
    signup: OwnSignup;
    counts: SignupCounts;
    /** the "Dabei" became the waiting list because the raid is full */
    waitlisted?: boolean;
    /** this signup closed the signup (lockAtLimit) */
    locked?: boolean;
    /** the German sentence the dialog shows under its confirmation */
    notice?: string;
};

export function saveSignup(input: SignupInput): Promise<SaveSignupResult> {
    return send("PUT", "/api/signups", input);
}

export function getEventSignups(eventId: string): Promise<{ eventId: string; counts: SignupCounts; signups: EventSignupEntry[] }> {
    return get(`/api/signups/event?id=${encodeURIComponent(eventId)}`);
}
