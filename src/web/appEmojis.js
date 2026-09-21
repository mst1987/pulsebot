// The bot's application emojis (#287): spec, class, role and status icons that
// the event message and its selects draw instead of text. They belong to the
// bot's Discord application, not to a server, so they work on the event and
// the talk server alike — in embeds and in select options.
//
// Uploaded by the bot on start (`appEmojiSync.ensureAppEmojis`; by hand with
// `node scripts/sync-app-emojis.js` — the catalogue below is what both upload);
// read here once per process from
// `client.application.emojis.fetch()` and cached by name. An emoji that is
// missing — not synced yet, the bot offline — falls back to text, so nothing
// ever depends on them.
//
// Names (≤ 32 characters, [a-z0-9_]):
//   eh_<class>_<spec>    eh_priest_shadow, eh_druid_guardian      (WoW icon)
//   eh_class_<class>     eh_class_warrior                         (WoW icon)
//   eh_ui_<name>         eh_ui_leader, eh_ui_date, eh_ui_signed, … (flat line icon)
//                        eh_ui_tank|healer|melee|ranged — the flat role icons (#303)
//                        eh_ui_voice, eh_ui_end — the raid's voice channel and its end (#305)
//   eh_t<s>_<char>       eh_ta_h, eh_tg_7, eh_tp_plus — the letter tiles of the title line
//                        (embed titles cannot show emojis, so the line opens the description)
//   eh_r<s>_<role>       eh_ra_tank, eh_rg_healer — the role icons in the same style
//                        <s> is the event's emoji style: a(rcane) · g(old) · p(archment).
//                        Drawn with Gemini ("Nano Banana"), checked in as PNGs like the UI icons;
//                        the style "plain" draws no tiles and the flat eh_ui_<role> icons.
//
// The `eh_ui_` icons are the message's chrome — leader, count, date, time,
// deadline, start, the five signup statuses, closed, class, the four roles —
// drawn flat and light grey like Raid-Helper's (scripts/render-ui-emojis.js)
// and checked in as PNGs under assets/emojis/; the sync uploads them from
// there. They replaced the colourful WoW status icons `eh_status_*` of #287
// and, since #320, the WoW role icons `eh_role_*`: the setup message was the
// last reader and draws `eh_ui_<role>` like the signup message does, so the
// four are out of the catalogue. An application that has them keeps them —
// nothing ever deletes an emoji.
const path = require("path");
const { buildClasses, ROLES } = require("../config/gameVersions/classes");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/medium";
const PREFIX = "eh_";
const UI_DIR = path.join(__dirname, "..", "..", "assets", "emojis");
// Retry a failed fetch after this long instead of asking Discord on every render.
const RETRY_MS = 10 * 60 * 1000;

// The flat UI icons, each a PNG in assets/emojis/eh_ui_<name>.png.
const UI_ICONS = [
    "leader", "signups", "date", "time", "deadline", "start",
    "signed", "late", "tentative", "bench", "absence", "closed", "class",
    // the role totals and the Tank block of the event message (#303); melee is
    // drawn as two crossed swords ("swords") — the single sword ("melee") read
    // as an exclamation mark and stays only for the emojis already uploaded
    "tank", "healer", "melee", "swords", "ranged",
    // the voice channel and the raid's end in the message head (#305)
    "voice", "end",
];

// The letter tiles of the message's title line, like Raid-Helper's: one emoji
// per character (a PNG in assets/emojis/ like the UI icons). Character → name.
const TITLE_TILES = Object.fromEntries([
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("").map((c) => [c, c.toLowerCase()]),
    ["+", "plus"], ["-", "minus"], ["&", "amp"],
]);

// The emoji styles an event can pick (its `emojiStyle`): each one a full set of
// letter tiles and role icons, keyed by the letter in their names. "plain"
// has none of its own — plain title, flat role icons.
const EMOJI_STYLES = { arcane: "a", gold: "g", parchment: "p", plain: "" };
const DEFAULT_EMOJI_STYLE = "arcane";
/** A known style, else the default. */
const emojiStyleOf = (style) => (Object.prototype.hasOwnProperty.call(EMOJI_STYLES, style) ? style : DEFAULT_EMOJI_STYLE);

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Priest-Shadow" → "eh_priest_shadow" ("" for anything that is not a spec key). */
function specEmojiName(specKey) {
    const [cls, spec] = String(specKey || "").split("-");
    return cls && spec ? `${PREFIX}${slug(cls)}_${slug(spec)}`.slice(0, 32) : "";
}

const classEmojiName = (classId) => (classId ? `${PREFIX}class_${slug(classId)}`.slice(0, 32) : "");
const uiEmojiName = (name) => (name ? `${PREFIX}ui_${slug(name)}` : "");
// What a role's icon shows, where that differs from the role's name: melee is
// two crossed swords. A new name, because the bot never replaces an emoji that
// is uploaded already (scripts/render-role-swords.js).
const ROLE_ICONS = { melee: "swords" };
const roleIconKey = (role) => ROLE_ICONS[role] || role;
/** A role's flat UI icon (`eh_ui_tank`, `eh_ui_swords`, …) — the signup and the setup message draw these; the WoW role icons are gone (#303/#320). */
const roleUiEmojiName = (role) => (ROLES.includes(role) ? uiEmojiName(roleIconKey(role)) : "");
/** A signup status's icon — the flat UI icon of the same name. */
const statusEmojiName = (status) => uiEmojiName(status);
/** Where the PNG of a UI icon lives. */
const uiIconFile = (name) => path.join(UI_DIR, `${uiEmojiName(name)}.png`);
/** The tile of one title character in a style ("H" → "eh_ta_h", "+" → "eh_ta_plus"); "" without a tile or for "plain". */
function tileEmojiName(char, style = DEFAULT_EMOJI_STYLE) {
    const code = EMOJI_STYLES[emojiStyleOf(style)];
    return code && TITLE_TILES[char] ? `${PREFIX}t${code}_${TITLE_TILES[char]}` : "";
}
/** A role's icon in a style ("tank" → "eh_ra_tank", "melee" → "eh_ra_swords"); "plain" gives the flat `eh_ui_<icon>`. */
function roleEmojiName(role, style = DEFAULT_EMOJI_STYLE) {
    if (!ROLES.includes(role)) return "";
    const code = EMOJI_STYLES[emojiStyleOf(style)];
    return code ? `${PREFIX}r${code}_${roleIconKey(role)}` : uiEmojiName(roleIconKey(role));
}
/** Where the PNG of a styled emoji (tile or role) lives. */
const styledFile = (name) => path.join(UI_DIR, `${name}.png`);

/**
 * Every emoji the bot uses, with where its image comes from:
 * `[{ name, icon, url }]` for the WoW icons (specs and classes of the shared
 * rule set) and `[{ name, icon, file }]` for the flat UI icons — which carry
 * the four roles too since #320 — and `[{ name, tile, file }]` for the
 * letter tiles and the role icons of each emoji style (`tile` names what it
 * shows: "H", "+", "tank").
 */
function emojiCatalog() {
    const out = [];
    const add = (name, icon) => out.push({ name, icon, url: `${ICON_BASE}/${icon}.jpg` });
    for (const cls of buildClasses()) {
        add(classEmojiName(cls.id), cls.icon);
        for (const spec of cls.specs) add(specEmojiName(spec.key), spec.icon);
    }
    for (const name of UI_ICONS) out.push({ name: uiEmojiName(name), icon: name, file: uiIconFile(name) });
    for (const style of Object.keys(EMOJI_STYLES).filter((s) => EMOJI_STYLES[s])) {
        for (const char of Object.keys(TITLE_TILES)) {
            const name = tileEmojiName(char, style);
            out.push({ name, tile: char, file: styledFile(name) });
        }
        for (const role of ROLES) {
            const name = roleEmojiName(role, style);
            out.push({ name, tile: role, file: styledFile(name) });
        }
    }
    return out;
}

/** A valid application emoji name. */
const validEmojiName = (name) => /^[a-z0-9_]{2,32}$/.test(String(name || ""));

// ---- pure helpers over a name → { id, name, animated } map ----------------

/** `<:name:id>` from a map, else the fallback text. */
function emojiText(emojis, name, fallback = "") {
    const e = emojis && name ? emojis[name] : null;
    if (!e || !e.id) return fallback;
    return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
}

/** The emoji object a select option or button takes, from a map, else a unicode fallback (or undefined). */
function emojiOption(emojis, name, fallback = "") {
    const e = emojis && name ? emojis[name] : null;
    if (e && e.id) return { id: String(e.id), name: e.name, animated: !!e.animated };
    return fallback ? { name: fallback } : undefined;
}

// ---- the cache -------------------------------------------------------------

let cache = {};
let loadedAt = 0;
let failedAt = 0;
let loading = null;
// Counts how often the cache was thrown away. A fetch that was already on its
// way when that happened must not write its answer into the new cache
// afterwards - in a test suite that is one test's Discord client answering into
// the next test (#315), in the bot a reconnect racing a reset.
let generation = 0;

/** The cached map (possibly empty). */
function appEmojiMap() {
    return cache;
}

/** Whether the application's emojis were read at least once (else "missing" means "unknown"). */
function appEmojisLoaded() {
    return loadedAt > 0;
}

/** Fill the cache from a list of emojis (a discord.js Collection or an array). */
function setAppEmojis(list) {
    const next = {};
    const items = list && typeof list.values === "function" ? [...list.values()] : (list || []);
    for (const e of items) {
        if (e && e.id && e.name && String(e.name).startsWith(PREFIX)) {
            next[e.name] = { id: String(e.id), name: String(e.name), animated: !!e.animated };
        }
    }
    cache = next;
    loadedAt = Date.now();
    failedAt = 0;
    return cache;
}

/**
 * Read the application's emojis once (and again only after `force` or a failed
 * try older than RETRY_MS). Never throws: a failure leaves the cache as it was.
 * @param {object} client a discord.js Client (ready)
 */
async function loadAppEmojis(client, { force = false, now = Date.now() } = {}) {
    if (!force && loadedAt) return cache;
    if (!force && failedAt && now - failedAt < RETRY_MS) return cache;
    if (loading) return loading;
    const app = client && client.application;
    if (!app || !app.emojis || typeof app.emojis.fetch !== "function") return cache;
    const mine = generation;
    loading = (async () => {
        try {
            const list = await app.emojis.fetch();
            if (mine !== generation) return cache; // the cache was reset while this was in flight
            return setAppEmojis(list);
        } catch (e) {
            if (mine === generation) failedAt = now;
            console.warn(`[appEmojis] Emojis nicht lesbar: ${e.message}`);
            return cache;
        } finally {
            if (mine === generation) loading = null;
        }
    })();
    return loading;
}

/** `<:name:id>` from the cache, else the fallback. */
function emojiFor(name, fallback = "") {
    return emojiText(cache, name, fallback);
}

/** Forget everything (tests); a fetch still in flight no longer reaches the cache. */
function resetAppEmojis() {
    cache = {};
    loadedAt = 0;
    failedAt = 0;
    loading = null;
    generation++;
}

module.exports = {
    ICON_BASE, PREFIX, UI_DIR, UI_ICONS, TITLE_TILES, EMOJI_STYLES, DEFAULT_EMOJI_STYLE, emojiStyleOf,
    specEmojiName, classEmojiName, uiEmojiName, roleUiEmojiName, statusEmojiName, uiIconFile,
    tileEmojiName, roleEmojiName, styledFile, emojiCatalog, validEmojiName,
    emojiText, emojiOption, appEmojiMap, appEmojisLoaded, setAppEmojis, loadAppEmojis, emojiFor, resetAppEmojis,
};
