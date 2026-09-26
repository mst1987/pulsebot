// "Meine Charaktere" for the bot's lookups (/loot ich, /anwesenheit — #265): the
// raid lead's raider→character assignment (per category) plus the characters the
// raider entered in their own profile (#255). One entry per character; the
// assignment comes first, since it is the one the raid lead confirmed.
const { charactersForUser } = require("../../stores/raiderCharactersStore");
const profiles = require("../../stores/raiderProfileStore");

/** @returns {{ character: string, categoryIds: string[] }[]} */
function myCharacters(userId) {
    const out = charactersForUser(userId);
    const seen = new Set(out.map((c) => c.character.toLowerCase()));
    let profile;
    try {
        profile = profiles.getProfile(userId);
    } catch {
        profile = null;
    }
    for (const c of (profile && profile.characters) || []) {
        const name = String((c && c.name) || "").trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ character: name, categoryIds: [] });
    }
    return out;
}

module.exports = { myCharacters };
