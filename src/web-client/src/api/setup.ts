import { get, send } from "./client";
import type { SignupStatus } from "./raidDetail";
import type { GameRole } from "./raidTemplates";

// ---- Setup editor of an own event (#263) — src/web/setupEditor.js, apiRoutes/setup.js ----

export type SetupPlacement =
    | { group: number; character: string; spec: string; role: GameRole | "" }
    | { bench: true; character: string; spec: string; role: GameRole | "" };

/** A buff a raider brings: a party buff to their group (`count` = how many profit) or a raid buff to everyone. */
export type SetupBuff = { key: string; label: string; icon: string; scope: "party" | "raid"; count: number };

/** Attendance of one raider, counted per Discord account; `link` = how sure the character link is (manual = orga assignment or own profile, auto = guessed). */
export type SetupAttendance = {
    pct: number | null;
    attended: number;
    total: number;
    link: "manual" | "auto";
    inferred: number;
    missed: { eventId: string; title: string; startTime: number; reason: string }[];
    /** Start (unix seconds) of the last earlier night they signed up but stood on the bench; 0 = not in the `benchNights` nights looked at. */
    lastBench?: number;
    benchNights?: number;
};

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
    /** The place 1…5 in the group the orga put them on (a group of two may stand on 1 and 5). */
    pos?: number;
    /** The specs of their class — what the panel offers to put them into the setup as. */
    classSpecs?: { key: string; label: string; icon: string; role: GameRole }[];
    /** Why they are where they are — shown in the tooltip only. */
    reasons?: string[];
    brings?: SetupBuff[];
    /** Per other group index: how many would profit from what they bring there — drives the drag glow. */
    fit?: Record<string, number>;
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
    /** "Nicht zusammen" pairs among the signups — counts only, never names. */
    avoid?: { on: boolean; together: number; total: number };
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
    /** `avoid`: null/missing = the orga was never asked about "nicht zusammen". */
    options: { weights: SetupWeights; fairness: boolean | null; wishes: boolean | null; avoid?: boolean | null };
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
    /** By user id; only on the page load — the page keeps it across moves. */
    attendance?: Record<string, SetupAttendance>;
    signupCount?: number;
    absent?: number;
    /** How many "nicht zusammen" pairs stand among the signups — what the editor asks about. */
    avoidPairs?: number;
    defaults?: { weights: SetupWeights; maxWeight: number };
    hasApiKey?: boolean;
    /** The ping text sent with the posted setup — orga only, always the effective text (own or default, never empty). */
    pingText?: string;
    /** Raiders marked as an extra tank / healer (they play that role on some bosses), by user id. */
    extraRoles?: Record<string, string[]>;
    explainJob?: SetupJob;
    /** Only for the orga: where the approved setup goes and what came of it (#290). */
    publish?: SetupPublish;
    /** Only for the orga: what the raid still needs and the message that looks for it ("Suche"); null without a setup. */
    search?: SetupSearch | null;
    message?: string;
};

/** The classes and specs the setup still needs, and the draft of the message that looks for them. */
export type SetupSearch = {
    size: number;
    placed: number;
    open: number;
    roles: { role: GameRole; missing: number; specs: string[] }[];
    buffs: { key: string; label: string; icon: string; required: boolean; specs: string[] }[];
    /** By spec key, for EVERY spec of the rule set (the orga may add one to a role): what the page needs to draw it. */
    specInfo: Record<string, { label: string; classLabel: string; classId: string; icon: string; color: string }>;
    /** Role -> the keys of its specs. */
    roleSpecs: Record<string, string[]>;
    /** The message for the channel, English; "" when nothing is missing. */
    text: string;
};

/** The setup message in the event channel and its DMs (#290) — before approving what will happen, after it what did. */
export type SetupPublish = {
    channelId: string;
    channelName: string;
    cancelled: boolean;
    dmsEnabled: boolean;
    recipients: number;
    pendingDms: number;
    posted: { messageUrl: string; version: number; postedAt: number; editedAt: number } | null;
    outdated: boolean;
    error: string;
    errorAt: number;
    dms: {
        status: "running" | "done";
        version: number;
        at: number;
        total: number;
        sent: number;
        failed: { userId: string; character: string; error: string }[];
        unchanged: number;
    } | null;
};

export function publishRaidSetup(csrfToken: string | null, eventId: string): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/post", csrfToken, { event: eventId });
}

/** The message for needs the orga edited — nothing is posted. */
export function previewRaidSearch(csrfToken: string | null, eventId: string, needs: { roles: { role: string; missing: number; specs: string[] }[]; buffs: { key: string; required: boolean; specs: string[] }[] }): Promise<{ text: string }> {
    return send("POST", "/api/raids/setup/search/text", csrfToken, { event: eventId, roles: needs.roles, buffs: needs.buffs });
}

/** Post the "we are looking for …" message into the event channel; `text` = the edited message. */
export function postRaidSearch(csrfToken: string | null, eventId: string, text: string): Promise<{ message: string; url?: string }> {
    return send("POST", "/api/raids/setup/search", csrfToken, { event: eventId, text });
}

/** Save the ping text sent when the setup is posted; "" clears it back to the default. */
export function saveSetupPingText(csrfToken: string | null, eventId: string, text: string): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/ping-text", csrfToken, { event: eventId, text });
}

/** Mark a raider as an extra tank / healer (`on`), or take the mark away; not part of the setup, a new proposal keeps it. */
export function saveSetupExtraRole(csrfToken: string | null, eventId: string, userId: string, role: "tank" | "healer", on: boolean): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/extra-role", csrfToken, { event: eventId, userId, role, on });
}

/** What PUT /api/raids/setup takes: who stands where, and what is locked. */
export type SetupPlacementInput = {
    version: number;
    /** `character`: which of the raider's named characters (#293) plays the spec. */
    groups: { index: number; slots: { userId: string; character?: string; spec: string; role: string; locked: boolean; pos?: number }[] }[];
    bench: { userId: string; locked: boolean }[];
    fairness?: boolean;
    wishes?: boolean;
    avoid?: boolean;
    weights?: SetupWeights;
};

export function getRaidSetup(eventId: string): Promise<SetupEditorData> {
    return get(`/api/raids/setup?event=${encodeURIComponent(eventId)}`);
}

export function proposeRaidSetup(csrfToken: string | null, eventId: string, options: { weights?: SetupWeights; fairness?: boolean; wishes?: boolean; avoid?: boolean } = {}): Promise<SetupEditorData> {
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
