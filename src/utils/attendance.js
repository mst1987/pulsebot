// Compare who is expected at an event (members holding a raid role) against who
// has reacted to the Raid-Helper signup. "Reacted" means the user appears in the
// event's signUps at all — signing up OR off (Absence/Tentative/Bench all count).
// Only members who have not reacted at all are considered "missing".

const { specProfile, characterProfile } = require("./setupView");

// specName values that mark a non-attendance reaction (signed off), not a real
// class/spec — must not be looked up as one when building spec history.
const NON_ATTENDING_SPECS = new Set(["Absence"]);

/**
 * Split expected members into those who reacted and those still missing.
 * @param {{id:string, displayName?:string}[]} members expected raiders (role holders)
 * @param {{userId:string}[]} signUps the event's Raid-Helper signups
 * @returns {{ responded: object[], missing: object[] }}
 */
function computeAttendance(members = [], signUps = []) {
    const respondedIds = new Set(
        (signUps || []).map((s) => s && s.userId).filter(Boolean).map(String)
    );
    const responded = [];
    const missing = [];
    for (const m of members || []) {
        if (!m || !m.id) continue;
        if (respondedIds.has(String(m.id))) responded.push(m);
        else missing.push(m);
    }
    return { responded, missing };
}

/**
 * Build a per-user "last known class/spec" lookup from past events' signups,
 * so members who haven't reacted to the *current* event yet (and therefore
 * have no specName of their own) can still be shown with their class/spec/
 * colour from the most recent event they did sign up for.
 * @param {{startTime?:number, signUps?:{userId:string, specName?:string}[]}[]} events
 * @returns {Object<string,string>} userId -> specName (most recent real spec)
 */
function buildSpecHistory(events = []) {
    const sorted = [...(events || [])].sort(
        (a, b) => (Number(b && b.startTime) || 0) - (Number(a && a.startTime) || 0)
    );
    const history = {};
    for (const ev of sorted) {
        for (const s of (ev && ev.signUps) || []) {
            if (!s || !s.userId || !s.specName) continue;
            if (NON_ATTENDING_SPECS.has(s.specName)) continue;
            if (!(s.userId in history)) history[s.userId] = s.specName;
        }
    }
    return history;
}

/**
 * Attach a `.profile` (class/spec/colour/icon) to each member for whom a spec
 * is known in `specHistory`, leaving members without any history untouched.
 * @param {{id:string}[]} people
 * @param {Object<string,string>} specHistory as returned by buildSpecHistory()
 */
function withSpecProfiles(people, specHistory = {}) {
    return (people || []).map((p) => {
        if (!p || !p.id) return p;
        const spec = specHistory[p.id];
        const profile = spec ? specProfile(spec) : null;
        return profile ? { ...p, profile } : p;
    });
}

/**
 * Attach a `.character` (name) and, when its class is known, an overriding
 * `.profile` to each member with a manual raider->character assignment for
 * this raid category (see raiderCharactersStore.js) — takes priority over
 * the guessed `.profile` from withSpecProfiles() since it's admin-confirmed.
 * Members without an assignment are left untouched.
 * @param {{id:string, profile?:object}[]} people
 * @param {Object<string,{character:string, className?:string, spec?:string}>} assignmentProfiles
 *   userId -> already-resolved assignment (the character name plus its class/spec, if known)
 */
function withCharacterAssignments(people, assignmentProfiles = {}) {
    return (people || []).map((p) => {
        if (!p || !p.id) return p;
        const a = assignmentProfiles[p.id];
        if (!a) return p;
        const profile = a.className ? characterProfile(a.className, a.spec) : null;
        return { ...p, character: a.character, profile: profile || p.profile || null };
    });
}

module.exports = {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
};
