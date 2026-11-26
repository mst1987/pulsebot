// "Funktionen je Version" (#761) on the client: the matrix the server sends with
// GET /api/settings (`versionCapabilities`, src/services/versions/versionCapabilities.js)
// and the page draft's switches. The server decides what is POSSIBLE (data,
// rules, settings); the page only switches a possible feature on or off, saved
// as `versionSettings[<id>].disabled` with the save bar. The feature list is the
// server's - the client keeps no copy of it.
import type { VersionSettingsBlock } from "./versionLinks";

/** One cell of the matrix as the server computed it from the saved settings. */
export type FeatureCell = {
    possible: boolean;
    /** not switched off in the saved settings */
    enabled: boolean;
    on: boolean;
    /** "" when on, "disabled" when switched off, else why it is not possible */
    reason: string;
    /** the server's German text for the reason */
    message: string;
    /** what a log rule set still lacks (logcheck) */
    missing: string[];
    /** further reasons beside `reason` (logcheck: rules not ready AND no Warcraft-Logs site) */
    also?: string[];
};

export type CapabilityMatrix = {
    features: string[];
    versions: Record<string, Record<string, FeatureCell>>;
};

export type CellState = "on" | "off" | "impossible";

/** The stored lists of the features switched off, per version (missing = none). */
export function disabledFromConfig(versionSettings?: Record<string, { disabled?: string[] } | undefined>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, block] of Object.entries(versionSettings || {})) {
        out[id] = Array.isArray(block?.disabled) ? [...block.disabled] : [];
    }
    return out;
}

/** What a cell shows with the draft's list: on / off where possible, else "nicht möglich". */
export function cellState(cell: FeatureCell | undefined, feature: string, disabled: string[] = []): CellState {
    if (!cell || !cell.possible) return "impossible";
    return disabled.includes(feature) ? "off" : "on";
}

/**
 * Whether a feature is on for at least one version with the draft's lists (false without a matrix).
 * `shown`: only these versions count (default every one), see shownVersions().
 */
export function featureOnAnywhere(matrix: CapabilityMatrix | undefined, feature: string, disabled: Record<string, string[]> = {}, shown?: string[]): boolean {
    return Object.entries(matrix?.versions || {})
        .filter(([id]) => !shown || shown.includes(id))
        .some(([id, cells]) => cellState(cells[feature], feature, disabled[id]) === "on");
}

/**
 * The versions a list shows with the draft (server: mainVersion.visibleVersions): every column of the
 * matrix, or only the main version while "Andere Versionen ausblenden" is on.
 */
export function shownVersions(matrix: CapabilityMatrix | undefined, mainVersion: string, hideOthers: boolean): string[] {
    const ids = Object.keys(matrix?.versions || {});
    return hideOthers ? ids.filter((id) => id === mainVersion) : ids;
}

/**
 * Whether a feature is on for no shown version with the draft (the hint of Einstellungen → Dungeon-Bestzeiten);
 * false without a matrix, so nothing is claimed before it loaded.
 */
export function featureOffInDraft(
    matrix: CapabilityMatrix | undefined,
    feature: string,
    draft: { versionDisabled: Record<string, string[]>; mainVersion: string; hideOtherVersions: boolean },
): boolean {
    if (!matrix) return false;
    return !featureOnAnywhere(matrix, feature, draft.versionDisabled, shownVersions(matrix, draft.mainVersion, draft.hideOtherVersions));
}

/** The list with one feature switched on (taken out) or off (put in), in the matrix order. */
export function setFeature(disabled: string[], feature: string, on: boolean, order: string[]): string[] {
    const next = new Set(disabled);
    if (on) next.delete(feature); else next.add(feature);
    const known = order.filter((f) => next.has(f));
    // keep an id the matrix does not list (a feature of a newer server) where it was
    return [...known, ...[...next].filter((f) => !order.includes(f))];
}

/** The versions whose list differs between the saved and the draft state (order does not count). */
export function changedFeatureVersions(saved: Record<string, string[]> = {}, draft: Record<string, string[]> = {}): string[] {
    const key = (list?: string[]) => [...(list || [])].sort().join(",");
    return [...new Set([...Object.keys(saved), ...Object.keys(draft)])].filter((id) => key(saved[id]) !== key(draft[id]));
}

/** Every version's block with its list, as the save bar sends them (the server merges per version, the list whole). */
export function withDisabled(
    blocks: Record<string, VersionSettingsBlock>,
    disabled: Record<string, string[]>,
): Record<string, VersionSettingsBlock & { disabled: string[] }> {
    const out: Record<string, VersionSettingsBlock & { disabled: string[] }> = {};
    for (const [id, block] of Object.entries(blocks)) out[id] = { ...block, disabled: disabled[id] || [] };
    return out;
}

/** The i18n keys of why a cell is not possible (or off), first reason first. */
export function reasonKeys(cell: FeatureCell | undefined, state: CellState): string[] {
    if (state === "off") return ["settings.versionFeatures.reason.disabled"];
    if (!cell || state === "on") return [];
    return [cell.reason, ...(cell.also || [])].filter(Boolean).map((r) => `settings.versionFeatures.reason.${r}`);
}
