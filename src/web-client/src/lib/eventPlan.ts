// The pure rules behind the planning step of the "Event anlegen" dialog (#261):
// what an event's plan starts from (a raid template, a stored event, the rule
// set), what a size or instance change proposes, what is wrong with it, and
// what goes to the server — plus the channel name by the category's schema.
//
// Written strippable like lib/raidTemplates.ts (one-line signatures, no type
// syntax in bodies), so test/web-client/eventCreateDialog.test.js runs it in
// plain Node against the server's rules (eventStore.normalizePlan,
// utils/channelNames.renderChannelName).
import type { EmbedImage, EventPlanInput, EventSource, GameVersion, OwnEvent, RaidTemplate, RaidTemplateInput, RoleRange } from "../api";
import { allowedSizes, colorProblem, defaultComposition, imageProblem, instancesOf, proposeComposition } from "./raidTemplates";

export type EventPlan = {
    /** the raid template the plan started from, "" for none */
    raidTemplateId: string;
    versionId: string;
    instanceIds: string[];
    size: number;
    tank: number;
    healer: number;
    /** null = no target */
    melee: RoleRange | null;
    ranged: RoleRange | null;
    requiredBuffs: string[];
    /** how long the raid takes, in minutes (#305) */
    durationMinutes: number;
    /** hours before the start, 0 = no deadline */
    deadlineHours: number;
    fairness: boolean;
    wishes: boolean;
    autoSuggest: boolean;
    /** a full raid's new "Dabei" (#306): "bench" = waiting list, "off" = refused */
    overflow: "bench" | "off";
    /** close the signup by itself once the raid is full (#306) */
    lockAtLimit: boolean;
    /** the colour bar of the event message (#307), "" = the instance's own */
    color: string;
    /** the picture of the event message (#307), an empty url = the instance's boss icon */
    image: EmbedImage;
};

export type StepKey = "start" | "termin" | "raid" | "kanal" | "check";

export const PLAN_MAX_SIZE = 40;

// The duration of a raid (#305) — the same bounds the server checks
// (src/utils/eventTime.js).
export const PLAN_MIN_DURATION = 30;
export const PLAN_MAX_DURATION = 600;
export const PLAN_DEFAULT_DURATION = 180;

export const STEP_LABELS = { start: "Vorlage", termin: "Termin", raid: "Raid", kanal: "Kanal & Anmeldung", check: "Prüfen" };

/** What the two waiting-list switches say in one line, for the "Prüfen" step (#306). */
export function overflowLine(plan: EventPlan): string {
    const full = plan.overflow === "off" ? "voll: keine Anmeldung mehr" : "voll: Warteliste (Bank)";
    return plan.lockAtLimit ? `${full} · Anmeldung schließt bei Voll` : full;
}

/**
 * The steps the dialog walks: the planning step only for an EventHelper event,
 * the start step only when creating (an edit starts from the event itself).
 */
export function stepsFor(editing: boolean, source: EventSource): StepKey[] {
    if (editing) return source === "eventhelper" ? ["termin", "raid", "kanal", "check"] : ["termin", "kanal", "check"];
    return source === "eventhelper" ? ["start", "termin", "raid", "kanal", "check"] : ["start", "termin", "kanal", "check"];
}

/** The source a category's new events get: "eventhelper" where switched, else Raid-Helper. */
export function sourceOf(signupSources: Record<string, EventSource> | undefined, categoryId: string): EventSource {
    return signupSources && signupSources[categoryId] === "eventhelper" ? "eventhelper" : "raidhelper";
}

/** A stored picture field as the plan keeps it — an unknown mode reads as a thumbnail. */
export function lookImage(image: EmbedImage | null | undefined): EmbedImage {
    return { mode: (image && image.mode) === "banner" ? "banner" : "thumbnail", url: String((image && image.url) || "") };
}

/** A plan of a version without instances: 25 players, the default curve. */
export function emptyPlan(version: GameVersion | null | undefined): EventPlan {
    const c = defaultComposition(25);
    return {
        raidTemplateId: "", versionId: version ? version.id : "tbc", instanceIds: [], size: 25, tank: c.tank, healer: c.healer,
        melee: null, ranged: null, requiredBuffs: [], durationMinutes: PLAN_DEFAULT_DURATION,
        deadlineHours: 0, fairness: false, wishes: false, autoSuggest: false,
        overflow: "bench", lockAtLimit: false,
        color: "", image: { mode: "thumbnail", url: "" },
    };
}

/** What a raid template proposes; a template without size (migrated) gets its instances' default and suggestion. */
export function planFromTemplate(t: RaidTemplate, version: GameVersion | null | undefined): EventPlan {
    const insts = instancesOf(version, t.instanceIds || []);
    const size = t.size || (insts.length ? Math.max(...insts.map((i) => i.defaultSize)) : 25);
    const proposal = proposeComposition(version, t.instanceIds || [], size);
    const comp = t.composition || { tank: 0, healer: 0, melee: null, ranged: null };
    return {
        raidTemplateId: t.id, versionId: t.versionId, instanceIds: [...(t.instanceIds || [])], size,
        tank: t.size ? comp.tank : proposal.tank, healer: t.size ? comp.healer : proposal.healer,
        melee: comp.melee ? { min: comp.melee.min || 0, max: comp.melee.max ?? null } : null,
        ranged: comp.ranged ? { min: comp.ranged.min || 0, max: comp.ranged.max ?? null } : null,
        requiredBuffs: [...(t.requiredBuffs || [])],
        durationMinutes: t.durationMinutes || PLAN_DEFAULT_DURATION,
        deadlineHours: t.signupDeadline ? t.signupDeadline.hoursBefore : 0,
        fairness: !!t.fairness, wishes: !!t.wishes, autoSuggest: false,
        overflow: t.overflow === "off" ? "off" : "bench", lockAtLimit: !!t.lockAtLimit,
        // #307: the look travels with the template, as a copy.
        color: t.color || "", image: lookImage(t.image),
    };
}

/** A stored own event as an editable plan (the edit mode). */
export function planFromEvent(ev: OwnEvent): EventPlan {
    const comp = ev.composition || { tank: 0, healer: 0, melee: 0, ranged: 0 };
    const max = ev.compositionMax || { melee: null, ranged: null };
    const range = (min, top) => (min > 0 || (top !== null && top !== undefined) ? { min: min || 0, max: top ?? null } : null);
    return {
        raidTemplateId: ev.raidTemplateId || "", versionId: ev.versionId, instanceIds: [...(ev.instanceIds || [])], size: ev.size,
        tank: comp.tank, healer: comp.healer, melee: range(comp.melee, max.melee), ranged: range(comp.ranged, max.ranged),
        requiredBuffs: [...(ev.requiredBuffs || [])],
        durationMinutes: ev.durationMinutes || PLAN_DEFAULT_DURATION,
        deadlineHours: ev.signupDeadline ? Math.max(0, Math.round((ev.startTime - ev.signupDeadline) / 3600)) : 0,
        fairness: !!ev.fairness, wishes: !!ev.wishes, autoSuggest: !!ev.autoSuggest,
        overflow: ev.overflow === "off" ? "off" : "bench", lockAtLimit: !!ev.lockAtLimit,
        color: ev.color || "", image: lookImage(ev.image),
    };
}

/** A size change: the proposal of the chosen instances at that size, the rest kept. */
export function withSize(plan: EventPlan, version: GameVersion | null | undefined, size: number): EventPlan {
    const c = proposeComposition(version, plan.instanceIds, size);
    return { ...plan, size, tank: c.tank, healer: c.healer };
}

/**
 * Toggle an instance. An added instance that does not come in the current size
 * brings its own default size and proposal (Gruul to a Kara night → 25); a
 * removal that leaves no instance of the current size moves to the smallest
 * size left. Otherwise the numbers stay.
 */
export function withInstance(plan: EventPlan, version: GameVersion | null | undefined, id: string): EventPlan {
    const on = plan.instanceIds.includes(id);
    const instanceIds = on ? plan.instanceIds.filter((x) => x !== id) : [...plan.instanceIds, id];
    const added = !on && version ? version.instances.find((i) => i.id === id) : null;
    if (added) return added.sizes.includes(plan.size) ? { ...plan, instanceIds } : withSize({ ...plan, instanceIds }, version, added.defaultSize);
    const sizes = allowedSizes(version, instanceIds);
    if (!sizes.length || sizes.includes(plan.size)) return { ...plan, instanceIds };
    return withSize({ ...plan, instanceIds }, version, sizes[0]);
}

/** Another game version: instances and buffs do not carry over, the switches do. */
export function withVersion(plan: EventPlan, version: GameVersion | null | undefined): EventPlan {
    return {
        ...emptyPlan(version), raidTemplateId: plan.raidTemplateId, durationMinutes: plan.durationMinutes,
        deadlineHours: plan.deadlineHours, fairness: plan.fairness, wishes: plan.wishes, autoSuggest: plan.autoSuggest,
        overflow: plan.overflow, lockAtLimit: plan.lockAtLimit,
        // A hand-picked colour or picture is not tied to the instances, so it stays.
        color: plan.color, image: plan.image,
    };
}

/** The first problem of a plan as the server words it (eventStore.normalizePlan), "" when it can be sent. */
export function planProblem(plan: EventPlan): string {
    const size = plan.size;
    if (!size || size < 1 || Math.floor(size) !== size) return "Die Raidgröße muss eine positive Zahl sein.";
    if (size > PLAN_MAX_SIZE) return `Mehr als ${PLAN_MAX_SIZE} Spieler passen in keinen Raid.`;
    const mins = [plan.tank, plan.healer, plan.melee ? plan.melee.min : 0, plan.ranged ? plan.ranged.min : 0];
    if (mins.some((n) => !Number.isFinite(n) || n < 0)) return "Die Zusammensetzung braucht Zahlen ab 0.";
    const planned = mins.reduce((a, b) => a + b, 0);
    if (planned > size) return `Die Zusammensetzung (${planned}) ist größer als der Raid (${size}).`;
    // In the server's order (eventStore.normalizePlan): the ranges first, then
    // the duration — so the first problem is worded the same on both sides.
    const ranges = maxProblem("Nahkampf", plan.melee, size) || maxProblem("Fernkampf", plan.ranged, size);
    if (ranges) return ranges;
    const d = plan.durationMinutes;
    if (!Number.isFinite(d) || Math.floor(d) !== d || d < PLAN_MIN_DURATION || d > PLAN_MAX_DURATION) {
        return `Die Dauer muss zwischen ${PLAN_MIN_DURATION} und ${PLAN_MAX_DURATION} Minuten liegen.`;
    }
    const look = colorProblem(plan.color) || imageProblem(plan.image);
    if (look) return look;
    return "";
}

/** What is wrong with the maximum of a melee/ranged range, "" when nothing (or no maximum). */
export function maxProblem(label: string, range: RoleRange | null, size: number): string {
    if (!range || range.max === null || range.max === undefined) return "";
    if (range.max < 0) return `${label}: keine gültige Anzahl.`;
    if (range.max < range.min) return `${label}: Minimum ist größer als Maximum.`;
    if (range.max > size) return `${label}: Maximum ist größer als die Größe ${size}.`;
    return "";
}

/** The seats the minimums fill, for the "23 / 25 verplant" badge. */
export function plannedSeats(plan: EventPlan): number {
    return plan.tank + plan.healer + (plan.melee ? plan.melee.min : 0) + (plan.ranged ? plan.ranged.min : 0);
}

/** What POST/PATCH /api/raids get for the plan. */
export function planBody(plan: EventPlan): EventPlanInput {
    return {
        raidTemplateId: plan.raidTemplateId, versionId: plan.versionId, instanceIds: [...plan.instanceIds], size: plan.size,
        composition: { tank: plan.tank, healer: plan.healer, melee: plan.melee, ranged: plan.ranged },
        requiredBuffs: [...plan.requiredBuffs], durationMinutes: plan.durationMinutes, signupDeadlineHours: plan.deadlineHours,
        fairness: plan.fairness, wishes: plan.wishes, autoSuggest: plan.autoSuggest,
        overflow: plan.overflow, lockAtLimit: plan.lockAtLimit,
        color: plan.color, image: plan.image,
    };
}

/**
 * "Als Vorlage speichern": the plan as a raid template. With `base` it updates
 * that template (its id, name and Raid-Helper link stay unless a name is
 * given), without it a new one named `name`.
 */
export function templateFromPlan(plan: EventPlan, base: RaidTemplate | null, name: string): RaidTemplateInput {
    const out = {
        name: String(name || "").trim() || (base ? base.name : ""),
        versionId: plan.versionId, instanceIds: [...plan.instanceIds], size: plan.size,
        composition: { tank: plan.tank, healer: plan.healer, melee: plan.melee, ranged: plan.ranged },
        requiredBuffs: [...plan.requiredBuffs],
        signupDeadline: plan.deadlineHours > 0 ? { hoursBefore: plan.deadlineHours } : null,
        durationMinutes: plan.durationMinutes,
        fairness: plan.fairness, wishes: plan.wishes, overflow: plan.overflow, lockAtLimit: plan.lockAtLimit,
        color: plan.color, image: plan.image,
        raidhelperTemplateId: base ? base.raidhelperTemplateId || "" : "",
    };
    return base ? { ...out, id: base.id } : out;
}

/** "{raid}" of a channel name: the instances' short names in lower case, joined ("ssc-tk"); else the fallback. */
export function raidTag(version: GameVersion | null | undefined, instanceIds: string[], fallback: string): string {
    const shorts = instancesOf(version, instanceIds).map((i) => String(i.short || i.id).toLowerCase());
    return shorts.length ? shorts.join("-") : (fallback || "");
}

/**
 * A channel name by schema, Discord's rules applied — the twin of
 * renderChannelName() in src/utils/channelNames.js for the placeholders a new
 * event channel uses (date parts and raid; {name} and {nr} stay empty).
 */
export function schemaName(schema: string, isoDate: string, raid: string): string {
    const days = ["so", "mo", "di", "mi", "do", "fr", "sa"];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
    const day = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    const valid = !!day && day.getUTCDate() === Number(m && m[3]);
    const pad = (n) => String(n).padStart(2, "0");
    const values = {
        tag: valid ? days[day.getUTCDay()] : "",
        dd: valid ? pad(day.getUTCDate()) : "",
        mm: valid ? pad(day.getUTCMonth() + 1) : "",
        yy: valid ? String(day.getUTCFullYear()).slice(-2) : "",
        yyyy: valid ? String(day.getUTCFullYear()) : "",
        raid: String(raid || ""),
        name: "",
        nr: "",
    };
    const filled = String(schema || "{tag}-{dd}-{mm}-{raid}").replace(/\{(\w+)\}/g, (_, key) => values[key.toLowerCase()] ?? "");
    return filled
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[!-,./:-@[-^`{-~\p{Cc}]+/gu, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .slice(0, 100);
}
