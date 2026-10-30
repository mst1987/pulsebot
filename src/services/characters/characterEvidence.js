// Does a profile character exist in game? A raider types any name when they
// sign up ("Gentle" for the real "Gentleowl"), and the guild bank's addon mails
// a hand-out to exactly that name — a mail to a name nobody plays is lost. So a
// profile character only counts as **confirmed** with evidence, the strongest
// first (`via`):
//
//   log     it was in the roster of a stored Warcraft-Logs evaluation of its
//           game version (the newest REPORTS_WALKED, reportStore), the class
//           cache saw it in a report (characterStore "report" / "wcl"), or the
//           raider took it over from the logs ("Mein Profil", `source: "log"`)
//   loot    the loot export named it (characterStore "export")
//   armory  the armory answered for it (`armory.fetchedAt` and a level — a link
//           alone is no answer)
//   orga    the orga found it in game and said so (`verifiedAt`)
//
// characterStore's own "manual" entries are an admin's class edit, never
// evidence. The game version counts (#741): a report knows its version, so a
// TBC "Gentle" is not evidenced by a Forever log of a "Gentle". The loot export
// and the class cache know no version — like everything from before versions
// their names count as TBC (the bare key, raiderProfileStore.characterKey).
//
// Pure reads; the index of what the logs and the loot saw is remembered for
// INDEX_TTL_MS, so a list of fifty requests walks the reports once.
const { listReports, getReportRoster } = require("../../stores/loot/reportStore");
const characterStore = require("../../stores/roster/characterStore");
const profiles = require("../../stores/roster/raiderProfileStore");

/** How many of the newest evaluations are walked (reportStore keeps as many rosters in its cache). */
const REPORTS_WALKED = 60;
const INDEX_TTL_MS = 10 * 1000;
/** Evidence from the class cache by its source; "manual" is none. */
const STORE_VIA = { export: "loot", report: "log", wcl: "log" };
/** The kinds of evidence, strongest first. */
const VIAS = ["log", "loot", "armory", "orga"];

let memo = null;

/**
 * `Map<characterKey, "log" | "loot">` — every character the stored evaluations
 * (with their version) and the class cache (as TBC) saw. "log" wins over "loot".
 */
function buildSeenIndex() {
    const index = new Map();
    const add = (key, via) => {
        if (!key) return;
        if (index.get(key) !== "log") index.set(key, via);
    };
    for (const meta of listReports().slice(0, REPORTS_WALKED)) {
        const report = getReportRoster(meta.id);
        for (const player of (report && report.roster) || []) {
            add(profiles.characterKey(player && player.name, meta.versionId), "log");
        }
    }
    for (const rec of characterStore.listCharacters()) {
        const via = STORE_VIA[rec.source];
        if (via) add(profiles.characterKey(rec.character || rec.key), via);
    }
    return index;
}

/** The seen index, built at most once per INDEX_TTL_MS. */
function seenIndex({ now = Date.now() } = {}) {
    if (!memo || now - memo.at > INDEX_TTL_MS || now < memo.at) memo = { at: now, index: buildSeenIndex() };
    return memo.index;
}

/** Forget the remembered index — tests, and right after something new was seen. */
function resetCache() {
    memo = null;
}

/** Whether the armory really answered (a time and a level), not only a link. */
function armoryAnswered(armory) {
    return !!(armory && Number(armory.fetchedAt) > 0 && Number(armory.level) > 0);
}

/**
 * The evidence that a profile character exists in game: `{ verified, via }`,
 * `via` one of VIAS ("" when unconfirmed). With `gameVersion` a character of
 * another version has none — a TBC bank's recipient needs a TBC character.
 * @param {object} character a profile character (raiderProfileStore)
 * @param {{ gameVersion?: string, index?: Map<string, string> }} [o]
 */
function characterEvidence(character, { gameVersion = "", index } = {}) {
    const none = { verified: false, via: "" };
    if (!character || typeof character !== "object" || !String(character.name || "").trim()) return none;
    const version = profiles.characterVersion(character.versionId);
    const wanted = String(gameVersion || "").trim();
    if (wanted && version !== wanted) return none;
    const seen = (index || seenIndex()).get(profiles.characterKey(character.name, version)) || "";
    if (character.source === "log" || seen === "log") return { verified: true, via: "log" };
    if (seen === "loot") return { verified: true, via: "loot" };
    if (armoryAnswered(character.armory)) return { verified: true, via: "armory" };
    if (Number(character.verifiedAt) > 0) return { verified: true, via: "orga" };
    return none;
}

/** Whether a profile character is confirmed (characterEvidence). */
function isVerified(character, o) {
    return characterEvidence(character, o).verified;
}

module.exports = { characterEvidence, isVerified, armoryAnswered, seenIndex, buildSeenIndex, resetCache, REPORTS_WALKED, INDEX_TTL_MS, VIAS };
