// Small raid rosters for the setup proposal tests.

let counter = 0;

/** A signup; `id` doubles as user id and (capitalised) character name. */
function su(id, spec, extra = {}) {
    counter++;
    return {
        userId: id,
        character: id.charAt(0).toUpperCase() + id.slice(1),
        spec,
        status: "signed",
        canAlso: [],
        comment: "",
        at: extra.at !== undefined ? extra.at : counter,
        ...extra,
    };
}

/** A deterministic pseudo-random generator (mulberry32). */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TANKS = ["Warrior-Protection", "Paladin-Protection", "Druid-Guardian"];
const HEALERS = ["Priest-Holy", "Priest-Discipline", "Paladin-Holy", "Shaman-Restoration", "Druid-Restoration"];
const MELEE = ["Warrior-Fury", "Rogue-Combat", "Shaman-Enhancement", "Paladin-Retribution", "Druid-Feral", "Warrior-Arms"];
const RANGED = ["Mage-Fire", "Mage-Arcane", "Warlock-Destruction", "Priest-Shadow", "Hunter-BeastMastery", "Druid-Balance", "Shaman-Elemental"];

/** A plausible roster of `n` signups: roughly 1 tank, 2 healers, 3 melee, 4 ranged per 10. */
function roster(n, prefix = "r") {
    const out = [];
    for (let i = 0; i < n; i++) {
        const k = i % 10;
        const pool = k === 0 ? TANKS : k < 3 ? HEALERS : k < 6 ? MELEE : RANGED;
        out.push(su(`${prefix}${String(i).padStart(2, "0")}`, pool[i % pool.length], { at: i + 1 }));
    }
    return out;
}

/** A random input for the property loop. */
function randomInput(random, { events = 1 } = {}) {
    const statuses = ["signed", "signed", "signed", "late", "tentative", "bench", "absence"];
    const all = [...TANKS, ...HEALERS, ...MELEE, ...RANGED];
    const sizes = [10, 20, 25, 40];
    const evs = [];
    for (let e = 0; e < events; e++) {
        const size = sizes[Math.floor(random() * sizes.length)];
        const tank = 1 + Math.floor(random() * 4);
        const healer = Math.floor(size / 5) + Math.floor(random() * 3);
        evs.push({
            id: `ev${e}`,
            title: `Raid ${e + 1}`,
            size,
            composition: {
                tank,
                healer,
                melee: random() < 0.5 ? { min: 1, max: Math.floor(size / 2) } : 0,
                ranged: random() < 0.5 ? { min: 2, max: null } : 0,
            },
            requiredBuffs: random() < 0.5 ? ["kings", "windfury"] : [],
            fairness: random() < 0.5,
            wishes: random() < 0.5,
        });
    }
    const count = 5 + Math.floor(random() * 55);
    const signups = [];
    const profiles = [];
    const history = [];
    const attendance = {};
    for (let i = 0; i < count; i++) {
        const userId = `u${i}`;
        const spec = all[Math.floor(random() * all.length)];
        const eventIds = evs.filter(() => random() < 0.7).map((e) => e.id);
        if (!eventIds.length) eventIds.push(evs[0].id);
        for (const eventId of eventIds) {
            signups.push(su(userId, spec, {
                eventId,
                at: i,
                status: statuses[Math.floor(random() * statuses.length)],
                canAlso: random() < 0.3 ? ["tank", "healer", "melee", "ranged"].filter(() => random() < 0.5) : [],
            }));
        }
        if (random() < 0.5) {
            profiles.push({
                userId,
                canOfftank: random() < 0.2 ? true : null,
                canHeal: random() < 0.2 ? true : null,
                wishes: random() < 0.3 ? [`u${Math.floor(random() * count)}`] : [],
                characters: [{
                    key: userId, name: userId, className: spec.split("-")[0], main: true,
                    specs: [{ key: spec, gear: ["none", "usable", "ready"][Math.floor(random() * 3)] }],
                }],
            });
        }
        if (random() < 0.6) attendance[userId] = Math.floor(random() * 101);
    }
    for (let h = 0; h < 3; h++) {
        const placed = [];
        const bench = [];
        for (let i = 0; i < count; i++) {
            const r = random();
            if (r < 0.5) placed.push(`u${i}`);
            else if (r < 0.7) bench.push(`u${i}`);
        }
        history.push({ eventId: `old${h}`, startTime: 1000 - h, placed, bench });
    }
    const fixed = [];
    if (random() < 0.5 && signups.length) {
        const s = signups[Math.floor(random() * signups.length)];
        fixed.push({ userId: s.userId, eventId: s.eventId, group: 1 + Math.floor(random() * 2), spec: s.spec });
    }
    return { versionId: "tbc", events: evs, signups, profiles, attendance, history, fixed };
}

module.exports = { su, rng, roster, randomInput, TANKS, HEALERS, MELEE, RANGED };
