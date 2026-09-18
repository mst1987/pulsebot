// The pure rules behind the Raid-Vorlagen page (#266), kept apart from the
// components so test/web-client/raidTemplates.test.js can run them in plain Node.
//
// Written like settingsLogic.ts: every function is `export function name(params): Result {`
// on one line, and no body uses type syntax (no `as`, no generics, no annotated
// locals), so stripping the signature's annotations leaves valid JavaScript.
// The server holds the same rules for real (src/web/raidTemplates.js) — this
// copy only lets the modal say what is wrong before anybody presses Speichern.
import type { GameVersion, GameInstance, RaidTemplate, RaidTemplateInput, RoleRange } from "../api";

export type Proposal = { tank: number; healer: number };

export const MAX_SIZE = 40;

/** The rule set's fallback curve: 10 → 2/3, 20 → 2/5, 25 → 3/6, 40 → 4/10 (config/gameVersions defaultComposition). */
export function defaultComposition(size: number): Proposal {
    const n = Math.max(0, Math.floor(Number(size) || 0));
    if (n <= 1) return { tank: n, healer: 0 };
    if (n <= 5) return { tank: 1, healer: 1 };
    const tank = n <= 20 ? 2 : (n <= 25 ? 3 : 4);
    return { tank, healer: Math.min(Math.round(n / 4), n - tank) };
}

/** The instances of a version a template names, in its order; unknown ids are skipped. */
export function instancesOf(version: GameVersion | null | undefined, instanceIds: string[]): GameInstance[] {
    if (!version) return [];
    return version.instances.filter((i) => (instanceIds || []).includes(i.id));
}

/** The sizes the size segment offers: every allowed size of the chosen instances, ascending. */
export function allowedSizes(version: GameVersion | null | undefined, instanceIds: string[]): number[] {
    const sizes = [0];
    for (const inst of instancesOf(version, instanceIds)) {
        for (const s of inst.sizes) if (!sizes.includes(s)) sizes.push(s);
    }
    return sizes.filter((s) => s > 0).sort((a, b) => a - b);
}

/**
 * What a size change proposes: the stricter suggestion of the chosen
 * instances at that size (their own where they have one), else the default curve.
 */
export function proposeComposition(version: GameVersion | null | undefined, instanceIds: string[], size: number): Proposal {
    const insts = instancesOf(version, instanceIds);
    if (!insts.length) return defaultComposition(size);
    let tank = 0;
    let healer = 0;
    for (const inst of insts) {
        const own = inst.suggested && inst.suggested[String(size)];
        const c = own ? { tank: own.tanks, healer: own.healers } : defaultComposition(size);
        tank = Math.max(tank, c.tank);
        healer = Math.max(healer, c.healer);
    }
    return { tank, healer };
}

/** The places left for damage dealers — never negative. */
export function dpsSlots(size: number | null, tank: number, healer: number): number {
    if (!size) return 0;
    return Math.max(0, size - (tank || 0) - (healer || 0));
}

/** What is wrong with a melee/ranged range, "" when nothing (or no range). */
export function rangeProblem(label: string, range: RoleRange | null, limit: number): string {
    if (!range) return "";
    if (range.min < 0 || (range.max !== null && range.max < 0)) return `${label}: keine gültige Anzahl.`;
    if (range.max !== null && range.min > range.max) return `${label}: Minimum ist größer als Maximum.`;
    if (range.max !== null && range.max > limit) return `${label}: Maximum ist größer als die Größe ${limit}.`;
    return "";
}

/** The first problem of a draft as a German sentence, "" when it can be saved. Mirrors the server. */
export function validateDraft(t: RaidTemplateInput): string {
    if (!String(t.name || "").trim()) return "Name fehlt.";
    const size = t.size;
    if (size !== null && (size < 1 || size > MAX_SIZE)) return `Größe muss zwischen 1 und ${MAX_SIZE} liegen.`;
    const limit = size === null ? MAX_SIZE : size;
    const { tank, healer, melee, ranged } = t.composition;
    if (tank < 0 || healer < 0) return "Tanks und Heiler dürfen nicht negativ sein.";
    if (tank + healer > limit) return `Tanks + Heiler (${tank + healer}) passen nicht in die Größe ${limit}.`;
    const rangeError = rangeProblem("Nahkampf", melee, limit) || rangeProblem("Fernkampf", ranged, limit);
    if (rangeError) return rangeError;
    const minimums = tank + healer + (melee ? melee.min : 0) + (ranged ? ranged.min : 0);
    if (minimums > limit) return `Tanks, Heiler und die Nah-/Fernkampf-Minima (${minimums}) passen nicht in die Größe ${limit}.`;
    return "";
}

/** The small label under a template's name: "TBC · Standard für Donnerstag, Montag". */
export function templateLabel(t: RaidTemplate, versionShort: string, categoryNames: Record<string, string>): string {
    const parts = [versionShort || t.versionId];
    const cats = (t.defaultFor || []).map((id) => categoryNames[id] || id);
    if (cats.length) parts.push(`Standard für ${cats.join(", ")}`);
    return parts.join(" · ");
}

/** The templates of one version ("" = all), in the order the server sent them. */
export function filterByVersion(templates: RaidTemplate[], versionId: string): RaidTemplate[] {
    return versionId ? templates.filter((t) => t.versionId === versionId) : templates;
}

/** A fresh draft for "Vorlage": the first instance of the version at its default size, with its suggestion. */
export function newDraft(version: GameVersion | null | undefined): RaidTemplateInput {
    const first = version && version.instances.length ? version.instances[0] : null;
    const size = first ? first.defaultSize : 25;
    const ids = first ? [first.id] : [];
    const c = proposeComposition(version, ids, size);
    return {
        name: "", versionId: version ? version.id : "tbc", instanceIds: ids, size,
        composition: { tank: c.tank, healer: c.healer, melee: null, ranged: null },
        requiredBuffs: [], signupDeadline: null, fairness: false, wishes: false,
        overflow: "bench", lockAtLimit: false, raidhelperTemplateId: "",
    };
}

/** A stored template as an editable draft (without the list's badges). */
export function draftOf(t: RaidTemplate): RaidTemplateInput {
    return {
        id: t.id, name: t.name, versionId: t.versionId, instanceIds: [...(t.instanceIds || [])], size: t.size,
        composition: {
            tank: t.composition.tank, healer: t.composition.healer,
            melee: t.composition.melee || null, ranged: t.composition.ranged || null,
        },
        requiredBuffs: [...(t.requiredBuffs || [])], signupDeadline: t.signupDeadline || null,
        fairness: !!t.fairness, wishes: !!t.wishes,
        overflow: t.overflow === "off" ? "off" : "bench", lockAtLimit: !!t.lockAtLimit,
        raidhelperTemplateId: t.raidhelperTemplateId || "",
    };
}
