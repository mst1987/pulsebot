#!/usr/bin/env node
// Dev only: builds a complete test raid through the production code — 25 real signups
// (signupStore), a proposed and approved setup (setupEditor) — so the Setup tab, the
// Raidplan tab and a template can be tried without hand-written JSON (docs/raidplan.md).
//
//   node scripts/seed-test-raid.js                 # event "BT Vollraid Test" (created, or rebuilt)
//   node scripts/seed-test-raid.js --event <id>    # rebuild this own event instead
//   node scripts/seed-test-raid.js --guild <id>    # Discord server id for a new event (default GUILD_ID / an existing event's)
//   node scripts/seed-test-raid.js --auto-demo     # the auto placement demo (docs/raidplan.md): Illidan without hand-placed icons
//                                                  # (boss, two Flames and their tanks come from the tank rows), the Council with
//                                                  # "Magier-Tank -> Zerevor" and "Tank (Paladin) -> Malande", the paladin tank playing
//                                                  # DPS there ("Paladin fehlt")
//
// It also fills the raid plan: a template "BT Demo" (slots, heal / trash assignments for Naj'entus,
// Supremus, Gurtogg, Illidan and the trash) is created or updated and applied to the event, then
// the class based assignments (kicks, misdirects, soulstones, fear ward, curses, thunder clap,
// demoralizing shout) are added from the setup.
//
// Idempotent: run twice and the event holds the same 25 signups and one approved setup.
// Refuses to run with NODE_ENV=production. Nothing goes to Discord: only the local
// JSON stores under data/ are written.
const fs = require("fs");
const TITLE = "BT Vollraid Test";

// 3 tanks, 7 healers, 8 melee, 7 ranged; several classes and specs, five groups of five.
const ROSTER = [
    ["Tankwart", "Warrior-Protection"], ["Bollwerk", "Paladin-Protection"], ["Baerchen", "Druid-Guardian"],
    ["Heilbert", "Priest-Holy"], ["Disziplin", "Priest-Discipline"], ["Lichtbringer", "Paladin-Holy"], ["Segenreich", "Paladin-Holy"],
    ["Flutwelle", "Shaman-Restoration"], ["Quellgeist", "Shaman-Restoration"], ["Baumbart", "Druid-Restoration"],
    ["Klingentanz", "Warrior-Arms"], ["Berserker", "Warrior-Fury"], ["Schleich", "Rogue-Combat"], ["Meuchler", "Rogue-Assassination"],
    ["Schatten", "Rogue-Subtlety"], ["Richter", "Paladin-Retribution"], ["Donnerfaust", "Shaman-Enhancement"], ["Katzenauge", "Druid-Feral"],
    ["Feuerfritz", "Mage-Fire"], ["Arkanix", "Mage-Arcane"], ["Zerstoerer", "Warlock-Destruction"], ["Leidbringer", "Warlock-Affliction"],
    ["Pfeilchen", "Hunter-BeastMastery"], ["Scharfschuss", "Hunter-Marksmanship"], ["Dunkelpriester", "Priest-Shadow"],
];
const FIRST_USER_ID = 201;
const ME_CHARACTER = "Heilbert";
const TEMPLATE_NAME = "BT Demo";
// DPS as one number (15) that the demo splits into 8 melee + 7 ranged slots, so both ways of filling can be tried
const DEMO_COUNTS = { tank: 3, healer: 7, dps: 15, melee: 8, ranged: 7 };
const DEMO_BOSSES = ["bt/high-warlord-najentus", "bt/supremus", "bt/gurtogg-bloodboil", "bt/the-illidari-council", "bt/illidan-stormrage", "bt/trash"];

/** The placeholder slots of a raid: 3 tanks, 7 healers, 8 melee, 7 ranged, five group markers. */
function demoSlots() {
    const row = (kind, count, y, x0 = 0.08, dx = 0.1) => Array.from({ length: count }, (_, i) => ({ kind, n: i + 1, x: x0 + dx * i, y }));
    return [...row("tank", 3, 0.18, 0.12, 0.12), ...row("healer", 7, 0.38), ...row("melee", 8, 0.58, 0.06, 0.11), ...row("ranged", 7, 0.76, 0.08, 0.12),
        ...Array.from({ length: 5 }, (_, i) => ({ kind: "group", n: i + 1, x: 0.12 + 0.19 * i, y: 0.92 }))];
}

/**
 * Gurtogg's board of the demo: the boss, the melee groups 1-2 at him, the ranged groups 3-5 at their places, and the scene in which
 * Bloodboil hits the group at the back, which runs to the front while the next group falls back (twice).
 */
function gurtoggDemo(key) {
    const back = [0.5, 0.8], left = [0.18, 0.72], right = [0.82, 0.72];
    const group = (n, [x, y]) => ({ id: `bbg${n}`, kind: "group", n, label: "", x, y, split: true, groupScale: 0.75 });
    const move = (n, [x, y], extra = {}) => ({ obj: `slot:bbg${n}`, x, y, dur: 2, ease: "inout", ...extra });
    const debuff = (n) => ({ obj: `slot:bbg${n}`, badge: "spell_shadow_bloodboil", pulse: true, dur: 0 });
    return {
        slots: [group(1, [0.3, 0.33]), group(2, [0.7, 0.33]), group(3, back), group(4, left), group(5, right)],
        icons: [{ id: "bbboss", iconKey: "bosspos", label: "Gurtogg", showLabel: true, x: 0.5, y: 0.14, size: 56, rotation: 180, mobId: `b:${key}`, autoFace: true, opacity: 1, lock: false, hidden: false }],
        // the tactic step the scene stands at: the sheet shows "Animation" beside it (#713)
        steps: [{ id: "bbst", action: "soak", participants: ["group:3", "group:4", "group:5"], sentence: "tauschen bei Bloodboil: wer ihn hat, läuft nach vorne", targets: [], timing: { kind: "interval", from: 10 } }],
        scenes: [{
            id: "bbrot", title: "Bloodboil-Rotation", loop: false, length: 13, stepId: "bbst",
            frames: [
                { id: "f1", at: 0, caption: "Gruppe 3 steht hinten, 4 und 5 warten vorne", changes: [] },
                { id: "f2", at: 2, caption: "Bloodboil trifft die fünf Entferntesten: Gruppe 3", changes: [debuff(3)] },
                { id: "f3", at: 3.5, caption: "Gruppe 3 läuft nach vorne, Gruppe 4 rückt nach hinten", changes: [move(3, left, { pulse: false, path: [[0.33, 0.86]] }), move(4, back, { delay: 0.4, path: [[0.36, 0.66]] })] },
                { id: "f4", at: 6.5, caption: "Nächster Bloodboil: Gruppe 4", changes: [debuff(4)] },
                { id: "f5", at: 8, caption: "Gruppe 4 nach vorne, Gruppe 5 nach hinten", changes: [move(4, right, { pulse: false, path: [[0.67, 0.86]] }), move(5, back, { delay: 0.4, path: [[0.64, 0.66]] })] },
                { id: "f6", at: 11, caption: "Bloodboil: Gruppe 5 - und so weiter", changes: [debuff(5)] },
            ],
            loops: [],
        }],
    };
}

/**
 * Illidan's phase 2 in the demo (#712): Illidan flies up, the raid goes to the middle into five tight camps (a Fireball splashes
 * 10 yd round its target), two glaives land west and east and a Flame of Azzinoth rises at each; the druids (tank 2 and tank 3)
 * take one flame each out to their side and kite it round their own glaive stop by stop: the flame stands a moment, lays its green
 * fire (Blaze) on the ground, then the druid moves on and the flame follows - the green fire stays behind. Meanwhile an Eye Blast
 * sweeps over the west side and leaves blue fire for a while; the west druid has to move on through it, as behind him lies the
 * green fire. The circle round a glaive is the leash: a flame (and the raid) has to stay near it, else Uncaged Wrath. The game facts
 * (spells, icons, 10 yd splash, glaives west / east, leash) were checked against Wowhead TBC and warcraft.wiki.gg plus guides (Oct
 * 2026); the stop-and-go kiting and the blue fire left by the Eye Blast are how the user's guild plays it, the places on the map
 * the demo's own layout, not data. Returns the objects of the board and the scene.
 */
function illidanPhase2Demo() {
    const r2 = (n) => Math.round(n * 100) / 100;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const glaiveW = [0.27, 0.46], glaiveE = [0.73, 0.46];
    // the west druid's stops round his glaive on its outer side, from north over west to south, 25 degrees apart (on the demo's wide
    // board 0.17 of the width is about 0.3 of the height); the east side mirrored
    const arc = (deg) => [r3(glaiveW[0] + 0.17 * Math.cos((deg * Math.PI) / 180)), r3(glaiveW[1] + 0.3 * Math.sin((deg * Math.PI) / 180))];
    const mirror = ([x, y]) => [r3(1 - x), y];
    const lerp = ([ax, ay], [bx, by], f) => [r3(ax + (bx - ax) * f), r3(ay + (by - ay) * f)];
    const stopsW = [260, 235, 210, 185, 160, 135, 110, 85].map(arc);
    // the flame stands behind its druid, most of the way back to his last stop (so the two do not cover each other on the map)
    const flamesW = [arc(285), ...stopsW.slice(1).map((p, i) => lerp(stopsW[i], p, 0.3))];
    const side = {
        w: { tank: "slot:illtk2", flame: "icon:flame1", stops: stopsW, flames: flamesW, done: 0 },
        e: { tank: "slot:illtk3", flame: "icon:flame2", stops: stopsW.map(mirror), flames: flamesW.map(mirror), done: 0 },
    };
    // the five camps as a cross in the middle, where both leash circles overlap (warcraft.wiki.gg: up to five tight groups as a cross)
    const camps = { 1: [0.5, 0.26], 2: [0.36, 0.5], 3: [0.64, 0.5], 4: [0.5, 0.74], 5: [0.5, 0.5] };
    // phase 1: the melee groups at Illidan, the others behind them
    const phase1 = { 1: [0.43, 0.32], 2: [0.57, 0.32], 3: [0.3, 0.6], 4: [0.5, 0.72], 5: [0.7, 0.6] };
    const group = (n) => ({ id: `illg${n}`, kind: "group", n, label: "", x: camps[n][0], y: camps[n][1], split: true, groupScale: 0.45 });
    const icon = (id, iconKey, [x, y], extra = {}) => ({ id, iconKey, label: "", showLabel: false, x, y, size: 48, rotation: 0, autoFace: false, opacity: 1, lock: false, hidden: false, ...extra });
    // the leash round a glaive: a circle on the demo's wide board (w 0.5 of the width = h 0.8 of the height), both overlap in the middle;
    // neutral grey, green is the flames' fire
    const leash = (id, [x, y], label) => ({ id, shape: "ellipse", type: "custom", label, color: "#8f8a80", opacity: 0.16, x: r2(x - 0.25), y: r2(y - 0.4), w: 0.5, h: 0.8 });
    // the 10 yd splash of a Fireball round camp 3
    const splash = { id: "fireball", shape: "ellipse", type: "danger", label: "Feuerball", opacity: 0.25, x: r2(camps[3][0] - 0.07), y: r2(camps[3][1] - 0.11), w: 0.14, h: 0.22 };
    // the green fire a flame lays where it stood (a danger zone: never step in), and the blue fire of the Eye Blast across the west
    // druid's way (a plain area: bad, but better than the green; no label, the druid's name would cover it - the caption says it)
    const blaze = (id, [x, y]) => ({ id, shape: "ellipse", type: "danger", label: "", color: "#4fa82a", opacity: 0.6, x: r3(x - 0.03), y: r3(y - 0.048), w: 0.06, h: 0.096 });
    const blue = [{ id: "bluefire", shape: "rect", type: "custom", label: "", color: "#4a78c8", opacity: 0.55, x: 0.03, y: 0.35, w: 0.3, h: 0.05 }];
    const blazes = [];
    const ch = (obj, extra) => ({ delay: 0, dur: 1, ease: "inout", obj, ...extra });
    // one kite stop of a side: the flame has stood a moment, lays its green fire, then the druid moves on and the flame follows
    const step = (s) => {
        const d = side[s];
        const i = d.done++;
        const id = `blaze${s}${i}`;
        blazes.push(blaze(id, d.flames[i]));
        const [tx, ty] = d.stops[i + 1];
        const [fx, fy] = d.flames[i + 1];
        return [ch(`zone:${id}`, { hidden: false, delay: 0.4, dur: 0.4 }), ch(d.tank, { x: tx, y: ty, delay: 1, dur: 1 }), ch(d.flame, { x: fx, y: fy, delay: 1.4, dur: 0.9 })];
    };
    const both = () => [...step("w"), ...step("e")];
    // built before the first frame, which hides every fire they lay
    const kite = {
        k1: both(), k2: both(),
        // the Eye Blast: the west druid waits, the east one kites on
        eye: step("e"),
        dodge: both(), fb: both(), off: both(), end: both(),
    };
    const groups = [1, 2, 3, 4, 5];
    const objects = ["icon:glaivew", "icon:glaivee", "icon:flame1", "icon:flame2", "zone:leashw", "zone:leashe", "zone:fireball", ...blue.map((z) => `zone:${z.id}`), ...blazes.map((z) => `zone:${z.id}`)];
    const scene = {
        id: "illp2", title: "Phase 2: Flammen und Camps", loop: false, length: 30,
        frames: [
            { id: "p1", at: 0, caption: "Phase 1: Illidan am Boden, der Raid um ihn herum",
                changes: [ch("icon:illidanb", { x: 0.5, y: 0.22 }), ...groups.map((n) => ch(`slot:illg${n}`, { x: phase1[n][0], y: phase1[n][1] })),
                    ch("slot:illtk1", { x: 0.5, y: 0.31 }), ch("slot:illtk2", { x: 0.4, y: 0.42 }), ch("slot:illtk3", { x: 0.6, y: 0.42 }),
                    // hidden until their frame; the flames wait at their glaive (they rise there)
                    ...objects.map((o) => ch(o, { hidden: true, ...(o === "icon:flame1" ? { x: glaiveW[0], y: glaiveW[1] } : o === "icon:flame2" ? { x: glaiveE[0], y: glaiveE[1] } : {}) }))] },
            { id: "p2", at: 2, caption: "Bei 65 % hebt Illidan ab: der Raid geht in die Mitte, jede Gruppe in ihr Camp",
                changes: [ch("icon:illidanb", { y: 0.1, opacity: 0.4, scale: 0.8, dur: 1.5 }), ...groups.map((n, i) => ch(`slot:illg${n}`, { x: camps[n][0], y: camps[n][1], dur: 2, delay: i * 0.2 })),
                    ch("slot:illtk1", { x: 0.5, y: 0.88, dur: 2 })] },
            { id: "p3", at: 4.6, caption: "Illidan wirft zwei Glaiven: eine nach Westen, eine nach Osten",
                changes: [ch("icon:glaivew", { hidden: false, pulse: true, dur: 0.4 }), ch("icon:glaivee", { hidden: false, pulse: true, dur: 0.4 }),
                    ch("slot:illtk2", { x: side.w.stops[0][0], y: side.w.stops[0][1], dur: 2.2 }), ch("slot:illtk3", { x: side.e.stops[0][0], y: side.e.stops[0][1], dur: 2.2 })] },
            { id: "p4", at: 6.2, caption: "An jeder Glaive steigt eine Flamme von Azzinoth auf",
                changes: [ch("icon:flame1", { hidden: false, badge: "spell_fire_felfire", pulse: true, dur: 0.6 }), ch("icon:flame2", { hidden: false, badge: "spell_fire_felfire", pulse: true, dur: 0.6 }),
                    ch("icon:glaivew", { pulse: false, dur: 0 }), ch("icon:glaivee", { pulse: false, dur: 0 })] },
            { id: "p5", at: 7.8, caption: "Der Kreis um die Glaive: Flamme und Raid bleiben drin, sonst Ungezügelter Hass (+500 % Schaden)",
                changes: [ch("zone:leashw", { hidden: false, dur: 0.8 }), ch("zone:leashe", { hidden: false, dur: 0.8 })] },
            { id: "p6", at: 10, caption: "Die Druiden (Tank 2 und 3) holen je eine Flamme nach außen, ihr Feuerstoß zeigt vom Raid weg",
                changes: [ch("icon:flame1", { x: side.w.flames[0][0], y: side.w.flames[0][1], dur: 1.2, pulse: false }), ch("icon:flame2", { x: side.e.flames[0][0], y: side.e.flames[0][1], dur: 1.2, pulse: false })] },
            { id: "p7", at: 11.6, caption: "Die Flamme bleibt kurz stehen und legt grünes Feuer (Lohe), dann zieht der Druide sie weiter", changes: kite.k1 },
            { id: "p8", at: 14.2, caption: "Halt, grünes Feuer, weiter: so wandert die Flamme um ihre Glaive, die Lohe bleibt hinter ihr liegen", changes: kite.k2 },
            { id: "p9", at: 16.8, caption: "Augenstrahl: Illidan zieht einen Strahl über die Westseite, dahinter bleibt blaues Feuer liegen",
                changes: [ch("icon:illidanb", { badge: "spell_fire_fireball02", pulse: true, dur: 0 }), ...blue.map((z) => ch(`zone:${z.id}`, { hidden: false, delay: 0.3, dur: 1 })), ...kite.eye] },
            { id: "p10", at: 19.6, caption: "Der Druide im Westen muss weiter: hinter ihm liegt grünes Feuer, also lieber kurz durchs blaue",
                changes: [ch("icon:illidanb", { badge: "", pulse: false, dur: 0 }), ...kite.dodge] },
            { id: "p11", at: 22.2, caption: "Feuerball trifft alles 10 Meter um sein Ziel: eng im eigenen Camp, Abstand zu den anderen",
                changes: [ch("slot:illg3", { badge: "spell_fire_blueflamebolt", pulse: true, dur: 0 }), ch("zone:fireball", { hidden: false, dur: 0.3 }), ...kite.fb] },
            { id: "p12", at: 24.8, caption: "Das blaue Feuer liegt eine Weile und verschwindet dann, die Druiden kiten weiter",
                changes: [ch("slot:illg3", { badge: "", pulse: false, dur: 0 }), ch("zone:fireball", { hidden: true, dur: 0.5 }), ...blue.map((z) => ch(`zone:${z.id}`, { hidden: true, dur: 0.8 })), ...kite.off] },
            { id: "p13", at: 27.4, caption: "Bis beide Flammen tot sind, dann landet Illidan (Phase 3)", changes: kite.end },
        ],
        loops: [],
    };
    return {
        groups: groups.map(group),
        tanks: { 1: [0.5, 0.88], 2: side.w.stops[0], 3: side.e.stops[0] },
        icons: [icon("glaivew", "wow:inv_weapon_glave_01", glaiveW, { size: 40 }), icon("glaivee", "wow:inv_weapon_glave_01", glaiveE, { size: 40 })],
        flames: { flame1: side.w.flames[0], flame2: side.e.flames[0] },
        zones: [leash("leashw", glaiveW, "Glaive West"), leash("leashe", glaiveE, "Glaive Ost"), splash, ...blue, ...blazes],
        scene,
    };
}

/** Illidan's board of the demo template (`slots` = demoSlots(), `assignments` = the boss's rows so far); --auto-demo places nothing by hand. */
function illidanBoard(key, slots, autoDemo, assignments = []) {
    const row = (id, n, ref, name, icon) => ({ id, type: "tank", title: "", spell: null, assignees: [`slot:tank:${n}`], targets: [{ kind: "mob", ref, name, icon }], note: "", suggested: false });
    const rows = [row("illt1", 1, `b:${key}`, "Illidan Stormrage", ""), row("illt2", 2, "d:flame-of-azzinoth", "Flame of Azzinoth", "mob:22997"), row("illt3", 3, "d:flame-of-azzinoth", "Flame of Azzinoth", "mob:22997"), ...assignments.filter((x) => x.type !== "tank")];
    // --auto-demo: nothing placed by hand, the tank rows put Illidan, both Flames and the three tanks on the map
    if (autoDemo) return { slots: [], icons: [], assignments: rows, steps: [], scenes: [] };
    const p2 = illidanPhase2Demo();
    const mk = (id, iconKey, [x, y], mobId) => ({ id, iconKey, label: "", showLabel: false, x, y, size: 48, rotation: 0, mobId, autoFace: true, opacity: 1, lock: false, hidden: false });
    const tk = (n) => ({ ...slots.find((sl) => sl.kind === "tank" && sl.n === n), id: `illtk${n}`, x: p2.tanks[n][0], y: p2.tanks[n][1] });
    return {
        slots: [tk(1), tk(2), tk(3), ...p2.groups],
        icons: [mk("illidanb", "boss:609", [0.5, 0.22], `b:${key}`), mk("flame1", "mob:22997", p2.flames.flame1, "d:flame-of-azzinoth"), mk("flame2", "mob:22997", p2.flames.flame2, "d:flame-of-azzinoth"), ...p2.icons],
        zones: p2.zones,
        // the flames are placed by hand and hidden until they rise: the tank rows must not put flames of their own on the map meanwhile
        autoPlace: false,
        assignments: rows,
        steps: [{ id: "illkite", action: "kite", participants: ["slot:tank:2", "slot:tank:3"], sentence: "kiten je eine Flamme von Azzinoth um ihre Glaive", targets: [{ kind: "mob", ref: "d:flame-of-azzinoth", name: "Flame of Azzinoth", icon: "mob:22997" }], timing: { kind: "phase", from: 2 } }],
        scenes: [{ ...p2.scene, stepId: "illkite" }],
    };
}

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? String(process.argv[i + 1] || "") : "";
}

/** The demo template and the event's raid plan (production stores, no HTTP). */
function seedPlan(eventId, event) {
    const raidplan = require("../src/web/raidplan/raidplan");
    const planStore = require("../src/stores/raidplanStore");
    const templates = require("../src/stores/raidplanTemplateStore");
    const assign = require("../src/services/raidplan/raidplanAssign");

    const catalog = require("../src/stores/raidplanCatalogStore");
    const btBosses = planStore.bossesForInstances(["bt"]);
    const autoDemo = process.argv.includes("--auto-demo");
    const councilMob = (re) => catalog.listMobs().find((m) => m.bossKey === "bt/the-illidari-council" && re.test(m.name));
    const mobTarget = (m) => ({ kind: "mob", ref: m.id, name: m.name, icon: m.icon });
    // tanking: the boss is the target; at the Illidari Council each tank takes one of the four council members from the catalog
    const tankRows = (key) => {
        const row = (n, target) => ({ id: assign.newRowId ? assign.newRowId() : `t${n}${key.length}`, type: "tank", title: "", spell: null, assignees: [`slot:tank:${n}`], targets: [target], note: "", suggested: false });
        if (key === "bt/trash") return [];
        if (key === "bt/the-illidari-council" && autoDemo) {
            // rules instead of slots: a mage of any spec tanks Zerevor, the paladin tank Malande (resolved from the setup when applied)
            const rule = (ref, m) => ({ ...row(0, mobTarget(m)), id: `c${ref.length}${m.id.length}`, assignees: [ref] });
            const [gathios, zerevor, malande] = [councilMob(/Gathios/), councilMob(/Zerevor/), councilMob(/Malande/)];
            return [...(gathios ? [row(1, mobTarget(gathios))] : []), ...(zerevor ? [rule("class:Mage:1:any", zerevor)] : []), ...(malande ? [rule("class:Paladin:1:tank", malande)] : [])];
        }
        if (key === "bt/the-illidari-council") return catalog.listMobs().filter((m) => m.bossKey === key).slice(0, 3).map((m, i) => row(i + 1, mobTarget(m)));
        const boss = btBosses.find((b) => b.key === key);
        return boss ? [row(1, { kind: "mob", ref: `b:${key}`, name: boss.name, icon: "" })] : [];
    };
    const slots = demoSlots();
    const groups = [1, 2, 3, 4, 5];
    const bosses = {};
    for (const key of DEMO_BOSSES) {
        const trash = key.endsWith("/trash");
        const list = [...tankRows(key), ...assign.suggest("heal", { slots, groups }), ...(trash ? assign.suggest("trashtank", { slots }) : [])].map((a) => ({ ...a, suggested: false }));
        // the Besetzung (all role slots) exists by itself in the editor; the first boss shows tanks and healers on the map as an example
        const onMap = key === DEMO_BOSSES[0] ? slots.filter((s) => s.kind === "tank" || s.kind === "healer") : [];
        bosses[key] = { slots: onMap, assignments: list, notes: trash ? "Trash: Tank 1 Totenkopf, Tank 2 Kreuz, Tank 3 Quadrat." : "" };
    }
    // the second boss: tanks on the map and the boss icon, but NO own tank row - the Standard below (Tank 1 -> boss of this section) makes the icon face the tank in every boss
    {
        const second = DEMO_BOSSES[1];
        const icon = (key) => ({ id: "seedicon", iconKey: "boss:601", label: "", showLabel: false, x: 0.5, y: 0.25, size: 48, rotation: 0, mobId: `b:${key}`, autoFace: true, opacity: 1, lock: false, hidden: false });
        bosses[second] = { ...bosses[second], slots: slots.filter((s) => s.kind === "tank"), icons: [icon(second)], assignments: bosses[second].assignments.filter((a) => a.type !== "tank") };
        bosses.defaults = { slots: [], assignments: [{ id: "stdtank1", type: "tank", title: "", spell: null, assignees: ["slot:tank:1"], targets: [{ kind: "mob", ref: "b:this", name: "Boss", icon: "" }], note: "", suggested: false }] };
    }
    // Illidan: the boss icon, two Flames of Azzinoth, their glaives and leash circles, three tanks and the five camps of phase 2;
    // Tank 1 holds Illidan, Tank 2 and 3 one Flame each (the flames face their tank)
    {
        const key = "bt/illidan-stormrage";
        bosses[key] = { ...bosses[key], ...illidanBoard(key, slots, autoDemo, bosses[key].assignments) };
    }
    // Gurtogg: the five groups as split markers and the animation "Bloodboil-Rotation" (docs/raidplan/animation.md): Bloodboil hits the
    // group standing farthest away, it runs to the front and the next group falls back
    {
        const key = "bt/gurtogg-bloodboil";
        bosses[key] = { ...bosses[key], ...gurtoggDemo(key) };
    }
    bosses.general = { notes: "Allgemeine Einteilungen: Fluecke, Donnerknall, Demoralisierender Ruf." };

    let tpl = templates.listTemplates().find((t) => t.name === TEMPLATE_NAME);
    if (!tpl) {
        const created = templates.createTemplate({ name: TEMPLATE_NAME, category: "Demo", description: "Seed: Raidtyp BT 25, Besetzung, Heiler-Einteilungen", instanceIds: ["bt"], size: 25, counts: DEMO_COUNTS });
        if (created.error) throw new Error(created.error);
        tpl = created.template;
    }
    const saved = templates.updateTemplate(tpl.id, { bosses, version: tpl.version, size: 25, counts: DEMO_COUNTS });
    if (saved.error) throw new Error(saved.error);
    tpl = saved.template;

    // apply it to the event's plan, then add what needs the setup's players
    const bossKeys = raidplan.bossList(event).map((b) => b.key);
    const roster = raidplan.editorRoster(event);
    let plan = planStore.getPlan(eventId) || planStore.emptyPlan(eventId);
    const applied = planStore.applyTemplate(eventId, tpl, { version: plan.version, bossKeys, roster, userId: "seed" });
    if (applied.error) throw new Error(applied.error);
    plan = applied.plan;
    const extended = { ...plan.bosses };
    // the tank / healer places as the event fills them (only slots somebody stands in are suggested for)
    const byRole = (kind) => roster.filter((p) => p.role === kind);
    const filled = demoSlots().map((sl) => ({ ...sl, userId: ((byRole(sl.kind) || [])[sl.n - 1] || {}).userId || "" }));
    const add = (key, types) => {
        const b = extended[key] || { slots: [], assignments: [] };
        const extra = types.flatMap((type) => raidplan.suggestFor(type, { event, slots: filled }));
        extended[key] = { ...b, assignments: [...(b.assignments || []), ...extra.map((a) => ({ ...a, suggested: false }))] };
    };
    add("bt/high-warlord-najentus", ["kick", "md"]);
    add("bt/supremus", ["md", "fearward"]);
    add("bt/gurtogg-bloodboil", ["md", "ss"]);
    add("bt/the-illidari-council", ["kick", "md"]);
    add("bt/illidan-stormrage", ["kick", "md", "ss", "fearward"]);
    add("bt/trash", ["kick"]);
    add("general", ["curse", "thunderclap", "demoshout"]);
    // class based rows (resolved from the setup, no slot to choose) and rows that act on the dev user (Heilbert), to try "Meine Aufgaben" / "Auf mich wirkend"
    const me = roster.find((p) => p.character === ME_CHARACTER);
    if (me) {
        const rowId = () => require("crypto").randomBytes(5).toString("hex");
        const mk = (type, assignees, targets, extra = {}) => ({ id: rowId(), type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
        const key = "bt/high-warlord-najentus";
        const b = extended[key] || { slots: [], assignments: [] };
        extended[key] = { ...b, assignments: [...(b.assignments || []),
            mk("ss", ["class:Warlock:1"], [{ kind: "player", ref: me.userId }]),
            mk("fearward", ["class:Priest:1:dps"], [{ kind: "player", ref: me.userId }]),
            mk("md", ["class:Hunter:1", "class:Hunter:2"], [{ kind: "slot", ref: "tank:1" }]),
            mk("heal", ["user:" + me.userId], [{ kind: "slot", ref: "tank:2" }]),
        ] };
    }
    // the round robin to try (docs/raidplan.md, "Count and round robin"): general tanks on the trash ("Tank (Paladin)" is served first, "any
    // tank" takes the next tank of the setup) and a third misdirect row at the council that stays open (two hunters, both misdirect there)
    {
        const rowId = () => require("crypto").randomBytes(5).toString("hex");
        const mk = (type, assignees, targets) => ({ id: rowId(), type, title: "", spell: null, assignees, targets, note: "", suggested: false });
        const trashMobs = catalog.listMobs().filter((m) => m.kind === "trash" && m.instanceId === "bt" && !m.bossKey).slice(0, 2);
        const tb = extended["bt/trash"] || { slots: [], assignments: [] };
        if (trashMobs.length === 2) {
            extended["bt/trash"] = { ...tb, assignments: [...(tb.assignments || []), mk("tank", ["class:Any:1:tank"], [mobTarget(trashMobs[0])]), mk("tank", ["class:Paladin:1:tank"], [mobTarget(trashMobs[1])])] };
        }
        const cb = extended["bt/the-illidari-council"] || { slots: [], assignments: [] };
        // a class tank on purpose: a mage of any spec tanks High Nethermancer Zerevor ("Magier-Tank"); and soulstones for three warlocks where the
        // raid has two, one of them already on the task: two places stay open ("Hexenmeister fehlt", plan-wide "offene Einteilungen")
        const zerevor = catalog.listMobs().find((m) => m.bossKey === "bt/the-illidari-council" && /Zerevor/.test(m.name));
        extended["bt/the-illidari-council"] = { ...cb, assignments: [...(cb.assignments || []),
            mk("md", ["class:Hunter:1"], [{ kind: "slot", ref: "tank:3" }]),
            ...(zerevor && !autoDemo ? [mk("tank", ["class:Mage:1:any"], [mobTarget(zerevor)])] : []),
            mk("ss", ["class:Warlock:1", "class:Warlock:2", "class:Warlock:3"], [{ kind: "slot", ref: "healer:1" }]),
        ] };
        // --auto-demo: the paladin tank plays DPS at the Council, so "Tank (Paladin) -> Malande" finds nobody ("Paladin fehlt", never another class)
        const pal = roster.find((p) => p.classId === "Paladin" && p.role === "tank");
        if (autoDemo && pal) extended["bt/the-illidari-council"] = { ...extended["bt/the-illidari-council"], roles: { ...(extended["bt/the-illidari-council"].roles || {}), [pal.userId]: "dps" } };
    }
    const savedPlan = planStore.savePlan(eventId, { version: plan.version, bosses: extended }, {
        bossKeys, allowedUserIds: roster.map((p) => p.userId), profileIds: [], userId: "seed",
    });
    if (savedPlan.error) throw new Error(savedPlan.error);
    const rows = Object.values(savedPlan.plan.bosses).reduce((n, b) => n + b.assignments.length, 0);
    console.log(`  plan: template "${TEMPLATE_NAME}" applied, ${Object.keys(savedPlan.plan.bosses).length} boards, ${rows} assignments`);
}

function main() {
    if (process.env.NODE_ENV === "production") {
        console.error("seed-test-raid: refused, NODE_ENV=production.");
        process.exit(1);
    }
    // the dev auto-login user is one of the players (Heilbert), so "you are highlighted" can be tried:
    // --me <userId> overrides, else the first admin id of .env.dev (what the dev login uses)
    const path = require("path");
    const envFile = path.join(__dirname, "..", ".env.dev");
    if (fs.existsSync(envFile)) require("dotenv").config({ path: envFile, quiet: true });
    const { logcheckAdminIds } = require("../src/config/variables");
    const meId = arg("me") || logcheckAdminIds[0] || "dev";
    const eventStore = require("../src/stores/eventStore");
    const signupStore = require("../src/stores/signupStore");
    const editor = require("../src/services/setup/setupEditor");
    const { spec } = require("../src/config/gameVersions");

    const wanted = arg("event");
    const events = eventStore.listEvents();
    let event = wanted ? events.find((e) => e.id === wanted) : events.find((e) => e.title === TITLE && eventStore.isOwnEventId(e.id));
    if (wanted && !event) { console.error(`seed-test-raid: no event "${wanted}".`); process.exit(1); }
    if (wanted && !eventStore.isOwnEventId(wanted)) { console.error("seed-test-raid: only an own event (eh-…) can be seeded."); process.exit(1); }

    const plan = { versionId: "tbc", instanceIds: ["bt"], size: 25, composition: { tank: 3, healer: 7, melee: 0, ranged: 0 } };
    if (!event) {
        const guildId = arg("guild") || process.env.GUILD_ID || (events.find((e) => e.guildId) || {}).guildId || "";
        const created = eventStore.createEvent({
            guildId, channelId: "1", title: TITLE, startTime: Math.floor(Date.now() / 1000) + 7 * 86400, ...plan,
        });
        if (created.error) { console.error(`seed-test-raid: ${created.error}`); process.exit(1); }
        event = created.event;
    }
    const id = event.id;

    // start clean: no old signups, no old setup (an earlier hand-written one included)
    signupStore.deleteEventSignups(id);
    eventStore.setEventSetup(id, null);

    ROSTER.forEach(([character, specKey], n) => {
        if (!spec(specKey, "tbc")) throw new Error(`unknown spec ${specKey}`);
        const r = signupStore.saveSignup(id, character === ME_CHARACTER ? meId : String(FIRST_USER_ID + n), { character, spec: specKey, status: "signed" }, { versionId: "tbc" });
        if (r.error) throw new Error(`${character}: ${r.error}`);
    });

    const proposed = editor.proposeEventSetup(id, {}, { userId: "seed" });
    if (proposed.error) { console.error(`seed-test-raid: proposal: ${proposed.error}`); process.exit(1); }
    const approved = editor.approveEventSetup(id, { version: proposed.setup.version, userId: "seed" });
    if (approved.error) { console.error(`seed-test-raid: approval: ${approved.error}`); process.exit(1); }

    seedPlan(id, eventStore.getEvent(id));

    const setup = approved.setup || eventStore.getEvent(id).setup;
    const placed = setup.groups.reduce((s, g) => s + g.slots.length, 0);
    const roles = {};
    for (const [, specKey] of ROSTER) { const role = spec(specKey, "tbc").role; roles[role] = (roles[role] || 0) + 1; }
    console.log(`seed-test-raid: event ${id} "${event.title}" — ${ROSTER.length} signups, setup ${setup.status}, ${placed} placed in ${setup.groups.length} groups, bench ${setup.bench.length}.`);
    console.log(`  roles: ${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  open: /raids/detail?event=${id}&tab=setup   and   &tab=plan`);
}

// only when started as a script: a `require` (a test, a syntax check) runs nothing and writes nothing
if (require.main === module) main();

module.exports = { main, seedPlan, demoSlots, illidanBoard, ROSTER, TEMPLATE_NAME };
