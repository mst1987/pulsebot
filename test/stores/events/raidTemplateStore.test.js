const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/events/raidTemplateStore");

const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";

let file;
const kara = () => ({
    name: "Karazhan PuG", versionId: "tbc", instanceIds: ["kara"], size: 10,
    composition: { tank: 2, healer: 3 },
});
const writeFile = (value) => fs.writeFileSync(file, JSON.stringify(value));
const readFile = () => JSON.parse(fs.readFileSync(file, "utf8"));

beforeEach(() => {
    file = tempStoreFile("raid-templates.json");
    store.useFile(file);
});

afterAll(() => store.useFile(null));

describe("stores/events/raidTemplateStore", () => {
    it("is empty without a file and skips entries that are no object", () => {
        expect(store.listRaidTemplates(A)).toEqual([]);
        writeFile({ templates: [null, "x", { ...kara(), id: "a", guildId: A, versionId: "tbc" }] });
        expect(store.listRaidTemplates(A).map((t) => t.id)).toEqual(["a"]);
        writeFile({ templates: "x" });
        expect(store.listRaidTemplates(A)).toEqual([]);
    });

    it("creates, updates, sorts newest first and deletes", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        const { template: a } = store.saveRaidTemplate(A, kara());
        now.mockReturnValue(2000);
        const { template: b } = store.saveRaidTemplate(A, { ...kara(), name: "Gruul" });
        expect(store.listRaidTemplates(A).map((t) => t.id)).toEqual([b.id, a.id]);
        now.mockReturnValue(3000);
        expect(store.saveRaidTemplate(A, { ...kara(), id: a.id, name: "Kara Do" }).template).toMatchObject({ id: a.id, name: "Kara Do", updatedAt: 3000 });
        expect(store.getRaidTemplate(A, a.id).name).toBe("Kara Do");
        expect(store.getRaidTemplate(A, undefined)).toBeNull();
        expect(store.saveRaidTemplate(A, { ...kara(), id: "gone" })).toMatchObject({ notFound: true });
        expect(store.saveRaidTemplate(A, { ...kara(), composition: { tank: 6, healer: 5 } }).error).toMatch(/passen nicht/);
        expect(store.deleteRaidTemplate(A, a.id)).toBe(true);
        expect(store.deleteRaidTemplate(A, a.id)).toBe(false);
        expect(readFile().templates.map((t) => t.id)).toEqual([b.id]);
        now.mockRestore();
    });

    it("imports Raid-Helper templates: new ones without size, a linked one only gets a missing name", () => {
        writeFile({ templates: [
            { ...kara(), id: "a", guildId: A, name: "", raidhelperTemplateId: "3" },
            { ...kara(), id: "b", guildId: A, raidhelperTemplateId: "4" },
        ] });
        expect(store.saveRaidTemplates(A, [{ id: "3", name: "Kara" }, { id: "4", name: "Anders" }, { id: " 9 ", name: "Neu" }, { id: "" }]))
            .toEqual({ added: 1, updated: 2 });
        const byRh = Object.fromEntries(store.listRaidTemplates(A).map((t) => [t.raidhelperTemplateId, t]));
        expect(byRh["3"]).toMatchObject({ name: "Kara", size: 10 });
        expect(byRh["4"]).toMatchObject({ name: "Karazhan PuG" });
        expect(byRh["9"]).toMatchObject({ id: "rh-9", name: "Neu", size: null, guildId: A });
        expect(store.saveRaidTemplates(A, null)).toEqual({ added: 0, updated: 0 });
    });

    it("upgrades an old entry once - migrateLegacyTemplates(), the reads leave it as it is", () => {
        writeFile({ templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }, { ...kara(), id: "a", updatedAt: 1 }] });
        expect(store.allRaidTemplates().map((t) => t.id)).toEqual(["3", "a"]);
        expect(readFile().templates[0]).toEqual({ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 });

        expect(store.migrateLegacyTemplates()).toBe(1);
        const [old, current] = readFile().templates;
        expect(old).toMatchObject({ id: "rh-3", raidhelperTemplateId: "3", size: null, createdAt: 5, updatedAt: 6 });
        expect(current).toMatchObject({ id: "a", size: 10, createdAt: 0, updatedAt: 1 });

        const before = fs.readFileSync(file, "utf8");
        expect(store.migrateLegacyTemplates()).toBe(0);
        expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    it("migrates nothing without a file", () => {
        expect(store.migrateLegacyTemplates()).toBe(0);
        expect(store.migrateToServers([A, B])).toEqual([]);
        expect(fs.existsSync(file)).toBe(false);
    });
});

describe("stores/events/raidTemplateStore per server (#1076)", () => {
    it("another server's template does not exist: no read, no update, no delete", () => {
        const { template } = store.saveRaidTemplate(A, kara());
        expect(template.guildId).toBe(A);
        expect(store.listRaidTemplates(B)).toEqual([]);
        expect(store.getRaidTemplate(B, template.id)).toBeNull();
        expect(store.saveRaidTemplate(B, { ...kara(), id: template.id, name: "Fremd" })).toMatchObject({ notFound: true });
        expect(store.deleteRaidTemplate(B, template.id)).toBe(false);
        expect(store.getRaidTemplate(A, template.id).name).toBe("Karazhan PuG");
    });

    it("an invalid server holds nothing and takes nothing", () => {
        writeFile({ templates: [{ ...kara(), id: "a", guildId: A }, { ...kara(), id: "old" }] });
        const before = fs.readFileSync(file, "utf8");
        for (const bad of ["", null, undefined, "g1"]) {
            expect(store.listRaidTemplates(bad)).toEqual([]);
            expect(store.getRaidTemplate(bad, "a")).toBeNull();
            expect(store.getRaidTemplate(bad, "old")).toBeNull();
            expect(store.saveRaidTemplate(bad, kara()).error).toBeTruthy();
            expect(store.saveRaidTemplates(bad, [{ id: "9", name: "x" }])).toEqual({ added: 0, updated: 0 });
            expect(store.deleteRaidTemplate(bad, "a")).toBe(false);
        }
        expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    it("a body never chooses a template's server or origin", () => {
        const { template } = store.saveRaidTemplate(A, { ...kara(), guildId: B, originId: "x" });
        expect(template).toMatchObject({ guildId: A, originId: "" });
        const { template: updated } = store.saveRaidTemplate(A, { ...kara(), id: template.id, guildId: B, originId: "x" });
        expect(updated).toMatchObject({ guildId: A, originId: "" });
        expect(store.listRaidTemplates(B)).toEqual([]);
    });

    it("an old id finds the server's own copy, never the other server's original; the exact id wins", () => {
        writeFile({ templates: [
            { ...kara(), id: "k1", guildId: A, name: "Original" },
            { ...kara(), id: "k2", guildId: B, originId: "k1", name: "Kopie" },
            { ...kara(), id: "k3", guildId: B, originId: "k4", name: "Kopie 2" },
            { ...kara(), id: "k4", guildId: B, name: "Eigen" },
        ] });
        expect(store.getRaidTemplate(B, "k1").name).toBe("Kopie");
        expect(store.getRaidTemplate(A, "k1").name).toBe("Original");
        expect(store.getRaidTemplate(C, "k1")).toBeNull();
        expect(store.getRaidTemplate(B, "k4").name).toBe("Eigen");
    });

    it("an update and a delete name the real id, not the one the copy came from", () => {
        writeFile({ templates: [
            { ...kara(), id: "k1", guildId: A },
            { ...kara(), id: "k2", guildId: B, originId: "k1" },
        ] });
        expect(store.saveRaidTemplate(B, { ...kara(), id: "k1" })).toMatchObject({ notFound: true });
        expect(store.deleteRaidTemplate(B, "k1")).toBe(false);
        expect(store.allRaidTemplates()).toHaveLength(2);
    });

    it("the same Raid-Helper import on two servers stays apart, with ids unique over all servers", () => {
        expect(store.saveRaidTemplates(A, [{ id: "9", name: "Neu" }])).toEqual({ added: 1, updated: 0 });
        expect(store.saveRaidTemplates(B, [{ id: "9", name: "Neu" }])).toEqual({ added: 1, updated: 0 });
        expect(store.saveRaidTemplates(B, [{ id: "9", name: "Neu" }])).toEqual({ added: 0, updated: 1 });
        const [a] = store.listRaidTemplates(A);
        const [b] = store.listRaidTemplates(B);
        expect(a.id).toBe("rh-9");
        expect(b.id).not.toBe("rh-9");
        expect(b.raidhelperTemplateId).toBe("9");
    });
});

describe("stores/events/raidTemplateStore migrateToServers (#1076)", () => {
    // Real shapes: a full current template, one migrated from Raid-Helper without size, one with every optional field.
    const REAL = [
        {
            id: "lq8x2k3", name: "Kara Donnerstag", versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: { min: 2, max: null }, ranged: { min: 1, max: 3 } },
            requiredBuffs: ["bloodlust"], signupDeadline: { hoursBefore: 24 }, durationMinutes: 180, fairness: true, wishes: true,
            overflow: "waitlist", lockAtLimit: true, color: "#336699", image: { mode: "banner", url: "https://x.test/a.png" },
            emojiStyle: "gold", raidhelperTemplateId: "", createdAt: 100, updatedAt: 300,
        },
        {
            id: "rh-3", name: "GDKP Kara", versionId: "tbc", instanceIds: [], size: null,
            composition: { tank: 0, healer: 0, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
            durationMinutes: null, fairness: false, wishes: false, raidhelperTemplateId: "3", createdAt: 5, updatedAt: 6,
        },
        {
            id: "fo1", name: "Forever MC", versionId: "forever", instanceIds: ["forever-mc"], size: 40,
            composition: { tank: 3, healer: 8, melee: null, ranged: null }, requiredBuffs: [], signupDeadline: null,
            durationMinutes: 120, fairness: false, wishes: false, raidhelperTemplateId: "", createdAt: 7, updatedAt: 8,
        },
    ];
    const without = (t, ...keys) => Object.fromEntries(Object.entries(t).filter(([k]) => !keys.includes(k)));

    it("one server: every template stays with its id and all it holds", () => {
        writeFile({ templates: REAL });
        const lines = store.migrateToServers([A]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("3 Vorlage(n)");
        const after = readFile().templates;
        expect(after.map((t) => t.id).sort()).toEqual(REAL.map((t) => t.id).sort());
        for (const t of REAL) {
            expect(after.find((x) => x.id === t.id)).toEqual({ ...t, guildId: A, originId: "" });
        }
        expect(store.listRaidTemplates(A)).toHaveLength(3);
    });

    it("several servers: the first keeps the id, each further one a copy with originId, nothing lost, ids unique", () => {
        writeFile({ templates: REAL });
        store.migrateToServers([A, B, C]);
        const after = readFile().templates;
        expect(after).toHaveLength(9);
        expect(new Set(after.map((t) => t.id)).size).toBe(9);
        expect(after.some((t) => !t.guildId)).toBe(false);
        for (const t of REAL) {
            expect(store.getRaidTemplate(A, t.id)).toMatchObject({ id: t.id, originId: "", name: t.name });
            for (const server of [B, C]) {
                const copy = after.find((x) => x.guildId === server && x.originId === t.id);
                expect(copy.id).not.toBe(t.id);
                expect(without(copy, "id", "guildId", "originId")).toEqual(without(t, "id"));
            }
        }
    });

    it("a second run changes nothing, also with one more server on the list", () => {
        writeFile({ templates: REAL });
        store.migrateToServers([A, B]);
        const before = fs.readFileSync(file, "utf8");
        expect(store.migrateToServers([A, B])).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(before);
        // a server listed later starts empty, never from another server's data
        expect(store.migrateToServers([A, B, C])).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(before);
        expect(store.listRaidTemplates(C)).toEqual([]);
    });

    it("no server listed: one warning, the data stays and the next start takes it over", () => {
        writeFile({ templates: REAL });
        const before = fs.readFileSync(file, "utf8");
        for (const none of [[], null, ["", "kein-server"]]) {
            const lines = store.migrateToServers(none);
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain(": WARNUNG ");
        }
        expect(fs.readFileSync(file, "utf8")).toBe(before);
        expect(fs.existsSync(`${file}.pre-1076`)).toBe(false);
        expect(store.migrateToServers([A])).toHaveLength(1);
        expect(store.listRaidTemplates(A)).toHaveLength(3);
    });

    it("keeps a backup of the file as it was, and does not overwrite it on a later run", () => {
        writeFile({ templates: REAL });
        const original = fs.readFileSync(file, "utf8");
        store.migrateToServers([A, B]);
        expect(fs.readFileSync(`${file}.pre-1076`, "utf8")).toBe(original);

        // a global entry turning up later (restored by hand) goes the same way, the first backup stays
        const current = readFile().templates;
        writeFile({ templates: [...current, { ...REAL[0], id: "late" }] });
        store.migrateToServers([A, B]);
        expect(fs.readFileSync(`${file}.pre-1076`, "utf8")).toBe(original);
        expect(store.getRaidTemplate(B, "late")).toMatchObject({ originId: "late" });
    });

    it("a run that broke off goes on: what was copied stays, no second copy", () => {
        // the copies were written, the global entry was not removed yet
        writeFile({ templates: [
            { ...REAL[0] },
            { ...REAL[0], id: "copy-a", guildId: A, originId: REAL[0].id },
        ] });
        const lines = store.migrateToServers([A, B]);
        expect(lines).toHaveLength(1);
        const after = readFile().templates;
        expect(after.filter((t) => t.guildId === A)).toHaveLength(1);
        expect(after.filter((t) => t.guildId === B)).toHaveLength(1);
        expect(after.filter((t) => !t.guildId)).toHaveLength(0);
        expect(store.getRaidTemplate(A, REAL[0].id).id).toBe("copy-a");
        expect(store.getRaidTemplate(B, REAL[0].id)).toMatchObject({ name: REAL[0].name });
    });

    it("the global entry stays when the copies are not on disk afterwards", () => {
        writeFile({ templates: REAL });
        // the backup is written, the store's own atomic writes get lost
        const spy = jest.spyOn(fs, "renameSync").mockImplementation((from) => fs.unlinkSync(from));
        let lines;
        try {
            lines = store.migrateToServers([A, B]);
        } finally {
            spy.mockRestore();
        }
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(": WARNUNG ");
        expect(readFile().templates.map((t) => t.id)).toEqual(REAL.map((t) => t.id));
    });

    it("a template already on a server is left alone", () => {
        const own = { ...REAL[0], id: "own", guildId: B, originId: "" };
        writeFile({ templates: [own] });
        expect(store.migrateToServers([A, B])).toEqual([]);
        expect(readFile().templates).toEqual([own]);
    });
});
