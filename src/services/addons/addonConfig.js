// The addons the guild can download on the page "Addons" (#818): which GitHub
// repo each one comes from, which release files are offered, for which game
// versions, and how to install it. A setting (config.json `addonDownloads`,
// Einstellungen -> Module -> Addons, full admins only) with the three own
// addons as the default, so the page works on a fresh install.
//
// Pure: the defaults and the normaliser only, so configSchema.js can use them
// without a require cycle. The GitHub token is NOT part of an entry: it is one
// credential (`config.github.token`), guarded like the other foreign secrets.
const { VERSIONS } = require("../../config/gameVersions");

const VERSION_IDS = VERSIONS.map((v) => v.id);

/** At most this many addons; the page is a short list, not a catalogue. */
const MAX_ADDONS = 20;
/** At most this many file patterns per addon. */
const MAX_PATTERNS = 6;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const ICON = /^[a-z0-9_'-]{1,80}$/;
// A zamimg icon url, e.g. https://wow.zamimg.com/images/wow/icons/large/inv_gizmo_01.jpg
const ZAMIMG = /^https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/(?:small|medium|large)\/([a-z0-9_'-]{1,80})\.(?:jpg|png)$/i;
// A file pattern: a file name with * and ? as wildcards, nothing that walks a path.
const PATTERN = /^[A-Za-z0-9._*?+-]{1,80}$/;

const DEFAULT_ICON = "inv_misc_questionmark";

const DEFAULT_ADDONS = Object.freeze([
    Object.freeze({
        id: "levelhelper",
        name: "LevelHelper",
        description: "Leveling-Helfer für WoW Forever: solo oder im Duo, mit oder ohne RestedXP.",
        repo: "mst1987/levelhelper",
        private: true,
        assets: Object.freeze(["LevelHelper-*.zip"]),
        versions: Object.freeze(["forever"]),
        install: "",
        icon: "inv_misc_map02",
        enabled: true,
    }),
    Object.freeze({
        id: "professionkit",
        name: "ProfessionKit",
        description: "Berufe-Guide: zeigt den günstigsten Weg zum nächsten Skillpunkt.",
        repo: "mst1987/professionkit",
        private: true,
        assets: Object.freeze(["ProfessionKit-*.zip"]),
        versions: Object.freeze(["forever"]),
        install: "",
        icon: "trade_blacksmithing",
        enabled: true,
    }),
    Object.freeze({
        id: "aurakit",
        name: "AuraKit",
        description: "Buffs, Debuffs, Cooldowns, Leben und Ressourcen als Leiste unter dem Charakter, mit Klassen-Vorlagen und Cooldown-Puls.",
        repo: "mst1987/aurakit",
        private: true,
        assets: Object.freeze(["AuraKit-*.zip"]),
        versions: Object.freeze(["forever"]),
        install: "",
        icon: "spell_holy_auraoflight",
        enabled: true,
    }),
    Object.freeze({
        id: "macrohelper",
        name: "MacroHelper",
        description: "Macht aus Zaubern im Zauberbuch fertige Makros, mit Vorschlägen je Klasse.",
        repo: "mst1987/macrohelper",
        private: true,
        assets: Object.freeze(["MacroHelper-*.zip"]),
        versions: Object.freeze(["forever"]),
        install: "",
        icon: "inv_misc_book_09",
        enabled: true,
    }),
    Object.freeze({
        id: "eventhelper-sync",
        name: "EventHelper Sync",
        description: "Sync-Tool für Windows und das Addon EventHelperSync: Loot hochladen, Loot-Council und Gildenbank.",
        repo: "mst1987/eventhelper-addon",
        private: false,
        assets: Object.freeze(["EventHelperSync.exe", "EventHelperSync-*.zip"]),
        versions: Object.freeze(["tbc", "forever"]),
        install: "Im Sync-Tool die Serveradresse und den API-Token der Orga eintragen. Ab Version 1.14.0 aktualisiert sich das Sync-Tool selbst und spielt das Addon über „Installieren“ ein.",
        icon: "inv_gizmo_01",
        enabled: true,
    }),
]);

/** A fresh, mutable copy of the default list. */
function defaultAddons() {
    return DEFAULT_ADDONS.map((a) => ({ ...a, assets: [...a.assets], versions: [...a.versions] }));
}

const text = (raw, max) => String(raw === undefined || raw === null ? "" : raw).replace(/\r\n?/g, "\n").trim().slice(0, max);

/** An id from a typed name: lower case, dashes, at most 40 characters. "" when nothing is left. */
function slugify(raw) {
    return String(raw || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

/** The icon name of a typed icon: a zamimg name, or a zamimg url reduced to its name. Unknown = the question mark. */
function normalizeIcon(raw) {
    const value = String(raw || "").trim();
    const url = ZAMIMG.exec(value);
    if (url) return url[1].toLowerCase();
    const name = value.toLowerCase();
    return ICON.test(name) ? name : DEFAULT_ICON;
}

/** "owner/repo" from a typed repo or a github.com url; "" when it is neither. */
function normalizeRepo(raw) {
    const value = String(raw || "").trim()
        .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "");
    return REPO.test(value) ? value : "";
}

/** The file patterns: known characters only, no duplicates, at most MAX_PATTERNS. */
function normalizePatterns(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || "").split(/[,\n]/);
    const out = [];
    for (const p of list) {
        const value = String(p || "").trim();
        if (value && PATTERN.test(value) && !out.includes(value)) out.push(value);
    }
    return out.slice(0, MAX_PATTERNS);
}

/** The game versions: known ids only, in the rule sets' order. */
function normalizeVersions(raw) {
    const list = Array.isArray(raw) ? raw.map((v) => String(v || "").trim()) : [];
    return VERSION_IDS.filter((id) => list.includes(id));
}

/**
 * One stored or submitted entry in its final shape, or null when it cannot be
 * one (no usable repo, no name). The id comes from the entry, else its name.
 */
function normalizeAddon(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const name = text(raw.name, 60);
    const repo = normalizeRepo(raw.repo);
    if (!name || !repo) return null;
    const typedId = String(raw.id || "").trim().toLowerCase();
    const id = ID.test(typedId) ? typedId : slugify(name);
    if (!id) return null;
    return {
        id,
        name,
        description: text(raw.description, 300),
        repo,
        private: raw.private === true,
        assets: normalizePatterns(raw.assets),
        versions: normalizeVersions(raw.versions),
        install: text(raw.install, 600),
        icon: normalizeIcon(raw.icon),
        enabled: raw.enabled !== false,
    };
}

/** The stored/submitted list: valid entries only, ids unique (a later twin is dropped), at most MAX_ADDONS. */
function normalizeAddonList(raw) {
    if (!Array.isArray(raw)) return defaultAddons();
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        const clean = normalizeAddon(entry);
        if (!clean || seen.has(clean.id)) continue;
        seen.add(clean.id);
        out.push(clean);
        if (out.length >= MAX_ADDONS) break;
    }
    return out;
}

/**
 * The list config.json holds, as every reader gets it. Never stored = the
 * defaults. An empty list counts only when an admin emptied it on purpose
 * (`addonDownloadsCustomized`, set by an edit in Einstellungen -> Module ->
 * Addons): an empty list without that mark was never meant and reads as the
 * defaults again, so the page "Addons" heals itself.
 */
function storedAddonList(stored) {
    const src = stored && typeof stored === "object" ? stored : {};
    if (src.addonDownloads === undefined) return defaultAddons();
    const list = normalizeAddonList(src.addonDownloads);
    return list.length || src.addonDownloadsCustomized === true ? list : defaultAddons();
}

/** The GitHub credential block: `{ token }`, a string, nothing else. */
function normalizeGithub(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return { token: String(src.token === undefined || src.token === null ? "" : src.token).trim() };
}

/** A file pattern as a regular expression: `*` any run, `?` one character, case-insensitive, whole name. */
function patternRegex(pattern) {
    const body = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${body}$`, "i");
}

/** Whether a release file belongs to the addon: it matches one pattern (no pattern = every file). */
function assetMatches(addon, fileName) {
    const patterns = (addon && addon.assets) || [];
    if (!patterns.length) return true;
    return patterns.some((p) => patternRegex(p).test(String(fileName || "")));
}

module.exports = {
    DEFAULT_ADDONS, DEFAULT_ICON, MAX_ADDONS, MAX_PATTERNS, VERSION_IDS,
    defaultAddons, normalizeAddon, normalizeAddonList, storedAddonList, normalizeGithub, normalizeIcon, normalizeRepo,
    normalizePatterns, normalizeVersions, slugify, patternRegex, assetMatches,
};
