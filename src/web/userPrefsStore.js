// Per-account preferences of the web menu — for now only the language the
// menu is shown in (German or English). The browser keeps the choice in
// localStorage as well; this store is what makes it follow the account to
// another device. Keyed by Discord user id, stored under
// data/settings/user-prefs.json like the other stores.
const fs = require("fs");
const path = require("path");

const SETTINGS_DIR = path.join(__dirname, "..", "..", "data", "settings");
const DEFAULT_FILE = path.join(SETTINGS_DIR, "user-prefs.json");

const LANGS = ["de", "en"];

let prefsFile = DEFAULT_FILE;

/** Tests point the store at a file of their own. */
function useFile(file) {
    prefsFile = file || DEFAULT_FILE;
}

function readAll() {
    try {
        const data = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
        return data && data.users && typeof data.users === "object" && !Array.isArray(data.users) ? data.users : {};
    } catch {
        return {};
    }
}

function writeAll(users) {
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    fs.writeFileSync(prefsFile, JSON.stringify({ users }, null, 2));
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

module.exports = { useFile, getLang, setLang, normalizeLang, LANGS };
