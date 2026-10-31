// Linked characters of guild bank requests: the addon mails a hand-out to the
// request's `characterName`-`realm`, so a name that belongs to nobody sends the
// mail into the void. A request is **linked** when it has a raider (`userId`),
// its character (+ realm, when both sides name one) is a character in that
// raider's profile, AND that character is **confirmed** — it exists in game:
// seen in a log or the loot export, answered by the armory, or checked by the
// orga (services/characters/characterEvidence.js). A raider types any name at
// the signup ("Gentle" for the real "Gentleowl"); such a typed character alone
// links nothing. Checked now, every time: a character the raider deleted or
// renamed in "Mein Profil" makes the request unlinked again, a character
// confirmed later links it.
//
// The recipient's own evidence links a request, too (#806, recipientEvidence):
// a raider without a Discord account has no profile, the orga imports them by
// name — such a name counts when it was seen in a log of the bank's version
// or the loot export, or when the orga vouched for it (confirmed the request,
// or "Im Spiel geprüft" / "Geprüft & bestätigen", guildBankStore
// recipientCheckedAt). A confirmation the orga gave stays the orga's word: the
// addon's list never drops it later because a newer rule would not link it.
//
//   linkedCharacter    the profile character a request points at, or null
//   linkState          `{ linked, linkProblem: "" | "none" | "unverified", character, via }`
//   isLinked           linkState's `linked` (the orga card's "Bestätigen", the
//                      addon's hand-out list, the web's "nicht verknüpft" /
//                      "Charakter nicht bestätigt")
//   characterChoices   the profile characters of the bank's version as the web's
//                      link dialog offers them, each with its evidence: the
//                      confirmed ones first, the raider the name points at
//                      next, then the exact name, names containing it, near
//                      misses ("Whappap" finds "Whapap")
//   suggestedCharacters the confirmed characters a name from a sheet may mean
//                      when it is no confirmed character itself: its raider's
//                      other ones and the names it starts ("Gentle" →
//                      "Gentleowl", "Gentletwowl")
//   resolveChoice      a picked `userId` + `characterKey` as the request's new
//                      recipient fields, or null when the profile has no such character
//   versionError       a pick of another game version than the bank's: why it
//                      cannot be the bank's recipient (German), else ""
//   pickError          versionError, else why an unconfirmed pick cannot be linked
//
// The version decides (#741): a bank of one version only ever gets the
// characters of that version — Forever bank = Forever characters, TBC bank =
// TBC characters — and only evidence of that version counts. A character
// without a stored version counts as TBC (raiderProfileStore.characterVersion).
//
// Names are compared like the waiting list's import (foldName: no case, no
// accents), realms also without spaces, apostrophes and dashes ("Spine shatter"
// = "Spineshatter"). Pure reads of stores/roster/raiderProfileStore.js; writing the
// link is services/signups/guildBank.linkRequest (it redraws the orga card).
const profiles = require("../../stores/roster/raiderProfileStore");
const stockStore = require("../../stores/loot/guildBankStockStore");
const requestStore = require("../../stores/loot/guildBankStore");
const { characterEvidence, seenIndex } = require("../characters/characterEvidence");
const { CLASSES } = require("../../config/gameVersions/classes");
const { versionShort } = require("./stockView");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** How many characters the link dialog lists at most. */
const CHOICES_MAX = 30;
/** How many characters the import suggests for one name at most. */
const SUGGEST_MAX = 6;

/** A name as it is compared: no case, no accents, no outer spaces ("Alîna" → "alina"). */
function foldName(name) {
    return str(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").toLowerCase();
}

/** The edit distance (insert, delete, replace one letter) of two strings. */
function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return prev[b.length];
}

/** How many wrong letters a searched name may have: 2 at most and about a fifth of its length (none under 5 letters). */
const typoLimit = (key) => Math.min(2, Math.floor(key.length * 0.2));

/** A realm as it is compared: folded, without spaces, apostrophes and dashes. */
function foldRealm(realm) {
    return foldName(realm).replace(/[\s'’-]/g, "");
}

/** The stored profile of a raider, null when there is none (or it cannot be read). */
function profileOf(userId) {
    try {
        return profiles.getProfile(userId);
    } catch {
        return null;
    }
}

/** The game version a profile character plays (one without a stored version is TBC). */
const versionOfCharacter = (character) => profiles.characterVersion(character && character.versionId);

/** Whether a profile character plays `gameVersion`; every character does for "" (no version to keep to). */
function playsVersion(character, gameVersion) {
    const id = str(gameVersion);
    return !id || versionOfCharacter(character) === id;
}

/** The game version of the bank a request belongs to, "" when it names none (or the bank is gone). */
function bankVersionOf(request) {
    const key = str(request && request.bankKey);
    if (!key) return "";
    try {
        const bank = stockStore.listBanks().find((b) => b.key === key);
        return bank ? str(bank.gameVersion) : "";
    } catch {
        return "";
    }
}

/**
 * The profile character a request points at: its raider's character of the
 * request's name — and realm, when the request and the character both name
 * one; of several (a TBC and a Forever "Devi") the one of `gameVersion`. Null
 * without a raider, without a name, or when the profile has no such character
 * (any more).
 * @param {{ userId?: string, characterName?: string, realm?: string }} request
 * @param {{ profile?: object|null, gameVersion?: string }} [o] the raider's profile when the caller has it already
 */
function linkedCharacter(request, { profile, gameVersion = "" } = {}) {
    if (!request) return null;
    const userId = str(request.userId);
    const name = foldName(request.characterName);
    if (!userId || !name) return null;
    const p = profile === undefined ? profileOf(userId) : profile;
    const characters = p && Array.isArray(p.characters) ? p.characters : [];
    const realm = foldRealm(request.realm);
    const hits = characters.filter((c) => foldName(c.name) === name && (!realm || !str(c.realm) || foldRealm(c.realm) === realm));
    return hits.find((c) => playsVersion(c, gameVersion)) || hits[0] || null;
}

/**
 * Whether a request may go out and, when not, why — `{ linked, linkProblem,
 * character, via }`:
 *   linked true              its character is a profile character with evidence
 *                            (`via`, characterEvidence) of the bank's version —
 *                            or its recipient has its own (recipientEvidence:
 *                            "orga", "log", "loot"; `character` may be null)
 *   linkProblem "none"       no profile character at all (or no raider)
 *   linkProblem "unverified" a profile character nobody has confirmed — typed
 *                            by the raider, never seen in a log, the loot or
 *                            the armory, not checked by the orga ("Gentle")
 * `gameVersion` defaults to the request's bank's.
 * @param {object} request
 * @param {{ profile?: object|null, gameVersion?: string, index?: Map<string, string> }} [o]
 */
function linkState(request, { profile, gameVersion, index } = {}) {
    const version = gameVersion === undefined ? bankVersionOf(request) : str(gameVersion);
    const character = linkedCharacter(request, { profile, gameVersion: version });
    const evidence = character ? characterEvidence(character, { gameVersion: version, index }) : { verified: false, via: "" };
    if (evidence.verified) return { linked: true, linkProblem: "", character, via: evidence.via };
    // no (confirmed) profile character: the recipient's own evidence (#806)
    const own = recipientEvidence(request, { gameVersion: version, index });
    if (own.verified) return { linked: true, linkProblem: "", character, via: own.via };
    return { linked: false, linkProblem: character ? "unverified" : "none", character, via: "" };
}

/**
 * The evidence of a request's recipient by its own name (#806) — for a raider
 * without a Discord account (no profile at all) and for a name the orga stands
 * for: `{ verified, via }` with `via` "orga" (the orga vouched for it:
 * confirmed the request or checked the name in game, guildBankStore
 * recipientCheckedAt), else "log" / "loot" (the name was seen in a log of the
 * bank's version or the loot export, characterEvidence's index), else "bank"
 * (#809: this bank already handed something out to the name, receivedFromBank).
 * No name = none.
 * @param {object} request
 * @param {{ gameVersion?: string, index?: Map<string, string> }} [o]
 */
function recipientEvidence(request, { gameVersion = "", index } = {}) {
    const none = { verified: false, via: "" };
    const name = str(request && request.characterName);
    if (!name) return none;
    if (Number(request.recipientCheckedAt) > 0) return { verified: true, via: "orga" };
    const seen = (index || seenIndex()).get(profiles.characterKey(name, profiles.characterVersion(gameVersion))) || "";
    if (seen) return { verified: true, via: seen };
    return receivedFromBank(request) ? { verified: true, via: "bank" } : none;
}

/**
 * Whether the bank already handed something out to this name (#809): a
 * handed-out request of the same bank whose recipient is the same name (and
 * realm, when both name one) — the mail reached it, the character exists.
 */
function receivedFromBank(request) {
    const key = str(request && request.bankKey);
    const name = foldName(request && request.characterName);
    if (!key || !name) return false;
    const realm = foldRealm(request.realm);
    try {
        return requestStore.listRequests({ status: "handedOut" }).some((r) => r.id !== request.id && r.bankKey === key
            && foldName(r.characterName) === name && (!realm || !str(r.realm) || foldRealm(r.realm) === realm));
    } catch {
        return false;
    }
}

/** Whether a request's recipient is a confirmed character of its raider's profile (linkState). */
function isLinked(request, o) {
    return linkState(request, o).linked;
}

/** A request with `linked` and `linkProblem` added — the shape the web lists. */
function withLinked(request, o) {
    const state = linkState(request, o);
    return { ...request, linked: state.linked, linkProblem: state.linkProblem };
}

const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

/** A character's look in the dialog: the first spec's icon (else the class's), the class colour. */
function lookOf(character) {
    const cls = CLASS_BY_ID.get(character.className);
    const spec = character.specs && character.specs[0] ? profiles.specInfo(character.specs[0].key) : null;
    return {
        icon: (spec && spec.icon) || (cls && cls.icon) || "",
        classColor: (cls && cls.color) || "",
        specKey: spec ? character.specs[0].key : "",
    };
}

/** One profile character as the link dialog offers it, with its evidence (`verified`, `evidence` = the via). */
function choiceOf(profile, character, evidence = { verified: false, via: "" }) {
    return {
        userId: profile.userId,
        userName: profile.name || character.name,
        characterKey: character.key,
        characterName: character.name,
        realm: character.realm || "",
        className: character.className,
        versionId: versionOfCharacter(character),
        ...lookOf(character),
        verified: !!evidence.verified,
        evidence: evidence.via || "",
    };
}

/**
 * The raiders a name points at: whose profile is called so, or who has an
 * unconfirmed character of exactly that name (of `gameVersion`) — "Gentle"
 * typed at a signup. Their other characters are the likely real ones.
 */
function ownersOf(list, key, gameVersion, index) {
    if (!key) return new Set();
    const typed = (c) => foldName(c.name) === key && playsVersion(c, gameVersion) && !characterEvidence(c, { gameVersion, index }).verified;
    return new Set(list
        .filter((p) => foldName(p.name) === key || (p.characters || []).some(typed))
        .map((p) => p.userId));
}

/**
 * The characters of the raider profiles a request of a bank of `gameVersion`
 * can be linked to — only that version's, never one of another (#741; "" =
 * every version) — matching `query` in the character's or the raider's name
 * (folded; empty = all), a character name within typoLimit of it, or any
 * character of a raider the name points at (ownersOf). Each with its evidence;
 * the order: confirmed first, then the raider the name points at, the exact
 * name, names containing the query before the near misses, names starting
 * with it, then by name.
 * @param {{ query?: string, gameVersion?: string, limit?: number, list?: object[], index?: Map<string, string> }} [o]
 */
function characterChoices({ query = "", gameVersion = "", limit = CHOICES_MAX, list, index } = {}) {
    const q = foldName(query);
    const limitTypos = typoLimit(q);
    const seen = index || seenIndex();
    const pool = list || profiles.listProfiles();
    const owners = ownersOf(pool, q, gameVersion, seen);
    const all = [];
    for (const p of pool) {
        const own = owners.has(p.userId);
        for (const c of p.characters || []) {
            if (!playsVersion(c, gameVersion)) continue;
            const name = foldName(c.name);
            const hit = !q || own || name.includes(q) || foldName(p.name).includes(q);
            const near = !hit && limitTypos > 0 && Math.abs(name.length - q.length) <= limitTypos && levenshtein(name, q) <= limitTypos;
            if (!hit && !near) continue;
            all.push({ choice: choiceOf(p, c, characterEvidence(c, { gameVersion, index: seen })), name, near, own });
        }
    }
    const rank = ({ choice, name, near, own }) => [
        choice.verified ? 0 : 1, own ? 0 : 1, name === q ? 0 : 1, near ? 1 : 0, q && name.startsWith(q) ? 0 : 1,
    ];
    all.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
        return a.choice.characterName.localeCompare(b.choice.characterName) || a.choice.userName.localeCompare(b.choice.userName);
    });
    return all.slice(0, Math.max(1, Math.min(CHOICES_MAX, Number(limit) || CHOICES_MAX))).map((x) => x.choice);
}

/**
 * The confirmed characters of `gameVersion` a name (from a sheet) may mean
 * when it is no confirmed character itself: the other characters of the
 * raider(s) the name points at (ownersOf — the raider of the unconfirmed
 * "Gentle"), then characters whose name starts with it ("Gentle" →
 * "Gentleowl"). Never the unconfirmed ones. In the import's candidate shape
 * `{ userId, userName, characterKey, characterName, realm, className }`.
 * @param {string} name
 * @param {{ gameVersion?: string, list?: object[], index?: Map<string, string>, max?: number }} [o]
 */
function suggestedCharacters(name, { gameVersion = "", list, index, max = SUGGEST_MAX } = {}) {
    const key = foldName(name);
    if (!key) return [];
    const seen = index || seenIndex();
    const pool = list || profiles.listProfiles();
    const owners = ownersOf(pool, key, gameVersion, seen);
    const out = [];
    for (const p of pool) {
        const own = owners.has(p.userId);
        for (const c of p.characters || []) {
            if (!playsVersion(c, gameVersion)) continue;
            const folded = foldName(c.name);
            if (!own && !(folded.startsWith(key) && folded !== key)) continue;
            if (!characterEvidence(c, { gameVersion, index: seen }).verified) continue;
            out.push({ own, p, c });
        }
    }
    out.sort((a, b) => (Number(b.own) - Number(a.own)) || a.c.name.localeCompare(b.c.name));
    return out.slice(0, max).map(({ p, c }) => ({
        userId: p.userId, userName: p.name || c.name, characterKey: c.key, characterName: c.name, realm: c.realm || "", className: c.className || "",
    }));
}

/**
 * A picked character as a request's recipient: `{ userId, userName,
 * characterName, realm ("" = the bank's) }`, or null when that raider's
 * profile has no character with this key.
 */
function resolveChoice(userId, characterKey) {
    const found = pickedCharacter(userId, characterKey);
    if (!found) return null;
    const { uid, profile: p, character: c } = found;
    return { userId: uid, userName: p.name || c.name, characterName: c.name, realm: c.realm || "" };
}

/** The raider's profile character with this key: `{ uid, profile, character }`, or null. */
function pickedCharacter(userId, characterKey) {
    const uid = str(userId);
    const key = str(characterKey);
    if (!uid || !key) return null;
    const p = profileOf(uid);
    const c = p && (p.characters || []).find((ch) => ch.key === key);
    return c ? { uid, profile: p, character: c } : null;
}

/** A picked character as the link dialog shows it (with its evidence for `gameVersion`), or null. */
function choiceFor(userId, characterKey, gameVersion = "") {
    const found = pickedCharacter(userId, characterKey);
    if (!found) return null;
    return choiceOf(found.profile, found.character, characterEvidence(found.character, { gameVersion }));
}

/**
 * Why a picked profile character cannot be the recipient of a bank of
 * `gameVersion` (#741): it plays another version — German, for the orga.
 * "" when it plays the bank's version, when there is no such character (the
 * caller says that in its own words) or no version to keep to.
 */
function versionError(userId, characterKey, gameVersion) {
    const found = pickedCharacter(userId, characterKey);
    if (!found || playsVersion(found.character, gameVersion)) return "";
    const own = versionShort(versionOfCharacter(found.character));
    const bank = versionShort(gameVersion);
    return `${found.character.name} ist ein ${own}-Charakter – diese Gildenbank ist für ${bank}. Bitte einen ${bank}-Charakter wählen.`;
}

/**
 * Why a picked profile character cannot be linked to a request of a bank of
 * `gameVersion`: versionError, else it is not confirmed (characterEvidence) —
 * German, "" when it can (or there is no such character).
 */
function pickError(userId, characterKey, gameVersion) {
    const version = versionError(userId, characterKey, gameVersion);
    if (version) return version;
    const found = pickedCharacter(userId, characterKey);
    if (!found || characterEvidence(found.character, { gameVersion }).verified) return "";
    return `${found.character.name} ist nicht bestätigt – erst im Arsenal oder im Spiel prüfen, dann verknüpfen.`;
}

module.exports = {
    CHOICES_MAX, SUGGEST_MAX, foldName, foldRealm, levenshtein, typoLimit, linkedCharacter, linkState, recipientEvidence, receivedFromBank, isLinked, withLinked,
    characterChoices, suggestedCharacters, resolveChoice, choiceFor, playsVersion, versionError, pickError,
};
