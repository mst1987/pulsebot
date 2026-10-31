// Settings per game version on the client (#542): the block the server keeps
// in config.versionSettings (src/stores/settings/versionSettingsSchema.js) and the
// links built from it. The same rules as the server's helper
// (src/services/versions/versionSettings.js): an empty setting means "not there
// for this version", and the link is left out rather than guessed or broken.
import { createContext, createElement, useContext, type ReactNode } from "react";
import { LEGACY_WOWHEAD_PATH, wowheadItemUrl } from "../wow/wowheadItems";

export type VersionSettingsBlock = {
    blizzardRegion: string;
    blizzardRealmSlug: string;
    blizzardNamespace: string;
    armoryUrlTemplate: string;
    wclUrlTemplate: string;
    wowheadPath: string;
    softresEdition: string;
    raidsheetId: string;
    /** The version's colour in the web admin, "#rrggbb" (#742); "" = the rule set's. */
    color: string;
};

export const VERSION_SETTING_FIELDS: (keyof VersionSettingsBlock)[] = [
    "blizzardRegion", "blizzardRealmSlug", "blizzardNamespace",
    "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath", "softresEdition", "raidsheetId", "color",
];

export const BLIZZARD_REGIONS = ["eu", "us", "kr", "tw"];
export const SOFTRES_EDITIONS = ["classic", "tbc", "wotlk"];

export function emptyBlock(): VersionSettingsBlock {
    return {
        blizzardRegion: "", blizzardRealmSlug: "", blizzardNamespace: "", armoryUrlTemplate: "",
        wclUrlTemplate: "", wowheadPath: "", softresEdition: "", raidsheetId: "", color: "",
    };
}

/** A stored block with every field present (a missing one is ""). */
export function blockOf(raw: Partial<VersionSettingsBlock> | undefined): VersionSettingsBlock {
    const out = emptyBlock();
    for (const key of VERSION_SETTING_FIELDS) out[key] = String((raw && raw[key]) || "");
    return out;
}

/** An http(s) address that parses — the client's copy of the link check (#539). */
export function isWebLink(url: string): boolean {
    if (!/^https?:\/\/[^\s<>()"]+$/i.test(url)) return false;
    try {
        return !!new URL(url).hostname;
    } catch {
        return false;
    }
}

/**
 * A template the server accepts: http(s), with a {char} placeholder; {region}
 * and {realm} may stand in for the block's own fields (#553). "" counts as
 * fine (= no link). At most TEMPLATE_MAX characters, as on the server
 * (src/stores/settings/versionSettingsSchema.js), which drops a longer one.
 */
export const TEMPLATE_MAX = 300;

export function templateOk(tpl: string): boolean {
    const text = tpl.trim();
    if (!text) return true;
    return text.length <= TEMPLATE_MAX && text.includes("{char}") && isWebLink(text.replace(/\{(char|region|realm)\}/g, "x"));
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

/**
 * The fields of a block the server would refuse, so the form can say so
 * before saving. Empty fields are never a problem.
 */
export function blockProblems(block: VersionSettingsBlock): (keyof VersionSettingsBlock)[] {
    const out: (keyof VersionSettingsBlock)[] = [];
    const slug = (v: string) => !v.trim() || SLUG.test(v.trim().toLowerCase());
    if (block.blizzardRegion && !BLIZZARD_REGIONS.includes(block.blizzardRegion)) out.push("blizzardRegion");
    if (!slug(block.blizzardRealmSlug.replace(/\s+/g, "-").replace(/['’]/g, ""))) out.push("blizzardRealmSlug");
    if (!slug(block.blizzardNamespace)) out.push("blizzardNamespace");
    if (!templateOk(block.armoryUrlTemplate)) out.push("armoryUrlTemplate");
    if (!templateOk(block.wclUrlTemplate)) out.push("wclUrlTemplate");
    if (!slug(block.wowheadPath.replace(/^\/+|\/+$/g, ""))) out.push("wowheadPath");
    if (block.color.trim() && !/^#[0-9a-f]{6}$/i.test(block.color.trim())) out.push("color");
    return out;
}

/**
 * Fill a {char} template; "" without template or name, or when the result is
 * no working link. {region}/{realm} (#553) take the version's region and
 * realm — a template needing one that is not set gives no link.
 */
export function fillCharTemplate(tpl: string, character: string, place: { region?: string; realm?: string } = {}): string {
    const name = character.trim();
    if (!tpl || !name) return "";
    const region = (place.region || "").trim();
    const realm = (place.realm || "").trim();
    if ((tpl.includes("{region}") && !region) || (tpl.includes("{realm}") && !realm)) return "";
    const url = tpl
        .replace(/\{region\}/g, encodeURIComponent(region))
        .replace(/\{realm\}/g, encodeURIComponent(realm))
        .replace(/\{char\}/g, encodeURIComponent(name));
    return isWebLink(url) ? url : "";
}

/**
 * The fields of `defaults` that "Standardwerte übernehmen" (#553) would
 * change in `block`: every field with a standard value that differs. A field
 * without one (the realm, the raidsheet) is never touched.
 */
export function defaultsDiff(block: VersionSettingsBlock, defaults: VersionSettingsBlock | undefined): (keyof VersionSettingsBlock)[] {
    if (!defaults) return [];
    return VERSION_SETTING_FIELDS.filter((f) => defaults[f] && defaults[f] !== block[f]);
}

/** `block` with the standard values taken over (see defaultsDiff). */
export function applyDefaults(block: VersionSettingsBlock, defaults: VersionSettingsBlock | undefined): VersionSettingsBlock {
    const out = { ...block };
    for (const f of defaultsDiff(block, defaults)) out[f] = (defaults as VersionSettingsBlock)[f];
    return out;
}

/**
 * The links of one version's block, as the server builds them; with a
 * server's own values (#923) those win field by field.
 */
export function versionLinks(standard: VersionSettingsBlock, override?: VersionOverride) {
    const block = override ? effectiveBlock(standard, override) : standard;
    const place = { region: block.blizzardRegion, realm: block.blizzardRealmSlug.trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-") };
    return {
        armory: (character: string) => fillCharTemplate(block.armoryUrlTemplate, character, place),
        wcl: (character: string) => fillCharTemplate(block.wclUrlTemplate, character, place),
        wowheadItem: (itemId: number, params: string[] = []) => wowheadItemUrl(itemId, params, block.wowheadPath),
    };
}

/**
 * The Wowhead path of the page's version. A page whose data says which version
 * it shows (the loot council, the character page) provides the server's
 * `wowheadPath`; without a provider it is the path of stored (TBC) data.
 */
const WowheadPathContext = createContext<string>(LEGACY_WOWHEAD_PATH);

export function WowheadPathProvider({ path, children }: { path: string | undefined; children: ReactNode }) {
    return createElement(WowheadPathContext.Provider, { value: path === undefined ? LEGACY_WOWHEAD_PATH : path }, children);
}

/** The Wowhead path of the surrounding page ("" = no Wowhead links for its version). */
export function useWowheadPath(): string {
    return useContext(WowheadPathContext);
}

// --- per-server overrides (#923, epic #926) ---
// A server may set its own armory/log templates and its own Battle.net realm
// per version (config.serverSettings[guildId].versionOverrides). They lie
// field by field over the version's block, which stays the standard of every
// other server; Wowhead, Softres, raidsheet and colour stay shared.

/** The fields a server may set for itself, as on the server (OVERRIDE_FIELDS). */
export const VERSION_OVERRIDE_FIELDS = ["armoryUrlTemplate", "wclUrlTemplate", "blizzardRegion", "blizzardRealmSlug"] as const;
export type VersionOverrideField = (typeof VERSION_OVERRIDE_FIELDS)[number];
/** One version's own values of a server; a missing field = the standard. */
export type VersionOverride = Partial<Record<VersionOverrideField, string>>;
/** versionId -> the server's own values. */
export type VersionOverrides = Record<string, VersionOverride>;

/** The fields of an override the server would refuse; empty fields are never a problem. */
export function overrideProblems(override: VersionOverride | undefined): VersionOverrideField[] {
    const probe = blockOf({ ...emptyBlock(), ...pickOverride(override) });
    const bad = new Set(blockProblems(probe));
    return VERSION_OVERRIDE_FIELDS.filter((f) => bad.has(f));
}

/** Only the four fields, trimmed, the empty ones left out. */
export function pickOverride(override: VersionOverride | undefined): VersionOverride {
    const out: VersionOverride = {};
    for (const f of VERSION_OVERRIDE_FIELDS) {
        const v = String((override && override[f]) || "").trim();
        if (v) out[f] = v;
    }
    return out;
}

/**
 * The block a server really uses: its own valid values over the standard, the
 * same rule as the server's applyVersionOverrides (an invalid one is ignored).
 */
export function effectiveBlock(block: VersionSettingsBlock, override?: VersionOverride): VersionSettingsBlock {
    const own = pickOverride(override);
    const bad = new Set(overrideProblems(own));
    const out = { ...block };
    for (const f of VERSION_OVERRIDE_FIELDS) {
        if (own[f] && !bad.has(f)) out[f] = f === "blizzardRealmSlug" ? own[f]!.toLowerCase() : own[f]!;
    }
    return out;
}

/**
 * The fields whose switch is on but whose value is empty: saving would quietly
 * give the standard back, so the form asks for a value or the switch off.
 */
export function emptyOwnFields(override: VersionOverride | undefined): VersionOverrideField[] {
    return VERSION_OVERRIDE_FIELDS.filter((f) => override && override[f] !== undefined && !String(override[f]).trim());
}

/**
 * Whether a server's own realm/region reaches its links: only through a
 * {realm}/{region} placeholder in the template it really uses. (The armory
 * lookup takes them regardless.)
 */
export function placeInLinks(block: VersionSettingsBlock, field: "blizzardRegion" | "blizzardRealmSlug"): boolean {
    const mark = field === "blizzardRegion" ? "{region}" : "{realm}";
    return block.armoryUrlTemplate.includes(mark) || block.wclUrlTemplate.includes(mark);
}

/** What to send for one server: every version with at least one own value. */
export function overridesToSave(overrides: VersionOverrides): VersionOverrides {
    return Object.fromEntries(Object.entries(overrides)
        .map(([id, o]) => [id, pickOverride(o)] as const)
        .filter(([, o]) => Object.keys(o).length));
}
// --- end per-server overrides ---
