// Loot-Council profiles (#676): the store on its own - normalising, the
// virtual "Standard", creating/copying/renaming/deleting and the category
// entries. The migration from #668's files is councilProfilesStore.migration.test.js.
const fs = require("fs");
const store = require("../../src/stores/councilProfilesStore");
const { tempStoreFile } = require("../helpers/tempStore");

let file;
beforeEach(() => {
    file = tempStoreFile("council-profiles.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

const onDisk = () => JSON.parse(fs.readFileSync(file, "utf8"));

describe("stores/councilProfilesStore without anything stored", () => {
    it("answers a virtual Standard with the defaults and writes nothing", () => {
        const def = store.defaultProfile();
        expect(def).toMatchObject({ id: "standard", name: "Standard", stored: false });
        expect(def.weights.classes.trinket).toBe(2);
        expect(def.weights.need).toEqual({ drought: 45, share: 30, need: 10, tenure: 15 });
        expect(def.view).toEqual({ role: "caster", tiers: [], contents: [], bisTier: "", version: "" });
        expect(store.listProfiles().map((p) => p.id)).toEqual(["standard"]);
        expect(store.getProfile("standard")).toMatchObject({ stored: false });
        expect(store.getProfile("p-x")).toBeNull();
        expect(store.getProfile("")).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
        expect(store.isMigrated()).toBe(false);
    });
});

describe("stores/councilProfilesStore create, copy, rename", () => {
    it("creates a profile with the defaults and writes Standard down with it", () => {
        const p = store.createProfile({ name: "  Main-Raid   T6 " }, { by: "Admin", now: 5 });
        expect(p).toMatchObject({ name: "Main-Raid T6", at: 5, by: "Admin", stored: true });
        expect(p.id).toMatch(/^p-[0-9a-f]{8}$/);
        expect(Object.keys(onDisk().profiles).sort()).toEqual([p.id, "standard"].sort());
        expect(store.listProfiles().map((x) => x.name)).toEqual(["Standard", "Main-Raid T6"]);
    });

    it("copies weights and view of another profile", () => {
        const a = store.createProfile({ name: "A" });
        store.updateProfile(a.id, { weights: { tenureDays: 30, items: { 30099: { weight: 2.5, name: "Tether" } } }, view: { role: "healer", tiers: ["t6"] } });
        const b = store.createProfile({ name: "B", copyFrom: a.id });
        expect(b.weights.tenureDays).toBe(30);
        expect(b.weights.items).toEqual({ 30099: { weight: 2.5, name: "Tether" } });
        expect(b.view).toMatchObject({ role: "healer", tiers: ["t6"] });
    });

    it("refuses bad names, a taken name (any case), an unknown source and the 51st profile", () => {
        const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
        expect(codeOf(() => store.createProfile({ name: "" }))).toBe("invalid_name");
        expect(codeOf(() => store.createProfile({ name: 5 }))).toBe("invalid_name");
        expect(codeOf(() => store.createProfile({ name: "x".repeat(41) }))).toBe("name_too_long");
        expect(codeOf(() => store.createProfile({ name: "standard" }))).toBe("name_taken");
        expect(codeOf(() => store.createProfile({ name: "C", copyFrom: "p-gone" }))).toBe("not_found");
        for (let i = 0; i < store.LIMITS.profiles - 1; i += 1) store.createProfile({ name: `P${i}` });
        expect(codeOf(() => store.createProfile({ name: "Zu viel" }))).toBe("profile_limit");
    });

    it("renames and replaces weights and view whole, normalised", () => {
        const p = store.createProfile({ name: "Alt" });
        const next = store.updateProfile(p.id, { name: "Neu", weights: { classes: { trinket: 9 } }, view: { role: "boss", tiers: ["<x>", "t5"] } }, { by: "X", now: 9 });
        expect(next).toMatchObject({ name: "Neu", at: 9, by: "X" });
        expect(next.weights.classes.trinket).toBe(5);
        expect(next.weights.classes.weapon).toBe(1.5);
        expect(next.view).toEqual({ role: "caster", tiers: ["t5"], contents: [], bisTier: "", version: "" });
        expect(() => store.updateProfile("p-gone", { name: "x" })).toThrow(expect.objectContaining({ code: "not_found" }));
        expect(() => store.updateProfile(p.id, { name: "Standard" })).toThrow(expect.objectContaining({ code: "name_taken" }));
        // the default can be edited too - it is written down on the first change
        expect(store.updateProfile("standard", { weights: { tenureDays: 60 } }).weights.tenureDays).toBe(60);
    });
});

describe("stores/councilProfilesStore delete and category entries", () => {
    it("deletes an unused profile, never the default, never one in use", () => {
        const p = store.createProfile({ name: "Weg" });
        expect(() => store.deleteProfile("standard")).toThrow(expect.objectContaining({ code: "profile_default" }));
        expect(() => store.deleteProfile(p.id, { inUse: (id) => id === p.id })).toThrow(expect.objectContaining({ code: "profile_in_use" }));
        store.setCategoryProfile("c1", p.id);
        expect(store.categoryProfileId("c1")).toBe(p.id);
        expect(store.categoryProfiles()).toEqual({ c1: p.id });
        expect(() => store.deleteProfile(p.id)).toThrow(expect.objectContaining({ code: "profile_in_use" }));
        store.setCategoryProfile("c1", "");
        expect(store.categoryProfileId("c1")).toBe("");
        expect(store.deleteProfile(p.id)).toBe(true);
        expect(store.getProfile(p.id)).toBeNull();
        expect(() => store.deleteProfile(p.id)).toThrow(expect.objectContaining({ code: "not_found" }));
        expect(() => store.setCategoryProfile("c1", "p-gone")).toThrow(expect.objectContaining({ code: "not_found" }));
        expect(store.setCategoryProfile("", "standard")).toBe(false);
    });

    it("drops category entries to unknown profiles and repairs a missing default on read", () => {
        fs.writeFileSync(file, JSON.stringify({
            profiles: { "p-a": { name: "A" }, "bad id!": { name: "B" } },
            defaultId: "p-gone",
            categories: { c1: "p-a", c2: "p-gone" },
            migrated: true,
        }));
        expect(store.listProfiles().map((p) => p.id)).toEqual(["p-a"]);
        expect(store.defaultProfileId()).toBe("p-a");
        expect(store.categoryProfiles()).toEqual({ c1: "p-a" });
        expect(store.isMigrated()).toBe(true);
    });

    it("normalises a stored profile strictly", () => {
        expect(store.normalizeProfile({ name: "x" }, "")).toBeNull();
        expect(store.normalizeProfile(null, "a")).toBeNull();
        expect(store.normalizeProfile({ junk: 1 }, "standard")).toMatchObject({ id: "standard", name: "Standard" });
        expect(Object.keys(store.normalizeProfile({ name: "A" }, "p-a")).sort()).toEqual(["at", "by", "id", "name", "view", "weights"]);
    });
});
