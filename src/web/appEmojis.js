// The bot's application emojis (#287): spec, class, role and status icons that
// the event message and its selects draw instead of text. They belong to the
// bot's Discord application, not to a server, so they work on the event and
// the talk server alike — in embeds and in select options.
//
// Uploaded once with `node scripts/sync-app-emojis.js` (the catalogue below is
// what it uploads); read here once per process from
// `client.application.emojis.fetch()` and cached by name. An emoji that is
// missing — not synced yet, the bot offline — falls back to text, so nothing
// ever depends on them.
//
// Names (≤ 32 characters, [a-z0-9_]):
//   eh_<class>_<spec>    eh_priest_shadow, eh_druid_guardian
//   eh_class_<class>     eh_class_warrior
//   eh_role_<role>       eh_role_tank, eh_role_healer, eh_role_melee, eh_role_ranged
//   eh_status_<status>   eh_status_signed, eh_status_absence, …
const { buildClasses, ROLES } = require("../config/gameVersions/classes");
const { SIGNUP_STATUSES } = require("../utils/attendance");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons/medium";
const PREFIX = "eh_";
// Retry a failed fetch after this long instead of asking Discord on every render.
const RETRY_MS = 10 * 60 * 1000;

const ROLE_ICONS = {
    tank: "ability_warrior_defensivestance",
    healer: "spell_holy_flashheal",
    melee: "ability_dualwield",
    ranged: "ability_hunter_snipershot",
};
const STATUS_ICONS = {
    signed: "ability_paladin_beaconoflight",
    tentative: "inv_misc_questionmark",
    late: "spell_holy_borrowedtime",
    bench: "inv_misc_note_02",
    absence: "spell_shadow_sacrificialshield",
};
// Shown when an emoji is missing — the message must read the same without icons.
const ROLE_FALLBACK = { tank: "🛡️", healer: "💚", melee: "⚔️", ranged: "🏹" };
const STATUS_FALLBACK = { signed: "✅", tentative: "❔", late: "⏰", bench: "🪑", absence: "❌" };

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Priest-Shadow" → "eh_priest_shadow" ("" for anything that is not a spec key). */
function specEmojiName(specKey) {
    const [cls, spec] = String(specKey || "").split("-");
    return cls && spec ? `${PREFIX}${slug(cls)}_${slug(spec)}`.slice(0, 32) : "";
}

const classEmojiName = (classId) => (classId ? `${PREFIX}class_${slug(classId)}`.slice(0, 32) : "");
const roleEmojiName = (role) => (role ? `${PREFIX}role_${slug(role)}` : "");
const statusEmojiName = (status) => (status ? `${PREFIX}status_${slug(status)}` : "");

/**
 * Every emoji the bot uses, with the icon it is made from:
 * `[{ name, icon, url }]`, specs and classes of the shared rule set, the four
 * roles and the five signup statuses.
 */
function emojiCatalog() {
    const out = [];
    const add = (name, icon) => out.push({ name, icon, url: `${ICON_BASE}/${icon}.jpg` });
    for (const cls of buildClasses()) {
        add(classEmojiName(cls.id), cls.icon);
        for (const spec of cls.specs) add(specEmojiName(spec.key), spec.icon);
    }
    for (const role of ROLES) add(roleEmojiName(role), ROLE_ICONS[role]);
    for (const status of SIGNUP_STATUSES) add(statusEmojiName(status), STATUS_ICONS[status]);
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
    ICON_BASE, PREFIX, ROLE_ICONS, STATUS_ICONS, ROLE_FALLBACK, STATUS_FALLBACK,
    specEmojiName, classEmojiName, roleEmojiName, statusEmojiName, emojiCatalog, validEmojiName,
    emojiText, emojiOption, appEmojiMap, setAppEmojis, loadAppEmojis, emojiFor, resetAppEmojis,
};
