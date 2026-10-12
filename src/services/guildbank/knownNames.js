// Character names the guild bank knows besides the raider profiles (#809):
// the orga sometimes has to send a request to a character nobody put into a
// profile — "Gentletwowl", the raider's real character, while the request says
// the typed "Gentle"; a raider without a Discord account has no profile at all.
// The link dialog offers these names next to the profile characters:
//
//   bank   this bank already handed something out to the name (a handed-out
//          request) — the mail reached it
//   log    the name is in a stored Warcraft-Logs evaluation of the bank's
//          version (characterEvidence's index)
//   loot   the loot export named it (the same index, TBC only)
//
// Every such name has evidence (linking.recipientEvidence counts the same
// sources), so the orga may take it as the recipient without a further check.
// Names that are profile characters of the version are left out — the dialog
// lists those with their raider already. Pure reads.
const store = require("../../stores/guildBankStore");
const profiles = require("../../stores/raiderProfileStore");
const { seenIndex } = require("../characters/characterEvidence");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const linking = require("./linking");

/** How many names one search answers at most. */
const NAMES_MAX = 8;
/** The order of the sources, strongest for the guild bank first. */
const VIA_RANK = { bank: 0, log: 1, loot: 2 };
const VERSION_KEY_SEP = "~";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** "gentle twowl" → "Gentle Twowl": a key back to the name as the game writes it. */
function nameOfKey(key) {
    return key.split(" ").map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join(" ");
}

/** Whether a folded name fits a folded query: contains it, or is within typoLimit of it. */
function fits(name, q) {
    if (!q) return false;
    if (name.includes(q)) return true;
    const limit = linking.typoLimit(q);
    return limit > 0 && Math.abs(name.length - q.length) <= limit && linking.levenshtein(name, q) <= limit;
}

/**
 * The names of the seen index (logs, loot) for one game version: the bare
 * keys are TBC, a prefixed key ("forever~devi res") the prefix's version.
 */
function seenNames(index, gameVersion) {
    const version = profiles.characterVersion(gameVersion);
    const out = [];
    for (const [key, via] of index) {
        const at = key.indexOf(VERSION_KEY_SEP);
        const keyVersion = at === -1 ? profiles.characterVersion("") : key.slice(0, at);
        if (keyVersion !== version) continue;
        out.push({ name: nameOfKey(nameKeyOf(key)), realm: "", via });
    }
    return out;
}

/** The names this bank handed something out to, newest hand-out first. */
function bankNames(bankKey) {
    return store.listRequests({ status: "handedOut" })
        .filter((r) => r.bankKey === bankKey && str(r.characterName))
        .sort((a, b) => (b.handedOutAt || 0) - (a.handedOutAt || 0))
        .map((r) => ({ name: r.characterName, realm: r.realm || "", via: "bank" }));
}

/**
 * The known names of a bank (of `gameVersion`) that fit `query`: `[{ name,
 * realm, via }]`, each name once (its strongest source), without the profile
 * characters of the version — bank first, then the exact name, then names
 * starting with the query, then by name. An empty query answers [].
 * @param {string} bankKey
 * @param {{ query?: string, gameVersion?: string, limit?: number, index?: Map<string, string>, list?: object[] }} [o]
 */
function knownNames(bankKey, { query = "", gameVersion = "", limit = NAMES_MAX, index, list } = {}) {
    const q = linking.foldName(query);
    if (!q) return [];
    const inProfiles = new Set();
    for (const p of list || profiles.listProfiles()) {
        for (const c of p.characters || []) if (linking.playsVersion(c, gameVersion)) inProfiles.add(linking.foldName(c.name));
    }
    const best = new Map();
    for (const hit of [...bankNames(str(bankKey)), ...seenNames(index || seenIndex(), gameVersion)]) {
        const key = linking.foldName(hit.name);
        if (!key || inProfiles.has(key) || !fits(key, q)) continue;
        const had = best.get(key);
        if (!had || VIA_RANK[hit.via] < VIA_RANK[had.via]) best.set(key, { ...hit, realm: hit.realm || (had && had.realm) || "" });
    }
    const rank = (n) => {
        const key = linking.foldName(n.name);
        return [VIA_RANK[n.via], key === q ? 0 : 1, key.startsWith(q) ? 0 : 1];
    };
    return [...best.values()]
        .sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
            return a.name.localeCompare(b.name);
        })
        .slice(0, Math.max(1, Math.min(NAMES_MAX, Number(limit) || NAMES_MAX)));
}

module.exports = { NAMES_MAX, knownNames, nameOfKey, seenNames, bankNames };
