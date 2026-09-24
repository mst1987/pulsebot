#!/usr/bin/env node
// Dev only: builds a complete test raid through the production code — 25 real signups
// (signupStore), a proposed and approved setup (setupEditor) — so the Setup tab, the
// Raidplan tab and a template can be tried without hand-written JSON (docs/raidplan.md).
//
//   node scripts/seed-test-raid.js                 # event "BT Vollraid Test" (created, or rebuilt)
//   node scripts/seed-test-raid.js --event <id>    # rebuild this own event instead
//   node scripts/seed-test-raid.js --guild <id>    # Discord server id for a new event (default GUILD_ID / an existing event's)
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

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? String(process.argv[i + 1] || "") : "";
}

/** The demo template and the event's raid plan (production stores, no HTTP). */
function seedPlan(eventId, event) {
    const raidplan = require("../src/web/raidplan");
    const planStore = require("../src/web/raidplanStore");
    const templates = require("../src/web/raidplanTemplateStore");
    const assign = require("../src/web/raidplanAssign");

    const catalog = require("../src/web/raidplanCatalogStore");
    const btBosses = planStore.bossesForInstances(["bt"]);
    const mobTarget = (m) => ({ kind: "mob", ref: m.id, name: m.name, icon: m.icon });
    // tanking: the boss is the target; at the Illidari Council each tank takes one of the four council members from the catalog
    const tankRows = (key) => {
        const row = (n, target) => ({ id: assign.newRowId ? assign.newRowId() : `t${n}${key.length}`, type: "tank", title: "", spell: null, assignees: [`slot:tank:${n}`], targets: [target], note: "", suggested: false });
        if (key === "bt/trash") return [];
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
    if (fs.existsSync(envFile)) require("dotenv").config({ path: envFile });
    const { logcheckAdminIds } = require("../src/config/variables");
    const meId = arg("me") || logcheckAdminIds[0] || "dev";
    const eventStore = require("../src/web/eventStore");
    const signupStore = require("../src/web/signupStore");
    const editor = require("../src/web/setupEditor");
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

main();
