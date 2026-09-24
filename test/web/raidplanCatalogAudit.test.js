// The defaults of the catalog are TBC-correct (src/web/raidplanCatalogDefaults.js): nothing that only exists in a later game version, and the game version filter.
const defaults = require("../../src/web/raidplanCatalogDefaults");
const store = require("../../src/web/raidplanCatalogStore");
const assign = require("../../src/web/raidplanAssign");
const { tempStoreFile } = require("../helpers/tempStore");

// classes and spells per the TBC (2.4.3) class lists; Death Knights only came with Wrath of the Lich King
const TBC_CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const ORDER = ["classic", "tbc", "wotlk"];

describe("catalog defaults", () => {
    beforeEach(() => store.useFile(tempStoreFile("catalog-audit.json")));
    it("know only the nine TBC classes", () => {
        expect(assign.CLASS_IDS).toEqual(TBC_CLASSES);
        for (const s of defaults.SPELLS) for (const c of s.classes) expect(TBC_CLASSES).toContain(c);
    });
    it("a spell that exists only after TBC is limited to those versions (SINCE), and nothing else is", () => {
        for (const s of defaults.SPELLS) {
            const slug = s.id.replace(/^d:/, "");
            const since = defaults.SINCE[slug] || "classic";
            if (ORDER.indexOf(since) > ORDER.indexOf("tbc")) expect({ slug, versions: s.versions }).toEqual({ slug, versions: [since] });
            else expect({ slug, versions: s.versions }).toEqual({ slug, versions: undefined });
        }
    });
    it("Misdirection is a hunter's in TBC; Tricks of the Trade is not offered there", () => {
        const md = defaults.SPELLS.filter((s) => s.type === "md");
        expect(md.find((s) => s.id === "d:misdirection").classes).toEqual(["Hunter"]);
        expect(store.classesOf("md", "tbc")).toEqual(["Hunter"]);
        expect(store.catalogView("tbc").spells.some((s) => s.id === "d:tricks-of-the-trade")).toBe(false);
        expect(store.classesOf("md", "wotlk")).toEqual(["Hunter", "Rogue"]);
        expect(store.catalogView("wotlk").spells.some((s) => s.id === "d:tricks-of-the-trade")).toBe(true);
        expect(store.catalogView().spells.some((s) => s.id === "d:tricks-of-the-trade")).toBe(true);
    });
    it("the classes for a misdirect suggestion are hunters only in TBC, and the suggestion never takes a rogue", () => {
        expect(assign.classesFor("md", [], false, "tbc")).toEqual(["Hunter"]);
        const roster = [{ userId: "r", classId: "Rogue", role: "melee" }, { userId: "h", classId: "Hunter", role: "ranged" }];
        const r = assign.suggest("md", { slots: [{ kind: "tank", n: 1, userId: "t" }], roster, groups: [1], versionId: "tbc" });
        expect(r.map((a) => a.assignees[0])).toEqual(["user:h"]);
        expect(assign.suggest("md", { slots: [{ kind: "tank", n: 1, userId: "t" }], roster: [roster[0]], groups: [1], versionId: "tbc" })).toEqual([]);
    });
    it("keeps the rest of the audit: kicks by class, curses to warlocks, Fear Ward to priests", () => {
        const of = (type) => defaults.SPELLS.filter((s) => s.type === type).map((s) => [s.name, s.classes]);
        expect(of("kick")).toEqual([["Kick", ["Rogue"]], ["Pummel", ["Warrior"]], ["Shield Bash", ["Warrior"]], ["Earth Shock", ["Shaman"]], ["Counterspell", ["Mage"]]]);
        for (const [, cls] of of("curse")) expect(cls).toEqual(["Warlock"]);
        expect(of("fearward")).toEqual([["Fear Ward", ["Priest"]]]);
    });
    it("versions of a custom entry are kept clean", () => {
        const saved = store.save("spell", { name: "X", type: "md", classes: ["Rogue"], versions: ["wotlk", "WOTLK!!", "wotlk"] });
        expect(saved.entry.versions).toEqual(["wotlk"]);
        expect(store.inVersion(saved.entry, "tbc")).toBe(false);
        expect(store.inVersion({ name: "all" }, "tbc")).toBe(true);
    });
});
