// The pure rules behind the Raid-Vorlagen page (#266), kept apart from the
// components so test/web-client/raidTemplates.test.js can run them in plain Node.
//
// Written like settingsLogic.ts: every function is `export function name(params): Result {`
// on one line, and no body uses type syntax (no `as`, no generics, no annotated
// locals), so stripping the signature's annotations leaves valid JavaScript.
// The server holds the same rules for real (src/web/raidTemplates.js) — this
// copy only lets the modal say what is wrong before anybody presses Speichern.
import type { EmbedImage, GameVersion, GameInstance, RaidTemplate, RaidTemplateInput, RoleRange } from "../api";

export type Proposal = { tank: number; healer: number };

export const MAX_SIZE = 40;
/** The longest picture URL the server stores (#307, embedLook.MAX_URL). */
export const MAX_IMAGE_URL = 500;
/** The colour an embed falls back to when neither the event nor the instance has one (variables.embedAccentColor). */
export const EMBED_ACCENT = "#8a7cff";

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

// ---- Aussehen (#307) --------------------------------------------------------
// The colour bar and the picture of the bot's event message. The wording of
// every sentence here is the server's (src/web/embedLook.js); the test runs
// both against the same cases.

/** What is wrong with a colour field, "" when it is fine (empty = the rule set's colour). */
export function colorProblem(raw: string): string {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    const hex = s.startsWith("#") ? s : `#${s}`;
    return /^#[0-9a-f]{6}$/.test(hex) ? "" : "Die Farbe muss als #rrggbb angegeben werden, z. B. #8a7cff.";
}

/** Whether a picture URL is one Discord may load: absolute, https, with a host. */
export function usableImageUrl(raw: string): boolean {
    const s = String(raw || "").trim();
    if (!s || s.length > MAX_IMAGE_URL) return false;
    try {
        const url = new URL(s);
        return url.protocol === "https:" && !!url.hostname;
    } catch {
        return false;
    }
}

/** What is wrong with a picture field, "" when it is fine (no url = the instance's boss icon). */
export function imageProblem(image: EmbedImage | null | undefined): string {
    const mode = image ? image.mode : "";
    const url = String((image && image.url) || "").trim();
    if (mode && mode !== "thumbnail" && mode !== "banner") return "Das Bild muss „thumbnail“ oder „banner“ sein.";
    if (!url) return "";
    if (url.length > MAX_IMAGE_URL) return `Die Bild-Adresse darf höchstens ${MAX_IMAGE_URL} Zeichen lang sein.`;
    return usableImageUrl(url) ? "" : "Die Bild-Adresse muss mit https:// beginnen.";
}

/**
 * The instance that gives an evening its look: the biggest of the night, ties
 * going to the one named first — the server's rule (embedLook.leadInstance).
 */
export function leadInstance(version: GameVersion | null | undefined, instanceIds: string[]): GameInstance | null {
    const ids = instanceIds || [];
    // In the order the plan names them, not the rule set's — "the one named
    // first" is only the same answer when both sides walk the same list.
    const insts = instancesOf(version, ids).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (!insts.length) return null;
    let best = insts[0];
    for (const i of insts) if (i.defaultSize > best.defaultSize) best = i;
    return best;
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
    const look = colorProblem(t.color || "") || imageProblem(t.image);
    if (look) return look;
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
        requiredBuffs: [], signupDeadline: null, durationMinutes: null, fairness: false, wishes: false,
        overflow: "bench", lockAtLimit: false, raidhelperTemplateId: "",
        // #307: nothing of its own — the instance's colour and boss icon.
        color: "", image: { mode: "thumbnail", url: "" },
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
        durationMinutes: t.durationMinutes ?? null,
        fairness: !!t.fairness, wishes: !!t.wishes,
        overflow: t.overflow === "off" ? "off" : "bench", lockAtLimit: !!t.lockAtLimit,
        color: t.color || "",
        image: { mode: (t.image && t.image.mode) === "banner" ? "banner" : "thumbnail", url: (t.image && t.image.url) || "" },
        raidhelperTemplateId: t.raidhelperTemplateId || "",
    };
}
