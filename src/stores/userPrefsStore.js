// Per-account preferences - the language chosen for the web menu and the bot
// (lang, German or English) and the Discord client language last seen
// (clientLang, what the bot falls back to without a choice). The browser
// keeps the choice in localStorage as well; this store is what makes it follow the account to
// another device. Keyed by Discord user id, stored under
// data/settings/user-prefs.json like the other stores.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

const LANGS = ["de", "en"];

const store = createJsonStore({
    file: settingsPath("user-prefs.json"),
    defaults: () => ({}),
    normalize: (data) => (data && data.users && typeof data.users === "object" && !Array.isArray(data.users) ? data.users : {}),
});

/** Tests point the store at a file of their own. */
const useFile = store.useFile;

function readAll() {
    return store.read();
}

function writeAll(users) {
    store.write({ users });
}

/** "EN", " en " -> "en"; anything that is not a supported language -> "". */
function normalizeLang(raw) {
    const clean = String(raw || "").trim().toLowerCase();
    return LANGS.includes(clean) ? clean : "";
}

/** The account's saved language, or "" when it never chose one. */
function getLang(userId) {
    if (!userId) return "";
    const entry = readAll()[String(userId)];
    return entry ? normalizeLang(entry.lang) : "";
}

/**
 * Saves the account's language. Returns the stored value, or `{ code }` when
 * there is no account or the language is not one the menu speaks.
 */
function setLang(userId, lang) {
    if (!userId) return { code: "no_user" };
    const clean = normalizeLang(lang);
    if (!clean) return { code: "unknown_lang" };
    const users = readAll();
    users[String(userId)] = { ...(users[String(userId)] || {}), lang: clean };
    writeAll(users);
    return { lang: clean };
}

/** Maps a Discord client locale ("de", "en-US", "fr", ...) to a bot language: German stays German, everything else is English. "" for no locale. */
function localeToLang(locale) {
    const clean = String(locale || "").trim().toLowerCase();
    if (!clean) return "";
    return clean === "de" || clean.startsWith("de-") ? "de" : "en";
}

/** The language of the Discord client the account last used, or "" when none was seen yet. Separate from the chosen lang. */
function getClientLang(userId) {
    if (!userId) return "";
    const entry = readAll()[String(userId)];
    return entry ? normalizeLang(entry.clientLang) : "";
}

/**
 * Remembers the Discord client language of an interaction. Writes only when the
 * value changes (the store is a JSON file, interactions are frequent). Returns
 * whether it wrote.
 */
function noteClientLang(userId, locale) {
    if (!userId) return false;
    const lang = localeToLang(locale);
    if (!lang || getClientLang(userId) === lang) return false;
    const users = readAll();
    users[String(userId)] = { ...(users[String(userId)] || {}), clientLang: lang };
    writeAll(users);
    return true;
}

/** Forgets the account's chosen language: it follows the Discord language again. Returns whether there was one. */
function clearLang(userId) {
    if (!userId) return false;
    const users = readAll();
    const entry = users[String(userId)];
    if (!entry || !entry.lang) return false;
    const rest = { ...entry };
    delete rest.lang;
    if (Object.keys(rest).length) users[String(userId)] = rest;
    else delete users[String(userId)];
    writeAll(users);
    return true;
}

module.exports = { useFile, getLang, setLang, clearLang, getClientLang, noteClientLang, localeToLang, normalizeLang, LANGS };
