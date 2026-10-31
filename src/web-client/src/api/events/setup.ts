import { get, send } from "../client";
import type { SignupStatus } from "./raidDetail";
import type { GameRole } from "./raidTemplates";
import type { VermerkShortMap } from "../roster/vermerke";
import type { LeadersView } from "../roster/leaders";

// ---- Setup editor of an own event (#263) — src/web/setupEditor.js, apiRoutes/events/setup.js ----

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

/** One instance per raid ID: the character stands in a group of another raid of this instance and ID - details only for a raid of this server. */
/** `source`: not placed in a setup here but seen in a log or with loot of the instance (title = the instance). */
export type SetupRaidIdTaken = { local?: boolean; title?: string; raidNo?: number; startTime?: number; other?: boolean; source?: "log" | "loot" };

/** One character a raider signed up with (#293), decorated like a slot; `priority` 0 = their choice, then "kann auch mit"; its own status (#320). */
export type SetupCharacter = {
    character: string;
    spec: string;
    role: GameRole | "";
    status: SignupStatus | "";
    priority: number;
    classId: string;
    classColor: string;
    classLabel: string;
    specLabel: string;
    specIcon: string;
    raidIdTaken?: SetupRaidIdTaken;
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
    /** Every character they signed up with, in their order — only for somebody with more than one (#293). */
    characters?: SetupCharacter[];
    /** #1036: leads this raid — exactly one slot per raid of the proposal carries it. */
    leader?: boolean;
    /** #1037: why loot put them into this raid — the client says it in its own language. */
    lootReason?: SetupLootReason;
    /** Already placed in another raid of this instance and raid ID (a hint, never a block). */
    raidIdTaken?: SetupRaidIdTaken;
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
    /**
     * #1036: the raid's leader — only when the event has a leader rule. `count` = leaders in the groups,
     * `candidates` = user ids with a leader flag for the raid's version and instance.
     */
    leader?: { count: number; ok: boolean; candidates: string[] };
    /** #1037 "Loot verteilen": only for parallel raids with loaded loot data and the weight above 0. */
    loot?: SetupLootCheck;
};

/** Who wants a listed item in one raid (#1037), with where the wish comes from. */
export type SetupLootRaid = {
    eventId: string;
    title: string;
    raiders: { userId: string; character: string; source: "softres" | "bis" | "" }[];
};

/**
 * A real item (Softres, BiS minus gear) more than one placed raider wants in the same raid (#1037).
 * `conflictIn` = those raids, `raids` = every raid it is wanted in. Spec overlaps only weigh in the
 * proposal and are never listed.
 */
export type SetupLootItem = {
    itemId: number;
    name: string;
    icon: string;
    quality: number | null;
    count: number;
    eventIds: string[];
    conflictIn: string[];
    raids: SetupLootRaid[];
};

/** A placed raider's loot reason (#1037), for the page's language; `text` is the German one in `reasons`. */
export type SetupLootReason =
    | { kind: "only"; text: string; item: string }
    | { kind: "raid"; text: string; item: string; raid: string; other: string }
    | { kind: "spec"; text: string; raid: string; other: string };

export type SetupLootCheck = {
    on: boolean;
    /** the number of listed items */
    conflicts: number;
    items: SetupLootItem[];
    /** how many placed raiders each source covers */
    sources: { softres: number; bis: number; spec: number; none: number };
};

/** "Loot-Daten laden" of a raid group (#1037): the job, the armory progress while it runs, what is stored. */
export type SetupLootStatus = {
    /**
     * `error: "failed_all"`: no source answered - `failed` names them, `hadPrevious` says whether
     * the old data stayed; the editor builds the sentence (setup.loot.failedAll*)
     */
    job: (NonNullable<SetupJob> & { runningMs?: number; failed?: string[]; hadPrevious?: boolean }) | null;
    progress: { done: number; total: number } | null;
    counts: { signups: number; gear: number; softres: number; bis: number; spec: number } | null;
    /** when the stored data was gathered (ms), 0 = never */
    at: number;
    /** the sources the last load could not reach (softres, armory, logs, all) */
    failed?: string[];
    /** when the older data that stayed in place was gathered (ms), 0 = nothing kept */
    keptAt?: number;
    /** the Wowhead section of the raid's version, "" = no item links */
    wowheadPath?: string;
};

export type SetupWeights = Record<string, number>;

export type StoredSetup = {
    status: "draft" | "approved";
    version: number;
    /** "auto" = drafted at the signup deadline without anybody asking (eventStore.saveSetupDraft). */
    origin: "proposal" | "manual" | "auto";
    /** the empty start before anything is stored (version 0): every signup under "Angemeldet", no proposal needed */
    blank?: boolean;
    groups: SetupEditorGroup[];
    /** only who the orga put on the bench (#517) */
    bench: SetupPerson[];
    /** "Angemeldet" (#517): signed up, neither placed nor benched — derived by the server, never sent back, never posted */
    pool?: SetupPerson[];
    checks: SetupChecks;
    /** #1036: the leader the orga chose ("Als Leader setzen") — kept by "Neu vorschlagen" and "Freie Plätze füllen". */
    leaderUserId?: string;
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
    /**
     * May change the event itself (PATCH /api/raids — "Mehr → Raidgröße"): the global orga; the orga
     * of a category edits the setup but not yet the event (#725, opens with #728). Missing = no.
     */
    canEditEvent?: boolean;
    approved: ApprovedSetup | null;
    /** Only for the orga (raids write) — a reader never receives the draft. */
    setup?: StoredSetup | null;
    groupCount?: number;
    /** By user id; only on the page load — the page keeps it across moves. */
    attendance?: Record<string, SetupAttendance>;
    signupCount?: number;
    /**
     * #1035: how many raids in total the signups fill — ceil(signups / size), at most 8, then one less while they
     * would fill a raid below SPLIT_MIN_FILL (70 %): 26 for a 25-man → 1, 35 → 2, 53 → 3. 0 without signups.
     * Only a total above the existing raids is offered as a split; adding raids by hand always works.
     */
    suggestedTotal?: number;
    absent?: number;
    /** The characters of those signed off — shown on demand under "Angemeldet". */
    absentNames?: string[];
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
    /** The raids of the event's raid group (#811) — the editor's tabs "Raid 1 | Raid 2"; null outside a group. */
    raidGroup?: RaidGroup | null;
    /** Orga only (#811): how many signed-up raiders the other raids of the group hold (left out of "Angemeldet"). */
    placedElsewhere?: number;
    /** Vermerke (#981): the short form by user id - only for a caller past maySeeShort, never a raider's view. */
    vermerke?: VermerkShortMap;
    /** Vermerke (#981): the persons with a shadowban among "Angemeldet" (the pool) - same gate as `vermerke`. */
    shadowbanInPool?: { userId: string; name: string }[];
    /** Orga only (#1034): the raid's version, its instances and who of the raid leads which of them. */
    leaders?: LeadersView;
    /** Orga only (#1037): "Loot-Daten laden" of the raid group; null for a single raid. */
    loot?: SetupLootStatus | null;
    message?: string;
};

/** One raid of a raid group (#811) as the tabs, the raid detail and the raid list draw it. */
export type RaidGroupRaid = {
    id: string;
    title: string;
    /** 1 = the first raid, where the raiders sign up; 2, 3 … the further raids. */
    index: number;
    size: number;
    placed: number;
    status: "none" | "draft" | "approved";
    approved: boolean;
    posted: boolean;
    cancelled: boolean;
};

/** A raid group (#811): further raids at the same time that share the first raid's signup. */
export type RaidGroup = {
    id: string;
    primaryId: string;
    count: number;
    /** The places of every raid together ("2 Raids · 20 Plätze"). */
    places: number;
    raids: RaidGroupRaid[];
};

/**
 * "Weiteren Raid hinzufügen" (#811): a further raid of the event's group; `title` empty = "<Titel> 2".
 * `count` > 1 (#1035) makes that many at once, titled "<Titel> n" (`events` = their ids, `event` the first).
 */
export function addGroupRaid(eventId: string, title = "", count = 1): Promise<{ event: string; events?: string[]; title: string; raidGroup: RaidGroup | null; message: string }> {
    return send("POST", "/api/raids/setup/raid-add", count > 1 ? { event: eventId, count } : { event: eventId, title });
}

/** Dissolve a further raid without an approved setup (#811): its raiders fall back into "Angemeldet". */
export function removeGroupRaid(eventId: string): Promise<{ event: string; raidGroup: RaidGroup | null; message: string }> {
    return send("POST", "/api/raids/setup/raid-remove", { event: eventId });
}

/** A raider of this raid (group, bench or "Angemeldet") into another raid of its group (#811) — the answer is this raid's payload. */
export function moveToGroupRaid(eventId: string, target: string, userId: string, character?: string): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/move-raid", { event: eventId, target, userId, ...(character ? { character } : {}) });
}

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
    /** the category's default — the editor's switch differs from it only by choice */
    dmsDefault?: boolean;
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
export function publishRaidSetup(eventId: string, opts: { bench?: boolean; dms?: boolean; version?: number } = {}): Promise<SetupEditorData> {
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

/** "Alle pingen" of a posted setup: who would be pinged and with what (nothing is posted). */
export function previewSetupPing(eventId: string): Promise<{ count: number; text: string }> {
    return send("POST", "/api/raids/setup/ping", { event: eventId, dryRun: true });
}

/** "Alle pingen": everybody in the groups of the posted setup, in the event channel, with the ping text. */
export function pingSetup(eventId: string): Promise<{ message: string; count: number; url: string }> {
    return send("POST", "/api/raids/setup/ping", { event: eventId });
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
    /** "Anderer Charakter …": every class of the event's rule set with its specs. */
    classes: SetupSignupClass[];
};

/** A class of the event's rule set, for a character the orga names by hand. */
export type SetupSignupClass = { id: string; label: string; color: string; icon: string; specs: { key: string; label: string; icon: string; role: GameRole }[] };

/**
 * PUT /api/raids/setup/signup: `from` = the character the setup shows, the one `character`/`spec` replace.
 * With `className` the orga names another character (a name outside the profile) of that class.
 */
export type SetupSignupInput = { userId: string; status: SignupStatus; from?: string; character?: string; spec?: string; className?: string };

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
    /** `character`: which of the raider's named characters waits on the bench (#293). */
    bench: { userId: string; character?: string; locked: boolean }[];
    fairness?: boolean;
    wishes?: boolean;
    avoid?: boolean;
    weights?: SetupWeights;
    /** #1036 "Als Leader setzen": the orga's choice of the raid's leader ("" clears it); missing = keep it. */
    leaderUserId?: string;
};

/** `light`: what an open editor fetches after somebody else changed the setup — no Discord names, no attendance (the page keeps its own). */
export function getRaidSetup(eventId: string, { light = false }: { light?: boolean } = {}): Promise<SetupEditorData> {
    return get(`/api/raids/setup?event=${encodeURIComponent(eventId)}${light ? "&light=1" : ""}`);
}

/** What an orga member in the setup editor holds right now: a raider dragged or picked, or one whose signup they edit. */
export type SetupPresenceAction = { kind: "drag" | "edit"; userId: string };

/**
 * Somebody else in the same setup editor (services/setup/setupPresence.js); `avatarUrl` is their Discord picture,
 * "" (or missing from an older server) = the initials.
 */
export type SetupPresenceEditor = { userId: string; name: string; action: SetupPresenceAction | null; avatarUrl?: string };

/** One line of "Gerade eben": who changed what. */
export type SetupActivity = {
    id: number;
    at: number;
    by: string;
    byName: string;
    kind: "move" | "many" | "fill" | "propose" | "post";
    userId?: string;
    character?: string;
    to?: { group?: number; bench?: boolean; pool?: boolean };
    count?: number;
    userIds?: string[];
};

/** `confirmations`: the Confirm/Cancel marks as stored — a raider's click in Discord changes no version. */
export type SetupPresenceAnswer = { editors: SetupPresenceEditor[]; version: number; confirmations?: Record<string, SetupConfirmation>; activity: SetupActivity[] };

/** The open editor's heartbeat: who else is in it, the stored version and marks, what changed after `since`. */
export function setupPresence(eventId: string, body: { action?: SetupPresenceAction | null; since?: number }): Promise<SetupPresenceAnswer> {
    return send("POST", "/api/raids/setup/presence", { event: eventId, ...body });
}

/** The editor closes: gone for the others at once. */
export function leaveSetupPresence(eventId: string): Promise<{ left: boolean }> {
    return send("POST", "/api/raids/setup/presence", { event: eventId, leave: true });
}

export function proposeRaidSetup(eventId: string, options: { weights?: SetupWeights; fairness?: boolean; wishes?: boolean; avoid?: boolean; keep?: "placed" } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/propose", { event: eventId, ...options });
}

/**
 * "Loot-Daten laden" (#1037): starts the background job of the raid group (no route of its own:
 * `loadLoot` on the propose POST). Proposes nothing; the editor polls GET and proposes when it is done.
 */
export function loadSetupLoot(eventId: string): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/propose", { event: eventId, loadLoot: true });
}

export function saveRaidSetup(eventId: string, input: SetupPlacementInput): Promise<SetupEditorData> {
    return send("PUT", "/api/raids/setup", { event: eventId, ...input });
}

/** Approve the shown version — the approval posts the setup, with the bench when `bench` (#517). */
export function approveRaidSetup(eventId: string, version: number, opts: { bench?: boolean; dms?: boolean } = {}): Promise<SetupEditorData> {
    return send("POST", "/api/raids/setup/approve", { event: eventId, version, ...opts });
}

export function explainRaidSetup(eventId: string): Promise<{ eventId: string; status: string; alreadyRunning: boolean }> {
    return send("POST", "/api/raids/setup/explain", { event: eventId });
}

export function getRaidSetupExplain(eventId: string): Promise<{ eventId: string; job: SetupJob; explanation: StoredSetup["explanation"]; version: number }> {
    return get(`/api/raids/setup/explain?event=${encodeURIComponent(eventId)}`);
}
