// A Raid-Helper event's line-up in the shape the raid plan reads from an own event's approved setup
// ({ groups: [{ index, slots: [{ userId, character, spec, role, classId, rhName, nameFromRh }] }], bench }), so raidplan.rosterFrom()
// builds its roster from it unchanged (docs/raidplan.md, "Raid-Helper-Events"). Two inputs:
//   - the Raid-Helper Aufstellung (GET /api/raidplan/<id> -> `slots`, classes/raidhelper.js getSetup): { id, name, className, specName,
//     groupNumber } per placed raider; the group comes from `groupNumber`, else 5 per group by position (like utils/setupView.js
//     groupOf) - `hasGroups` says which;
//   - without an Aufstellung, the event's signups ({ userId, name, className, specName, status }): the signed-up raiders in their order,
//     in blocks of five; bench goes to `bench`, absence / tentative / late are not placed.
// Class and spec ALWAYS come from Raid-Helper. The name Raid-Helper shows is not necessarily a character name (often a Discord nickname):
// characterFor() looks for the raider's character in his profile (docs/roster-profile.md) and falls back to the Raid-Helper name, marked.
// A spec the rule set does not know (a death knight, a typo) keeps its place with an empty spec and is listed in `unknown` - the raid
// plan then sees no role for it and never guesses a class.
const { specKeyFromRaidHelper } = require("./eventSources");
const { signupStatus } = require("../utils/attendance");
const { str } = require("../utils/text");

const nameKey = (name) => str(name).split("-")[0].toLowerCase();

/**
 * The character a Raid-Helper raider plays, for showing only (class and spec stay Raid-Helper's): a) a character of his profile (found
 * by his Discord id) of the class Raid-Helper names - his main when it is one, else the first; b) else the character of his profile
 * named like the Raid-Helper name; c) else the Raid-Helper name itself, marked `fromRh` (it may be a nickname, not a character).
 * `rh` = { name, classId }; `profile` = raiderProfileStore's record ({ characters: [{ name, className, main }] }) or null.
 */
function characterFor(rh, profile) {
    const rhName = str(rh && rh.name);
    const classId = str(rh && rh.classId);
    const chars = profile && Array.isArray(profile.characters) ? profile.characters.filter((c) => c && str(c.name)) : [];
    const ofClass = classId ? chars.filter((c) => c.className === classId) : [];
    const pick = ofClass.find((c) => c.main) || ofClass[0];
    if (pick) return { character: str(pick.name), fromRh: false, rhName };
    const same = rhName ? chars.find((c) => nameKey(c.name) === nameKey(rhName)) : null;
    if (same) return { character: str(same.name), fromRh: false, rhName };
    return { character: rhName, fromRh: true, rhName };
}

// classes of later game versions: their spec names ("Frost", "Blood") must not be read as a mage's or anybody's spec
const FOREIGN_CLASS = /^(death\s*knight|deathknight|dk|evoker|monk|demon\s*hunter|demonhunter|dh)$/i;

/** One Raid-Helper slot / signup as a setup slot; `profileOf(userId)` gives the raider's profile (or null). */
function toSlot(s, profileOf) {
    const spec = FOREIGN_CLASS.test(str(s.className)) ? "" : specKeyFromRaidHelper(s.className, s.specName);
    const userId = str(s.id || s.userId || s.userid);
    const classId = spec ? spec.split("-")[0] : "";
    let profile = null;
    try { profile = profileOf && userId ? profileOf(userId) : null; } catch { profile = null; }
    const who = characterFor({ name: s.name || s.charName || s.characterName, classId }, profile);
    return {
        userId,
        character: who.character,
        spec,
        classId,
        // Raid-Helper names no role of its own: the spec's role decides (raidplan.resolveRole)
        role: "",
        rhName: who.rhName,
        nameFromRh: who.fromRh,
    };
}

const groupNumberOf = (s) => parseInt(s && (s.group !== undefined ? s.group : s.groupNumber), 10);
const hasGroupNumber = (s) => { const n = groupNumberOf(s); return Number.isInteger(n) && n >= 1; };

/** The group of an Aufstellung slot: its `groupNumber`, else 5 per group by position. */
function groupOf(s, index) {
    return hasGroupNumber(s) ? groupNumberOf(s) : Math.floor(index / 5) + 1;
}

/**
 * The line-up of a Raid-Helper event: from its Aufstellung when there is one (`setupSlots`), else from its signups. `source` says which
 * ("raidplan" | "signups" | "none"); `hasGroups` whether Raid-Helper named the groups (else they are blocks of five in order);
 * `unknown` lists the Raid-Helper spec names the rule set could not map; `unmatchedNames` how many placed names no profile knew.
 */
function raidhelperLineup({ setupSlots = [], signUps = [], profileOf = null } = {}) {
    const unknown = [];
    let unmatchedNames = 0;
    const note = (s, slot) => {
        if (!slot.spec) unknown.push(str(s.specName || s.className) || "?");
        if (slot.nameFromRh) unmatchedNames += 1;
    };
    const groups = new Map();
    const push = (index, slot) => { if (!groups.has(index)) groups.set(index, []); groups.get(index).push(slot); };
    const sorted = () => [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([index, slots]) => ({ index, slots }));
    const placed = (setupSlots || []).map((s, i) => ({ s, i })).filter(({ s }) => s && str(s.name || s.charName || s.characterName) && str(s.id || s.userId || s.userid));
    if (placed.length > 0) {
        const seen = new Set();
        for (const { s, i } of placed) {
            const slot = toSlot(s, profileOf);
            // a raider twice in the Aufstellung stands in his first place
            if (seen.has(slot.userId)) continue;
            seen.add(slot.userId);
            note(s, slot);
            push(groupOf(s, i), slot);
        }
        return { source: "raidplan", hasGroups: placed.every(({ s }) => hasGroupNumber(s)), groups: sorted(), bench: [], unknown, unmatchedNames };
    }
    const bench = [];
    const seen = new Set();
    let n = 0;
    for (const s of signUps || []) {
        const userId = str(s && s.userId);
        // several reactions of one raider: the first counts
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        const status = signupStatus(s);
        if (status === "absence") continue;
        const slot = toSlot(s, profileOf);
        if (status !== "signed") { if (status === "bench") bench.push(slot); continue; }
        note(s, slot);
        push(Math.floor(n / 5) + 1, slot);
        n += 1;
    }
    const list = sorted();
    return { source: list.length || bench.length ? "signups" : "none", hasGroups: false, groups: list, bench, unknown, unmatchedNames };
}

module.exports = { raidhelperLineup, toSlot, characterFor };
