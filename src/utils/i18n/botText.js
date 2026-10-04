// The language of what the bot writes in Discord (German by default, English on
// request). Every text a raider or the public reads is written in the code in
// English and passed through `tr(lang, "English text", vars)`; for "de" the
// German catalog (src/config/botText/de/) has the same sentence in German.
// The English sentence is the key — so the code reads like before, and a
// missing German entry falls back to English instead of showing a key.
// test/config/botText/de.test.js scans src/ for every `tr(…, "…")` and fails
// on a sentence without a German entry (and on entries no code uses).
//
// Which language: services/discord/botLanguage.js (the raider's own choice,
// else the server language of Einstellungen, else German).
//
//   tr(lang, "Saved for {title}", { title })   placeholders in {braces}
//   serviceText(lang, germanServiceMessage)     the shared services answer in
//                                               German; English through botEnglish
//   specLabel(lang, info) / classLabel(lang, info)  rule-set labels (label = de, labelEn = en)
//   dateLocale(lang)                            luxon locale for dates outside Discord timestamps
const DE = require("../../config/botText/de");
const { toEnglish } = require("../signup/botEnglish");

const LANGS = ["de", "en"];
const DEFAULT_LANG = "de";

/** "de" | "en"; anything else is the default. */
function normalizeLang(raw) {
    const lang = String(raw || "").trim().toLowerCase();
    return LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

/** Fill `{name}` placeholders; an unknown one stays as written. */
function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (all, key) => (vars[key] === undefined || vars[key] === null ? all : String(vars[key])));
}

/** One text in the language: the English source, or its German catalog entry. */
function tr(lang, text, vars) {
    const source = String(text);
    const base = normalizeLang(lang) === "de" && Object.prototype.hasOwnProperty.call(DE, source) ? DE[source] : source;
    return fill(base, vars);
}

/** A German message of a shared service (signupService, profile store, …) in the language. */
function serviceText(lang, text) {
    return normalizeLang(lang) === "en" ? toEnglish(text) : (text === null || text === undefined ? "" : String(text));
}

/** The name of a spec or class of the rule set in the language (`label` is German, `labelEn` English). */
function specLabel(lang, info, fallback = "") {
    if (!info) return fallback;
    return (normalizeLang(lang) === "en" ? info.labelEn || info.label : info.label || info.labelEn) || fallback;
}
const classLabel = specLabel;

/** The luxon locale for dates written out (select options, modal labels — no Discord timestamp there). */
function dateLocale(lang) {
    return normalizeLang(lang) === "en" ? "en" : "de";
}

module.exports = { LANGS, DEFAULT_LANG, normalizeLang, tr, fill, serviceText, specLabel, classLabel, dateLocale };
