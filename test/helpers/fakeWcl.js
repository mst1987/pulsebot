// A deterministic fake of the Warcraft-Logs v1 client (classes/warcraftlogs.js)
// for golden-master builds of a whole report (test/utils/logcheck/report.golden.test.js).
//
// Every answer comes from a PRNG seeded by the method and its arguments, so the
// same call always gets the same bytes, whatever order the analyzers ask in.
// The spell ids are drawn from the TBC tables (buffs, debuffs, totems,
// cooldowns, consumables, potions, drums, Bloodlust), and a WCL filter of the
// form `ability.id in (…)` / `ability.name="…"` narrows the pool the way the
// server would — that is enough for every analyzer to find something. The
// numbers are meaningless; only their stability matters.
const claData = require("../../src/config/claData");
const rpbData = require("../../src/config/rpbData");
const { BUFFS } = require("../../src/config/raidBuffs");
const { DEBUFFS } = require("../../src/config/raidDebuffs");
const { TOTEMS } = require("../../src/config/totems");
const { TANK_AURAS, MANA_REGEN } = require("../../src/config/healerSpells");

const last = (list) => (list && list.length ? [String(list[list.length - 1])] : []);
const first = (list) => (list && list.length ? [String(list[0])] : []);

const POOL = [...new Set([
    ...BUFFS.flatMap((b) => [...last(b.ids), ...last(b.groupIds)]),
    ...DEBUFFS.flatMap((d) => last(d.ids)),
    ...TOTEMS.flatMap((t) => [...last(t.castIds), ...last(t.buffIds)]),
    ...TANK_AURAS.flatMap((a) => last(a.ids)),
    ...MANA_REGEN.flatMap((a) => last(a.ids)),
    ...Object.values(rpbData.CLASS_COOLDOWNS).flatMap((list) => list.flatMap((e) => first(e.ids))),
    ...(rpbData.DAMAGE_TAKEN || []).flatMap((e) => first(e.ids)),
    ...Object.values(claData.CONSUMABLES).flatMap((list) => list.slice(0, 2).map(String)),
    "28508", "28507", "28499", "35476", "35475", "2825", "25584", "1", "75",
])];

const PLAYERS = [
    { id: 1, name: "Brokk", type: "Warrior", role: "tank", spec: "Protection" },
    { id: 2, name: "Lumen", type: "Paladin", role: "healer", spec: "Holy" },
    { id: 3, name: "Elun", type: "Priest", role: "healer", spec: "Holy" },
    { id: 4, name: "Dorn", type: "Shaman", role: "dps", spec: "Enhancement" },
    { id: 5, name: "Rain", type: "Shaman", role: "healer", spec: "Restoration" },
    { id: 6, name: "Aldra", type: "Mage", role: "dps", spec: "Fire" },
    { id: 7, name: "Vex", type: "Warlock", role: "dps", spec: "Destruction" },
    { id: 8, name: "Shiv", type: "Rogue", role: "dps", spec: "Combat" },
    { id: 9, name: "Arrow", type: "Hunter", role: "dps", spec: "BeastMastery" },
    { id: 10, name: "Bark", type: "Druid", role: "dps", spec: "Balance" },
];
const PET = { id: 20, name: "Wolf", type: "Pet" };
const BOSS = { id: 100, guid: 22887, name: "Boss", type: "Boss" };

const FIGHTS = {
    title: "BT Golden",
    zoneName: "Black Temple",
    zone: 1011,
    start: 0,
    end: 950000,
    fights: [
        { id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 60000 },
        { id: 2, boss: 601, name: "High Warlord Naj'entus", kill: true, start_time: 100000, end_time: 220000 },
        { id: 3, boss: 607, name: "Mother Shahraz", kill: false, fightPercentage: 4500, start_time: 300000, end_time: 400000 },
        { id: 4, boss: 607, name: "Mother Shahraz", kill: true, start_time: 450000, end_time: 600000 },
        { id: 5, boss: 609, name: "Illidan Stormrage", kill: true, start_time: 700000, end_time: 900000 },
    ],
    friendlies: [...PLAYERS, PET].map((p) => ({ id: p.id, name: p.name, type: p.type, fights: [2, 3, 4, 5].map((id) => ({ id })) })),
    enemies: [{ id: BOSS.id, guid: BOSS.guid, name: BOSS.name, type: "Boss", fights: [2, 3, 4, 5].map((id) => ({ id })) }],
    friendlyPets: [{ id: PET.id, name: PET.name, type: PET.type, petOwner: 9 }],
};

function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** mulberry32 over the call's own seed. */
function rng(seedText) {
    let a = hash(seedText);
    const next = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    const pick = (list) => list[Math.floor(next() * list.length)];
    const some = (list, n) => {
        const copy = [...list];
        const out = [];
        while (copy.length && out.length < n) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
        return out;
    };
    return { next, int, pick, some };
}

/** The spell pool a filter leaves, plus the name a name filter asks for. */
function poolFor(extra) {
    const filter = String((extra && extra.filter) || "");
    const name = filter.match(/ability\.name\s*=\s*"([^"]+)"/);
    if (name) return [{ guid: "25225", name: name[1] }];
    const ids = [...filter.matchAll(/ability\.id\s+in\s*\(([^)]*)\)/gi)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
    const list = ids.length ? [...new Set(ids)] : POOL;
    return list.map((guid) => ({ guid, name: `Spell ${guid}` }));
}

const ability = (a) => ({ guid: Number(a.guid), name: a.name, abilityIcon: `icon_${a.guid}`, type: 1 });

function fightAt(ts) {
    const f = FIGHTS.fights.find((x) => ts >= x.start_time && ts <= x.end_time);
    return f ? f.id : 0;
}

const EVENT_TYPES = {
    casts: ["cast"],
    buffs: ["applybuff", "removebuff", "refreshbuff", "applybuff"],
    debuffs: ["applydebuff", "applydebuffstack", "removedebuff", "refreshdebuff"],
    "damage-done": ["damage"],
    "damage-taken": ["damage"],
    healing: ["heal"],
    resources: ["cast"],
    deaths: ["death"],
    dispels: ["dispel"],
};

function events(view, start, end, extra, seed) {
    const r = rng(seed);
    const pool = poolFor(extra);
    const types = EVENT_TYPES[view] || ["cast"];
    const lo = Math.max(0, start || 0);
    const hi = Math.min(FIGHTS.end, end || FIGHTS.end);
    if (hi <= lo) return [];
    const out = [];
    const n = r.int(10, 24);
    for (let i = 0; i < n; i++) {
        const timestamp = r.int(lo, hi);
        const src = extra && extra.sourceid ? Number(extra.sourceid) : r.pick(PLAYERS).id;
        const hostile = extra && Number(extra.hostility) === 1;
        const tgt = extra && extra.targetid ? Number(extra.targetid) : (hostile || view === "damage-done" ? BOSS.id : r.pick(PLAYERS).id);
        const ev = { timestamp, type: r.pick(types), sourceID: src, targetID: tgt, ability: ability(r.pick(pool)), fight: fightAt(timestamp) };
        if (ev.type === "applydebuffstack") ev.stack = r.int(2, 5);
        if (ev.type === "damage" || ev.type === "heal") {
            ev.amount = r.int(500, 9000);
            ev.hitType = r.int(1, 2);
            ev.overheal = ev.type === "heal" ? r.int(0, 2000) : undefined;
            ev.hitPoints = r.int(1, 100);
            ev.maxHitPoints = 100;
        }
        if (view === "resources") {
            const max = 12000;
            ev.classResources = [{ type: 0, amount: r.int(200, max), max }];
        }
        out.push(ev);
    }
    return out.sort((a, b) => a.timestamp - b.timestamp || a.sourceID - b.sourceID);
}

function gearOf(p) {
    const r = rng(`gear:${p.name}`);
    return Array.from({ length: 18 }, (_, slot) => ({
        id: 28000 + p.id * 100 + slot,
        slot,
        quality: r.int(3, 4),
        icon: `inv_gear_${slot}`,
        name: `Item ${p.id}-${slot}`,
        itemLevel: r.int(110, 150),
        permanentEnchant: r.next() < 0.7 ? r.int(2500, 3100) : undefined,
        gems: r.next() < 0.5 ? [{ id: r.pick(["24027", "24030", "24033", "25890"]), itemLevel: 70 }] : [],
        temporaryEnchant: slot === 15 && r.next() < 0.5 ? 2678 : undefined,
    }));
}

function auras(start, end, extra, seed) {
    const r = rng(seed);
    const pool = poolFor(extra);
    const lo = Math.max(0, start || 0);
    const hi = Math.min(FIGHTS.end, end || FIGHTS.end);
    return r.some(pool, Math.min(pool.length, r.int(8, 20))).map((a) => {
        const from = r.int(lo, Math.max(lo, hi - 1000));
        const to = r.next() < 0.2 ? undefined : r.int(from, hi);
        return {
            name: a.name, guid: Number(a.guid), type: 1, abilityIcon: `icon_${a.guid}`,
            totalUptime: (to || hi) - from, totalUses: r.int(1, 4),
            bands: [{ startTime: from, ...(to === undefined ? {} : { endTime: to }) }],
        };
    });
}

function entries(start, end, extra, seed) {
    const r = rng(seed);
    const pool = poolFor(extra);
    const who = extra && extra.sourceid ? PLAYERS.filter((p) => p.id === Number(extra.sourceid)) : [...PLAYERS, PET];
    return who.map((p) => ({
        name: p.name, id: p.id, guid: 1000 + p.id, type: p.type, icon: `${p.type}-${p.spec || "pet"}`,
        total: r.int(0, 10) === 0 ? 10 : r.int(100, 90000),
        activeTime: r.int(1000, 200000),
        abilities: r.some(pool, Math.min(pool.length, r.int(3, 8))).map((a) => ({ name: a.name, guid: Number(a.guid), type: 1, total: r.int(1, 30), abilityIcon: `icon_${a.guid}` })),
        ...(p.type === "Pet" ? {} : { gear: gearOf(p), specs: [p.spec], talents: [] }),
    }));
}

function deaths(start, end, extra, seed) {
    const r = rng(seed);
    const lo = Math.max(0, start || 0);
    const hi = Math.min(FIGHTS.end, end || FIGHTS.end);
    const hostile = extra && Number(extra.hostility) === 1;
    const out = [];
    for (let i = 0; i < r.int(2, 6); i++) {
        const timestamp = r.int(lo, hi);
        const p = hostile ? { id: BOSS.id, name: BOSS.name, type: "NPC", guid: BOSS.guid } : r.pick(PLAYERS);
        const kb = r.pick(POOL);
        out.push({ id: p.id, name: p.name, type: p.type, guid: p.guid, timestamp, fight: fightAt(timestamp), killingBlow: { name: `Spell ${kb}`, guid: Number(kb), abilityIcon: `icon_${kb}` } });
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
}

function summary(start, end) {
    const details = { dps: [], healers: [], tanks: [] };
    for (const p of PLAYERS) {
        const group = p.role === "tank" ? details.tanks : p.role === "healer" ? details.healers : details.dps;
        group.push({ name: p.name, id: p.id, type: p.type, specs: [{ spec: p.spec }], combatantInfo: { gear: gearOf(p) } });
    }
    return {
        totalTime: Math.max(0, (end || 0) - (start || 0)),
        composition: PLAYERS.map((p) => ({ name: p.name, id: p.id, guid: 1000 + p.id, type: p.type, specs: [{ spec: p.spec, role: p.role }] })),
        playerDetails: details,
    };
}

const key = (name, args) => `${name}:${JSON.stringify(args)}`;

/** A fresh fake client; its answers depend on the call alone, never on call order. */
function mockFakeWcl() {
    const table = (name) => async (reportId, start, end, extra = {}) => ({
        totalTime: Math.max(0, (end || 0) - (start || 0)),
        entries: entries(start, end, extra, key(name, [reportId, start, end, extra])),
    });
    return {
        getFights: async () => JSON.parse(JSON.stringify(FIGHTS)),
        getSummary: async (reportId, start, end) => summary(start, end),
        getCasts: table("casts"),
        getDamageTaken: table("damageTaken"),
        getDamageDone: table("damageDone"),
        getHealing: table("healing"),
        getInterrupts: table("interrupts"),
        getBuffs: async (reportId, start, end, extra = {}) => ({ totalTime: end - start, auras: auras(start, end, extra, key("buffs", [reportId, start, end, extra])) }),
        getDebuffs: async (reportId, start, end, extra = {}) => ({ totalTime: end - start, auras: auras(start, end, extra, key("debuffs", [reportId, start, end, extra])) }),
        getDeaths: async (reportId, start, end, extra = {}) => ({ entries: deaths(start, end, extra, key("deaths", [reportId, start, end, extra])) }),
        getEvents: async (reportId, view, start, end, extra = {}) => ({ events: events(view, start, end, extra, key("events", [reportId, view, start, end, extra])) }),
        getAllEvents: async (reportId, view, start, end, extra = {}) => events(view, start, end, extra, key("all", [reportId, view, start, end, extra])),
    };
}

module.exports = { mockFakeWcl, FIGHTS, PLAYERS };
