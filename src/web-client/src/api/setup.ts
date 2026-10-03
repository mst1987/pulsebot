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
    /** only who the orga put on the bench (#517) */
    bench: SetupPerson[];
    /** "Angemeldet" (#517): signed up, neither placed nor benched — derived by the server, never sent back, never posted */
    pool?: SetupPerson[];
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
    /** Orga only: Confirm/Cancel of the raiders placed in a group, by user id — their own clicks and the orga's marks. */
    confirmations?: Record<string, SetupConfirmation>;
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
    /** "Bench mitposten" (#517): the last choice for this event, off by default */
    bench?: boolean;
    benchCount?: number;
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

/** Post or update the approved setup; `bench` = "Bench mitposten" (#517), remembered for the event. */
export function publishRaidSetup(eventId: string, opts: { bench?: boolean; version?: number } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/post", { event: eventId, ...opts });
}

/** The message for needs the orga edited — nothing is posted. */
export function previewRaidSearch(eventId: string, needs: { roles: { role: string; missing: number; specs: string[] }[]; buffs: { key: string; required: boolean; specs: string[] }[] }): Promise<{ text: string }> {
    return send("POST", "/api/raids/setup/search/text", { event: eventId, roles: needs.roles, buffs: needs.buffs });
}

/** Post the "we are looking for …" message into the event channel; `text` = the edited message. */
export function postRaidSearch(eventId: string, text: string): Promise<{ message: string; url?: string }> {
    return send("POST", "/api/raids/setup/search", { event: eventId, text });
}

/** A raider's answer under the setup message: Confirm or Cancel. */
export type SetupConfirmation = "confirmed" | "declined";

/** The confirmations after an orga mark — answered at once, the Discord message follows a moment later. */
export type SetupConfirmationsAnswer = { confirmations: Record<string, SetupConfirmation>; count?: number };

/** The orga sets (or with "" clears) a raider's Confirm/Cancel. */
export function setSetupConfirmation(eventId: string, userId: string, status: SetupConfirmation | ""): Promise<SetupConfirmationsAnswer> {
    return send("POST", "/api/raids/setup/confirm", { event: eventId, userId, status });
}

/** "Alle bestätigen": the check for everybody in a group without an answer (a "Cancel" stays). */
export function confirmAllSetup(eventId: string): Promise<SetupConfirmationsAnswer> {
    return send("POST", "/api/raids/setup/confirm-all", { event: eventId });
}

/** Save the ping text sent when the setup is posted; "" clears it back to the default. */
export function saveSetupPingText(eventId: string, text: string): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/ping-text", { event: eventId, text });
}

/** Mark a raider as an extra tank / healer (`on`), or take the mark away; not part of the setup, a new proposal keeps it. */
export function saveSetupExtraRole(eventId: string, userId: string, role: "tank" | "healer", on: boolean): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/extra-role", { event: eventId, userId, role, on });
}

/** A spec the orga may give a character (#521): every spec of its class, `inProfile` = the raider's profile lists it. */
export type SetupSignupSpec = { key: string; label: string; icon: string; role: GameRole; inProfile: boolean; gear: string };

/** A character the orga may put a raider's signup on: the profile's, or one the signup already names (`inProfile: false`). */
export type SetupSignupOption = {
    character: string;
    key: string;
    classId: string;
    classLabel: string;
    classColor: string;
    classIcon: string;
    inProfile: boolean;
    specs: SetupSignupSpec[];
};

/** GET /api/raids/setup/signup: one raider's signup and what the orga may change it to. */
export type SetupSignupEdit = {
    userId: string;
    status: SignupStatus;
    characters: { character: string; spec: string; status: string }[];
    statuses: SignupStatus[];
    options: SetupSignupOption[];
};

/** PUT /api/raids/setup/signup: `from` = the character the setup shows, the one `character`/`spec` replace. */
export type SetupSignupInput = { userId: string; status: SignupStatus; from?: string; character?: string; spec?: string };

export function getSetupSignup(eventId: string, userId: string): Promise<SetupSignupEdit> {
    return get(`/api/raids/setup/signup?event=${encodeURIComponent(eventId)}&user=${encodeURIComponent(userId)}`);
}

/** Change a raider's signup as the orga — the answer is the editor's payload, the setup already following. */
export function saveSetupSignup(eventId: string, input: SetupSignupInput): Promise<SetupEditorData & { warning?: string }> {
    return send("PUT", "/api/raids/setup/signup", { event: eventId, ...input });
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

export function proposeRaidSetup(eventId: string, options: { weights?: SetupWeights; fairness?: boolean; wishes?: boolean; avoid?: boolean } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/propose", { event: eventId, ...options });
}

export function saveRaidSetup(eventId: string, input: SetupPlacementInput): Promise<SetupEditorData> {
    return send("PUT", "/api/raids/setup", { event: eventId, ...input });
}

/** Approve the shown version — the approval posts the setup, with the bench when `bench` (#517). */
export function approveRaidSetup(eventId: string, version: number, opts: { bench?: boolean } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/approve", { event: eventId, version, ...opts });
}

export function explainRaidSetup(eventId: string): Promise<{ eventId: string; status: string; alreadyRunning: boolean }> {
    return send("POST", "/api/raids/setup/explain", { event: eventId });
}

export function getRaidSetupExplain(eventId: string): Promise<{ eventId: string; job: SetupJob; explanation: StoredSetup["explanation"]; version: number }> {
    return get(`/api/raids/setup/explain?event=${encodeURIComponent(eventId)}`);
}
