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
//   eh_role_<role>       eh_role_tank, eh_role_healer, …          (WoW icon)
//   eh_ui_<name>         eh_ui_leader, eh_ui_date, eh_ui_signed, … (flat line icon)
//                        eh_ui_tank|healer|melee|ranged — the flat role icons (#303)
//                        eh_ui_voice, eh_ui_end — the raid's voice channel and its end (#305)
//
// The `eh_ui_` icons are the message's chrome — leader, count, date, time,
// deadline, start, the five signup statuses, closed, class — drawn flat and
// light grey like Raid-Helper's (scripts/render-ui-emojis.js) and checked in
// as PNGs under assets/emojis/; the sync uploads them from there. They replace
// the colourful WoW status icons `eh_status_*` of #287, which are no longer
// used (an application that has them keeps them; nothing deletes an emoji).
const path = require("path");
const { buildClasses, ROLES } = require("../config/gameVersions/classes");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/medium";
const PREFIX = "eh_";
const UI_DIR = path.join(__dirname, "..", "..", "assets", "emojis");
// Retry a failed fetch after this long instead of asking Discord on every render.
const RETRY_MS = 10 * 60 * 1000;

const ROLE_ICONS = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_dualwield",
    ranged: "ability_hunter_snipershot",
};
// The flat UI icons, each a PNG in assets/emojis/eh_ui_<name>.png.
const UI_ICONS = [
    "leader", "signups", "date", "time", "deadline", "start",
    "signed", "late", "tentative", "bench", "absence", "closed", "class",
    // the role totals and the Tank block of the event message (#303)
    "tank", "healer", "melee", "ranged",
    // the voice channel and the raid's end in the message head (#305)
    "voice", "end",
];

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Priest-Shadow" → "eh_priest_shadow" ("" for anything that is not a spec key). */
function specEmojiName(specKey) {
    const [cls, spec] = String(specKey || "").split("-");
    return cls && spec ? `${PREFIX}${slug(cls)}_${slug(spec)}`.slice(0, 32) : "";
}

const classEmojiName = (classId) => (classId ? `${PREFIX}class_${slug(classId)}`.slice(0, 32) : "");
const roleEmojiName = (role) => (role ? `${PREFIX}role_${slug(role)}` : "");
const uiEmojiName = (name) => (name ? `${PREFIX}ui_${slug(name)}` : "");
/** A role's flat UI icon (`eh_ui_tank`, …) — the event message draws these instead of the WoW role icons (#303). */
const roleUiEmojiName = (role) => (ROLES.includes(role) ? uiEmojiName(role) : "");
/** A signup status's icon — the flat UI icon of the same name. */
const statusEmojiName = (status) => uiEmojiName(status);
/** Where the PNG of a UI icon lives. */
const uiIconFile = (name) => path.join(UI_DIR, `${uiEmojiName(name)}.png`);

/**
 * Every emoji the bot uses, with where its image comes from:
 * `[{ name, icon, url }]` for the WoW icons (specs and classes of the shared
 * rule set, the four roles) and `[{ name, icon, file }]` for the flat UI icons.
 */
function emojiCatalog() {
    const out = [];
    const add = (name, icon) => out.push({ name, icon, url: `${ICON_BASE}/${icon}.jpg` });
    for (const cls of buildClasses()) {
        add(classEmojiName(cls.id), cls.icon);
        for (const spec of cls.specs) add(specEmojiName(spec.key), spec.icon);
    }
    for (const role of ROLES) add(roleEmojiName(role), ROLE_ICONS[role]);
    for (const name of UI_ICONS) out.push({ name: uiEmojiName(name), icon: name, file: uiIconFile(name) });
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
    loading = (async () => {
        try {
            return setAppEmojis(await app.emojis.fetch());
        } catch (e) {
            failedAt = now;
            console.warn(`[appEmojis] Emojis nicht lesbar: ${e.message}`);
            return cache;
        } finally {
            loading = null;
        }
    })();
    return loading;
}

/** `<:name:id>` from the cache, else the fallback. */
function emojiFor(name, fallback = "") {
    return emojiText(cache, name, fallback);
}

/** Forget everything (tests). */
function resetAppEmojis() {
    cache = {};
    loadedAt = 0;
    failedAt = 0;
    loading = null;
}

module.exports = {
    ICON_BASE, PREFIX, UI_DIR, ROLE_ICONS, UI_ICONS,
    specEmojiName, classEmojiName, roleEmojiName, uiEmojiName, roleUiEmojiName, statusEmojiName, uiIconFile, emojiCatalog, validEmojiName,
    emojiText, emojiOption, appEmojiMap, appEmojisLoaded, setAppEmojis, loadAppEmojis, emojiFor, resetAppEmojis,
};
