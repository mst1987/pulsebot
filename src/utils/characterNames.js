// The rule for a character name a raider types in (profile, Discord signup):
// letters only, 2–12 per name, first letter upper case — and in WoW Forever a
// first *and* a last name ("Vorname Nachname", 12 letters each), which the
// rule set switches on with `characterNames.lastName` (gameVersions/forever.js).
// Every name also passes the profanity filter (config/profanity.js), because
// it ends up in public Discord messages.
//
// Pure. Names read from logs or the armory are the game's own and never come
// through here — only what somebody typed.

const { rulesFor } = require("../config/gameVersions");
const { CONTAINS, PREFIX, EXACT } = require("../config/profanity");

const NAME_PART_MIN = 2;
const NAME_PART_MAX = 12;
// First name, a space, last name.
const NAME_MAX = NAME_PART_MAX * 2 + 1;

/**
 * Whether a version's characters carry a last name. No version (the web
 * profile, which is not tied to one) allows it; an unknown id as well.
 */
function allowsLastName(versionId) {
    if (!versionId) return true;
    const rules = rulesFor(versionId);
    return !rules || !!(rules.characterNames && rules.characterNames.lastName);
}

/** Lower case, accents stripped (ä → a, ß → ss), letters a–z only. */
function normalizeForCheck(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ø/g, "o")
        .normalize("NFD").replace(/\p{M}/gu, "")
        .replace(/[^a-z]/g, "");
}

/** "Fuuuck" → "fuck": a doubled letter must not slip past the list. */
function collapseRepeats(text) {
    return text.replace(/(.)\1+/g, "$1");
}

function hitsList(word) {
    return CONTAINS.some((w) => word.includes(w))
        || PREFIX.some((w) => word.startsWith(w))
        || EXACT.includes(word);
}

/**
 * True when a name — each part, and first + last name joined ("Hit Ler") —
 * carries a word of the profanity lists.
 */
function isProfane(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    const words = [...parts, parts.join("")].map(normalizeForCheck).filter(Boolean);
    return words.some((w) => hitsList(w) || hitsList(collapseRepeats(w)));
}

/** "vORNAME" → "Vorname", like the game writes it. */
function capitalize(part) {
    const chars = [...part.toLowerCase()];
    return chars.length ? chars[0].toUpperCase() + chars.slice(1).join("") : "";
}

/**
 * Check a typed character name. `versionId` decides whether a last name is
 * allowed (see allowsLastName); `lastName` overrides it.
 * @returns {{ name: string } | { error: string }}  the name as the game writes it, or why not
 */
function validateCharacterName(raw, { versionId = "", lastName } = {}) {
    const text = String(raw || "").trim().replace(/\s+/g, " ");
    if (!text) return { error: "Bitte einen Namen angeben." };
    const withLastName = lastName === undefined ? allowsLastName(versionId) : !!lastName;
    const parts = text.split(" ");
    if (parts.length > (withLastName ? 2 : 1)) {
        return {
            error: withLastName
                ? "Höchstens Vor- und Nachname – ein Leerzeichen dazwischen."
                : "Der Name darf kein Leerzeichen haben – Vor- und Nachname gibt es nur in WoW Forever.",
        };
    }
    for (const [i, part] of parts.entries()) {
        const label = parts.length === 1 ? "Der Name" : (i === 0 ? "Der Vorname" : "Der Nachname");
        if (!/^\p{L}+$/u.test(part)) return { error: `${label} darf nur Buchstaben haben.` };
        const length = [...part].length;
        if (length < NAME_PART_MIN) return { error: `${label} braucht mindestens ${NAME_PART_MIN} Buchstaben.` };
        if (length > NAME_PART_MAX) return { error: `${label} hat ${length} Buchstaben – höchstens ${NAME_PART_MAX}.` };
    }
    const name = parts.map(capitalize).join(" ");
    if (isProfane(name)) return { error: "Dieser Name ist nicht erlaubt – bitte einen anderen wählen." };
    return { name };
}

module.exports = {
    NAME_PART_MIN, NAME_PART_MAX, NAME_MAX,
    allowsLastName, normalizeForCheck, isProfane, validateCharacterName,
};
