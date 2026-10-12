// Linked characters of guild bank requests: the addon mails a hand-out to the
// request's `characterName`-`realm`, so a name that belongs to nobody sends the
// mail into the void. A request is **linked** when it has a raider (`userId`)
// and its character (+ realm, when both sides name one) is a character in that
// raider's profile — checked now, every time: a character the raider deleted or
// renamed in "Mein Profil" makes the request unlinked again.
//
//   linkedCharacter   the profile character a request points at, or null
//   isLinked          whether there is one (the orga card's "Bestätigen", the
//                     addon's hand-out list, the web's "nicht verknüpft")
//   characterChoices  the profile characters of the bank's version as the web's
//                     link dialog offers them, searched by character or raider
//                     name — also a name a typo or two away, since the search
//                     starts with the name from the sheet ("Whappap" finds
//                     "Whapap")
//   resolveChoice     a picked `userId` + `characterKey` as the request's new
//                     recipient fields, or null when the profile has no such character
//   versionError      a pick of another game version than the bank's: why it
//                     cannot be the bank's recipient (German), else ""
//
// The version decides (#741): a bank of one version only ever gets the
// characters of that version — Forever bank = Forever characters, TBC bank =
// TBC characters. A character without a stored version counts as TBC
// (raiderProfileStore.characterVersion).
//
// Names are compared like the waiting list's import (foldName: no case, no
// accents), realms also without spaces, apostrophes and dashes ("Spine shatter"
// = "Spineshatter"). Pure reads of stores/raiderProfileStore.js; writing the
// link is services/signups/guildBank.linkRequest (it redraws the orga card).
const profiles = require("../../stores/raiderProfileStore");
const { CLASSES } = require("../../config/gameVersions/classes");
const { versionShort } = require("./stockView");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** How many characters the link dialog lists at most. */
const CHOICES_MAX = 30;

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

/**
 * The profile character a request points at: its raider's character of the
 * request's name — and realm, when the request and the character both name
 * one. Null without a raider, without a name, or when the profile has no such
 * character (any more).
 * @param {{ userId?: string, characterName?: string, realm?: string }} request
 * @param {{ profile?: object|null }} [o] the raider's profile when the caller has it already
 */
function linkedCharacter(request, { profile } = {}) {
    if (!request) return null;
    const userId = str(request.userId);
    const name = foldName(request.characterName);
    if (!userId || !name) return null;
    const p = profile === undefined ? profileOf(userId) : profile;
    const characters = p && Array.isArray(p.characters) ? p.characters : [];
    const realm = foldRealm(request.realm);
    return characters.find((c) => foldName(c.name) === name && (!realm || !str(c.realm) || foldRealm(c.realm) === realm)) || null;
}

/** Whether a request's recipient is a character of its raider's profile. */
function isLinked(request, o) {
    return !!linkedCharacter(request, o);
}

/** A request with `linked` added — the shape the web lists. */
function withLinked(request) {
    return { ...request, linked: isLinked(request) };
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

/** The game version a profile character plays (one without a stored version is TBC). */
const versionOfCharacter = (character) => profiles.characterVersion(character && character.versionId);

/** Whether a profile character plays `gameVersion`; every character does for "" (no version to keep to). */
function playsVersion(character, gameVersion) {
    const id = str(gameVersion);
    return !id || versionOfCharacter(character) === id;
}

/** One profile character as the link dialog offers it. */
function choiceOf(profile, character) {
    return {
        userId: profile.userId,
        userName: profile.name || character.name,
        characterKey: character.key,
        characterName: character.name,
        realm: character.realm || "",
        className: character.className,
        versionId: versionOfCharacter(character),
        ...lookOf(character),
    };
}

/**
 * The characters of the raider profiles a request of a bank of `gameVersion`
 * can be linked to — only that version's, never one of another (#741; "" =
 * every version) — matching `query` in the character's or the raider's name
 * (folded; empty = all), or a character name within typoLimit of it. Exact
 * name first, then the names that contain the query (before the near misses),
 * then names that start with the query, then by name.
 * @param {{ query?: string, gameVersion?: string, limit?: number, list?: object[] }} [o]
 */
function characterChoices({ query = "", gameVersion = "", limit = CHOICES_MAX, list } = {}) {
    const q = foldName(query);
    const limitTypos = typoLimit(q);
    const all = [];
    for (const p of list || profiles.listProfiles()) {
        for (const c of p.characters || []) {
            if (!playsVersion(c, gameVersion)) continue;
            const name = foldName(c.name);
            const hit = !q || name.includes(q) || foldName(p.name).includes(q);
            const near = !hit && limitTypos > 0 && Math.abs(name.length - q.length) <= limitTypos && levenshtein(name, q) <= limitTypos;
            if (!hit && !near) continue;
            all.push({ choice: choiceOf(p, c), name, near });
        }
    }
    const rank = ({ name, near }) => [name === q ? 0 : 1, near ? 1 : 0, q && name.startsWith(q) ? 0 : 1];
    all.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
        return a.choice.characterName.localeCompare(b.choice.characterName) || a.choice.userName.localeCompare(b.choice.userName);
    });
    return all.slice(0, Math.max(1, Math.min(CHOICES_MAX, Number(limit) || CHOICES_MAX))).map((x) => x.choice);
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

module.exports = {
    CHOICES_MAX, foldName, foldRealm, levenshtein, typoLimit, linkedCharacter, isLinked, withLinked, characterChoices, resolveChoice,
    playsVersion, versionError,
};
