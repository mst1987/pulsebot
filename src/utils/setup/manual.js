// A setup the orga changed by hand (#263): check it against the hard rules
// before it is valued and stored. Pure — the caller hands in the event and the
// signups it collected (setupInput.collectSetupInput).
//
// What is refused, with a German message the editor can show as it is:
//   - a group index outside the raid (25 players = groups 1–5),
//   - more than five in a group, more raiders than the raid holds,
//   - the same raider twice (in two groups, or in a group and on the bench),
//   - a raider without a signup, or one who signed off,
//   - a spec of another class than the one the raider signed up with, or a
//     role that spec cannot play.
// What is *not* refused is whatever only makes the setup worse — too few
// healers, a missing buff: that is the checks' business, and the orga may know
// better. The same line the proposal draws (see docs/setup.md, "Setup-Vorschlag").

const { rulesFor, DEFAULT_VERSION, ROLES } = require("../../config/gameVersions");
const { GROUP_SIZE, signupCharacters } = require("./model");
const { str } = require("../text");


/**
 * Every slot of a group with a place of its own, 1…5 (`pos`): a slot that names
 * a free one keeps it, the others take the lowest free places in their order —
 * so a group of two may stand on places 1 and 5. Sorted by place. Slots from
 * before the places existed (a proposal, an old draft) come out 1, 2, 3 …
 */
function placeSlots(slots) {
    const used = new Set();
    const out = (slots || []).map((s) => {
        const p = Math.floor(Number(s.pos));
        if (p >= 1 && p <= GROUP_SIZE && !used.has(p)) {
            used.add(p);
            return { ...s, pos: p };
        }
        return { ...s, pos: 0 };
    });
    for (const s of out) {
        if (s.pos) continue;
        let p = 1;
        while (used.has(p)) p++;
        used.add(p);
        s.pos = p;
    }
    return out.sort((a, b) => a.pos - b.pos);
}

/**
 * @param {object} raw     `{ groups: [{ index, slots: [{ userId, spec?, role?, locked? }] }], bench: [{ userId, locked? }] }`
 * @param {object} ctx     `{ event: { size, versionId }, signups: signupStore rows of the event }`
 * @returns {{ value?: { groups: object[], bench: object[] }, error?: string }}
 */
function validatePlacement(raw, { event, signups } = {}) {
    const rules = rulesFor((event && event.versionId) || DEFAULT_VERSION) || rulesFor(DEFAULT_VERSION);
    const size = Math.max(0, Number(event && event.size) || 0);
    const groupCount = Math.max(1, Math.ceil(size / GROUP_SIZE));
    const specs = new Map();
    for (const c of rules.classes) for (const s of c.specs) specs.set(s.key, s);
    const signupOf = new Map((Array.isArray(signups) ? signups : []).map((s) => [str(s.userId), s]));
    const input = raw && typeof raw === "object" ? raw : {};
    const seen = new Set();
    const label = (userId) => {
        const s = signupOf.get(userId);
        return (s && s.character) || userId;
    };

    /** The signup of a raider who may be placed at all, or an error. */
    function signed(userId) {
        if (!userId) return { error: "Ein Platz ohne Raider." };
        if (seen.has(userId)) return { error: `${label(userId)} steht zweimal im Setup.` };
        seen.add(userId);
        const signup = signupOf.get(userId);
        if (!signup) return { error: `${userId} ist für dieses Event nicht angemeldet.` };
        if (signup.status === "absence") return { error: `${label(userId)} hat sich abgemeldet.` };
        return { signup };
    }

    const groups = [];
    let placed = 0;
    const groupIndexes = new Set();
    for (const g of Array.isArray(input.groups) ? input.groups : []) {
        const index = Math.floor(Number(g && g.index));
        if (!Number.isFinite(index) || index < 1 || index > groupCount) {
            return { error: `Gruppe ${g && g.index} gibt es in einem Raid mit ${size} Plätzen nicht.` };
        }
        if (groupIndexes.has(index)) return { error: `Gruppe ${index} ist doppelt angegeben.` };
        groupIndexes.add(index);
        const slots = [];
        for (const s of Array.isArray(g.slots) ? g.slots : []) {
            const userId = str(s && s.userId);
            const hit = signed(userId);
            if (hit.error) return { error: hit.error };
            const specKey = str(s.spec) || str(hit.signup.spec);
            const spec = specs.get(specKey);
            if (!spec) return { error: `${label(userId)}: unbekannte Spezialisierung „${specKey}“.` };
            // Any of the named characters (#293) may be placed — on a spec of its class.
            const named = signupCharacters(hit.signup)
                .map((c) => ({ character: str(c.character), info: specs.get(str(c.spec)) }))
                .filter((c) => c.info);
            const ofClass = named.filter((c) => c.info.classId === spec.classId);
            if (named.length && !ofClass.length) {
                const classes = [...new Set(named.map((c) => c.info.classId))].join("/");
                return { error: `${label(userId)} ist als ${classes} angemeldet, nicht als ${spec.classId}.` };
            }
            const wanted = str(s.character).toLowerCase();
            const pick = ofClass.find((c) => c.character.toLowerCase() === wanted) || ofClass[0];
            const character = pick ? pick.character : str(s.character);
            let role = str(s.role) || spec.role;
            if (!ROLES.includes(role)) return { error: `${label(userId)}: unbekannte Rolle „${role}“.` };
            const fits = role === spec.role || (role === "tank" && spec.canTank) || (role === "healer" && spec.canHeal);
            if (!fits) role = spec.role;
            slots.push({ userId, character, spec: spec.key, role, locked: s.locked === true, pos: s.pos });
        }
        if (slots.length > GROUP_SIZE) return { error: `Gruppe ${index} hat mehr als ${GROUP_SIZE} Plätze.` };
        placed += slots.length;
        groups.push({ index, slots: placeSlots(slots) });
    }
    if (placed > size) return { error: `Mehr Raider (${placed}) als der Raid Plätze hat (${size}).` };

    const bench = [];
    for (const b of Array.isArray(input.bench) ? input.bench : []) {
        const userId = str(b && b.userId);
        const hit = signed(userId);
        if (hit.error) return { error: hit.error };
        bench.push({ userId, locked: b.locked === true });
    }
    groups.sort((a, b) => a.index - b.index);
    return { value: { groups, bench } };
}

module.exports = { validatePlacement, placeSlots };
