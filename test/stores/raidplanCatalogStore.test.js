// The raid plan catalog: defaults (code) and overrides (data) kept apart, CRUD, reset, the API and its gate,
// mob and spell references in assignments, snapshots for deleted entries, the classes the suggestions use.
let mockUser = null;
jest.mock("../../src/web/http/apiMiddleware", () => require("../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../src/web/http/apiBody", () => require("../helpers/http").apiBodyMock());

const { readJsonBody } = require("../../src/web/http/apiBody");
const { tempStoreFile } = require("../helpers/tempStore");
const catalog = require("../../src/stores/raidplanCatalogStore");
const defaults = require("../../src/services/raidplan/raidplanCatalogDefaults");
const assign = require("../../src/services/raidplan/raidplanAssign");
const plans = require("../../src/stores/raidplanStore");
const route = require("../../src/web/apiRoutes/raidplan");
const { checkAccess } = require("../../src/web/http/apiAccess");

const ORGA = { id: "orga", isAdmin: false, access: { raids: { read: true, write: true } } };
const READER = { id: "reader", isAdmin: false, access: { raids: { read: true, write: false } } };

const { mockRes, status, json } = require("../helpers/http");
const body = (r) => { const p = json(r); return p.data || p.error; };
async function call(handler, user, payload, method = "POST") {
    mockUser = user;
    readJsonBody.mockResolvedValue(payload || {});
    const r = mockRes();
    await handler({ headers: {}, method }, r, new URL("http://x/api/raidplan/catalog"));
    return r;
}

beforeEach(() => catalog.useFile(tempStoreFile("catalog.json")));
afterAll(() => catalog.useFile());

describe("the defaults", () => {
    it("have unique ids, known kinds, valid icons and classes, and every boss key exists", () => {
        const ids = [...defaults.MOBS, ...defaults.SPELLS].map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
        const keys = new Set(plans.bossesForInstances(["bt", "hyjal", "kara", "ssc", "tk", "swp"]).map((b) => b.key));
        for (const m of defaults.MOBS) {
            expect(catalog.KINDS).toContain(m.kind);
            expect(m.name).not.toBe("");
            if (m.bossKey) expect(keys.has(m.bossKey)).toBe(true);
            if (m.icon) expect(m.icon).toMatch(catalog.ICON);
        }
        for (const s of defaults.SPELLS) {
            expect(s.icon).toMatch(catalog.ICON);
            expect(assign.ASSIGN_TYPES).toContain(s.type);
            for (const c of s.classes) expect(catalog.CLASS_IDS).toContain(c);
        }
    });
    it("bring the council, Illidan's, Anetheron's and Azgalor's adds and the curses, kicks and the rest that were asked for", () => {
        const names = catalog.listMobs().map((m) => m.name);
        for (const n of ["Gathios the Shatterer", "High Nethermancer Zerevor", "Lady Malande", "Veras Darkshadow", "Flame of Azzinoth", "Towering Infernal", "Lesser Doomguard", "Essence of Anger", "Ashtongue Channeler"]) expect(names).toContain(n);
        const council = catalog.listMobs().filter((m) => m.bossKey === "bt/the-illidari-council");
        expect(council).toHaveLength(4);
        const spells = catalog.listSpells().map((s) => s.name);
        for (const n of ["Curse of the Elements", "Curse of Recklessness", "Curse of Doom", "Curse of Agony", "Curse of Tongues", "Curse of Weakness", "Thunder Clap", "Demoralizing Shout", "Misdirection", "Fear Ward", "Kick", "Pummel", "Earth Shock", "Counterspell", "Dispel Magic", "Cleanse", "Purge", "Remove Curse", "Cure Poison", "Innervate", "Bloodlust (Horde)", "Heroism (Alliance)", "Power Infusion", "Shackle Undead", "Polymorph", "Hibernate", "Banish"]) expect(spells).toContain(n);
    });
});

describe("overrides, own entries, hiding and reset", () => {
    it("a default is overridden by saving its id, and reset brings the default back", () => {
        const r = catalog.save("mobs", { id: "d:gathios", name: "Gathios (Tank)", icon: "spell_fire_flamebolt", note: "Tank him first" });
        expect(r.entry).toMatchObject({ id: "d:gathios", name: "Gathios (Tank)", source: "override", bossKey: "bt/the-illidari-council", icon: "spell_fire_flamebolt" });
        expect(catalog.getMob("d:gathios").name).toBe("Gathios (Tank)");
        expect(catalog.reset("mobs", "d:gathios").reset).toBe(true);
        expect(catalog.getMob("d:gathios")).toMatchObject({ name: "Gathios the Shatterer", source: "default" });
    });
    it("an own entry gets a c: id, is cleaned and can be changed and deleted", () => {
        const r = catalog.save("mobs", { name: "  Boss Add  ", kind: "wat", instanceId: "bt", bossKey: "hyjal/anetheron", icon: "NOT AN ICON!" });
        expect(r.entry.id).toMatch(/^c:[0-9a-f]{10}$/);
        // a boss of another instance, an unknown kind and a bad icon are not kept
        expect(r.entry).toMatchObject({ name: "Boss Add", kind: "add", bossKey: "", icon: "", source: "custom" });
        expect(catalog.save("mobs", { id: r.entry.id, bossKey: "bt/supremus", icon: "Spell_Fire_Fireball" }).entry).toMatchObject({ bossKey: "bt/supremus", icon: "spell_fire_fireball", name: "Boss Add" });
        expect(catalog.remove("mobs", r.entry.id)).toEqual({ removed: true, hidden: false });
        expect(catalog.getMob(r.entry.id)).toBeNull();
        expect(catalog.save("mobs", { name: "" }).code).toBe("invalid");
        expect(catalog.save("mobs", { id: "c:nothere", name: "x" }).code).toBe("not_found");
    });
    it("deleting a default hides it (it can be reset), it is listed as hidden", () => {
        expect(catalog.remove("spells", "d:banish")).toEqual({ removed: true, hidden: true });
        expect(catalog.getSpell("d:banish")).toBeNull();
        expect(catalog.hiddenEntries().spells.map((s) => s.id)).toEqual(["d:banish"]);
        catalog.reset("spells", "d:banish");
        expect(catalog.getSpell("d:banish").name).toBe("Banish");
        expect(catalog.reset("spells", "c:own").code).toBe("invalid");
    });
    it("spells: type, classes and icon are checked", () => {
        const r = catalog.save("spells", { name: "Sunder", icon: "ability_warrior_sunder", type: "tank", classes: ["Warrior", "Bard"] });
        expect(r.entry).toMatchObject({ type: "tank", classes: ["Warrior"], source: "custom" });
        expect(catalog.save("spells", { name: "x", type: "nonsense" }).entry.type).toBe("other");
    });
    it("the classes of a type follow the catalog: an override that adds a class is used by the suggestions", () => {
        expect(catalog.classesOf("curse")).toEqual(["Warlock"]);
        catalog.save("spells", { id: "d:curse-of-doom", classes: ["Warlock", "Mage"] });
        expect(assign._internal.classesFor("curse")).toEqual(["Warlock", "Mage"]);
        expect(catalog.classesOf("kick")).toEqual(expect.arrayContaining(["Rogue", "Warrior", "Shaman", "Mage"]));
        expect(assign._internal.classesFor("kick").slice(0, 4)).toEqual(["Rogue", "Shaman", "Warrior", "Mage"]);
    });
});

describe("references in assignments", () => {
    it("a spell and a mob target keep their id and a snapshot of name and icon; nonsense is dropped", () => {
        const r = assign.cleanAssignments([{
            type: "curse", spell: { id: "d:curse-of-doom", name: "Curse of Doom", icon: "spell_shadow_auraofdarkness" },
            targets: [{ kind: "mob", ref: "d:gathios", name: "Gathios the Shatterer", icon: "boss:606" }, { kind: "mob", ref: "b:bt/supremus", name: "Supremus" }, { kind: "mob", ref: "no id" }],
        }, { type: "kick", spell: { id: "bad id", name: "x" } }]);
        expect(r.assignments[0].spell).toEqual({ id: "d:curse-of-doom", name: "Curse of Doom", icon: "spell_shadow_auraofdarkness" });
        expect(r.assignments[0].targets).toEqual([{ kind: "mob", ref: "d:gathios", name: "Gathios the Shatterer", icon: "boss:606" }, { kind: "mob", ref: "b:bt/supremus", name: "Supremus", icon: "" }]);
        expect(r.assignments[1].spell).toBeNull();
        expect(r.dropped).toBe(1);
    });
});

describe("the API", () => {
    it("is for the raids area: read to look, write to change", () => {
        for (const path of ["/api/raidplan/catalog", "/api/raidplan/catalog/mobs", "/api/raidplan/catalog/spells", "/api/raidplan/catalog/reset"]) {
            expect(checkAccess(path, "GET", READER)).toBeNull();
            expect(checkAccess(path, "POST", READER)).toMatchObject({ status: 403 });
            expect(checkAccess(path, "POST", ORGA)).toBeNull();
        }
    });
    it("answers the whole catalog with the choices of the forms", async () => {
        const r = await call(route.getCatalog, READER, {}, "GET");
        expect(status(r)).toBe(200);
        const d = body(r);
        expect(d.mobs.length).toBeGreaterThan(30);
        expect(d.spells.length).toBeGreaterThan(20);
        expect(d.types).toContain("curse");
        expect(d.instances.find((i) => i.id === "bt").bosses.map((b) => b.key)).toContain("bt/the-illidari-council");
    });
    it("creates, changes, deletes and resets; a reader may not", async () => {
        expect(status(await call(route.postMob, READER, { name: "x" }))).toBe(403);
        const made = body(await call(route.postMob, ORGA, { name: "Wave 1", kind: "add", instanceId: "hyjal" }));
        expect(made.entry).toMatchObject({ name: "Wave 1", instanceId: "hyjal" });
        const changed = body(await call(route.patchMob, ORGA, { id: made.entry.id, name: "Wave 2" }, "PATCH"));
        expect(changed.entry.name).toBe("Wave 2");
        expect(body(await call(route.postSpell, ORGA, { name: "My Spell", type: "cc", classes: ["Mage"] })).entry.source).toBe("custom");
        await call(route.deleteMob, ORGA, { id: "d:gathios" }, "DELETE");
        expect(catalog.getMob("d:gathios")).toBeNull();
        await call(route.postCatalogReset, ORGA, { kind: "mobs", id: "d:gathios" });
        expect(catalog.getMob("d:gathios")).not.toBeNull();
        const missing = await call(route.deleteMob, ORGA, { id: "c:nope" }, "DELETE");
        expect(status(missing)).toBe(404);
    });
});

describe("mob icons (generated by scripts/fetch-mob-icons.js)", () => {
    const generated = require("../../src/config/generated/mobIcons.json");
    const rules = require("../../scripts/data/raidplanMobIconRules");
    it("every default mob has an icon of the generated mapping, marked as similar, and a rule that says what kind of creature it is", () => {
        for (const m of defaults.MOBS) {
            const slug = m.id.replace(/^d:/, "");
            expect(rules.MOB_KINDS[slug]).toBeDefined();
            expect(generated.icons[m.id]).toBeDefined();
            const portrait = (generated.portraits || {})[m.id];
            expect(m.icon).toBe(portrait ? portrait.icon : generated.icons[m.id].icon);
            expect(m.icon).toMatch(catalog.ICON);
            expect(m.similar).toBe(!portrait);
        }
        expect(catalog.listMobs().filter((m) => m.source === "default" && !m.icon)).toEqual([]);
    });
    it("no icon name is unchecked: each one used was requested and answered 200 with an image", () => {
        const used = [...Object.values(generated.icons).map((x) => x.icon), ...Object.values(generated.choices).flat()];
        expect(used.length).toBeGreaterThan(40);
        for (const name of new Set(used)) {
            expect(generated.verified[name]).toBeDefined();
            expect(generated.verified[name].status).toBe(200);
            expect(generated.verified[name].type).toMatch(/^image\//);
        }
    });
    it("the rule table only names kinds that have icons, and the categories offered to the admin are not empty", () => {
        for (const kind of Object.values(rules.MOB_KINDS)) expect(rules.KIND_ICONS[kind]).toBeDefined();
        for (const list of Object.values(generated.choices)) expect(list.length).toBeGreaterThan(0);
    });
    it("an override does not carry the placeholder mark; the admin's own icon is not 'similar'", () => {
        const o = catalog.save("mobs", { id: "d:gathios", icon: "spell_fire_flamebolt" }).entry;
        expect(o.similar).toBeUndefined();
        expect(catalog.getMob("d:gathios").icon).toBe("spell_fire_flamebolt");
    });
});
