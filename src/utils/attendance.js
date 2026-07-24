// Compare who is expected at an event (members holding a raid role) against who
// has reacted to the Raid-Helper signup. "Reacted" means the user appears in the
// event's signUps at all — signing up OR off (Absence/Tentative/Bench all count).
// Only members who have not reacted at all are considered "missing".

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

module.exports = { computeAttendance };
