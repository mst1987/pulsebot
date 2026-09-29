// Settings per game version on the client (#542): the block the server keeps
// in config.versionSettings (src/stores/versionSettingsSchema.js) and the
// links built from it. The same rules as the server's helper
// (src/services/events/versionSettings.js): an empty setting means "not there
// for this version", and the link is left out rather than guessed or broken.
import { createContext, createElement, useContext, type ReactNode } from "react";
import { LEGACY_WOWHEAD_PATH, wowheadItemUrl } from "./wowheadItems";

export type VersionSettingsBlock = {
    blizzardRegion: string;
    blizzardRealmSlug: string;
    blizzardNamespace: string;
    armoryUrlTemplate: string;
    wclUrlTemplate: string;
    wowheadPath: string;
    softresEdition: string;
    raidsheetId: string;
};

export const VERSION_SETTING_FIELDS: (keyof VersionSettingsBlock)[] = [
    "blizzardRegion", "blizzardRealmSlug", "blizzardNamespace",
    "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath", "softresEdition", "raidsheetId",
];

export const BLIZZARD_REGIONS = ["eu", "us", "kr", "tw"];
export const SOFTRES_EDITIONS = ["classic", "tbc", "wotlk"];

export function emptyBlock(): VersionSettingsBlock {
    return {
        blizzardRegion: "", blizzardRealmSlug: "", blizzardNamespace: "", armoryUrlTemplate: "",
        wclUrlTemplate: "", wowheadPath: "", softresEdition: "", raidsheetId: "",
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

/** A template the server accepts: http(s), with a {char} placeholder. "" counts as fine (= no link). */
export function templateOk(tpl: string): boolean {
    const text = tpl.trim();
    if (!text) return true;
    return text.includes("{char}") && isWebLink(text.replace(/\{char\}/g, "x"));
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
    return out;
}

/** Fill a {char} template; "" without template or name, or when the result is no working link. */
export function fillCharTemplate(tpl: string, character: string): string {
    const name = character.trim();
    if (!tpl || !name) return "";
    const url = tpl.replace(/\{char\}/g, encodeURIComponent(name));
    return isWebLink(url) ? url : "";
}

/** The links of one version's block, as the server builds them. */
export function versionLinks(block: VersionSettingsBlock) {
    return {
        armory: (character: string) => fillCharTemplate(block.armoryUrlTemplate, character),
        wcl: (character: string) => fillCharTemplate(block.wclUrlTemplate, character),
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
