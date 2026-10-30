// The raid plan library per server (#945, docs/raidplan.md "Bibliothek je Server"): templates and tactic profiles
// belong to one server, and the one-off migration copies the old global library onto every listed server.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const templates = require("../../src/stores/raidplan/raidplanTemplateStore");
const profiles = require("../../src/stores/raidplan/raidplanProfileStore");
const plans = require("../../src/stores/raidplan/raidplanStore");

const A = "100000000000000001";
const B = "100000000000000002";
const BOSS = "bt/supremus";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
// a board with an animation (#719): the copies keep it as it is
const BOARD = { notes: "Tank links", scenes: [{ id: "sc1", title: "Feuer ausweichen", loop: false, length: 4000, frames: [] }] };

let templateFile;
let profileFile;
beforeEach(() => {
    plans.useFile(tempStoreFile("plans.json"));
    templateFile = tempStoreFile("templates.json");
    profileFile = tempStoreFile("profiles.json");
    templates.useFile(templateFile);
    profiles.useFile(profileFile);
});
afterAll(() => {
    plans.useFile();
    templates.useFile();
    profiles.useFile();
});

const stored = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

describe("templates per server", () => {
    it("lists, reads, changes and deletes a template only on its own server", () => {
        const t = templates.createTemplate(A, { name: "BT", instanceIds: ["bt"] }).template;
        expect(t.serverId).toBe(A);
        expect(templates.listTemplates(A).map((x) => x.id)).toEqual([t.id]);
        expect(templates.listTemplates(B)).toEqual([]);
        expect(templates.getTemplate(B, t.id)).toBeNull();
        expect(templates.updateTemplate(B, t.id, { name: "Fremd" }).code).toBe("not_found");
        expect(templates.duplicateTemplate(B, t.id).code).toBe("not_found");
        expect(templates.deleteTemplate(B, t.id)).toBe(false);
        expect(templates.getTemplate(A, t.id).name).toBe("BT");
    });

    it("has nothing without a server (fail closed)", () => {
        templates.createTemplate(A, { name: "BT", instanceIds: ["bt"] });
        expect(templates.listTemplates("")).toEqual([]);
        expect(templates.listTemplates("nope")).toEqual([]);
        expect(templates.createTemplate("", { name: "BT", instanceIds: ["bt"] }).error).toBeTruthy();
    });

    it("duplicates on the same server only", () => {
        const t = templates.createTemplate(A, { name: "BT", instanceIds: ["bt"] }).template;
        const copy = templates.duplicateTemplate(A, t.id).template;
        expect(copy.serverId).toBe(A);
        expect(templates.listTemplates(A)).toHaveLength(2);
        expect(templates.listTemplates(B)).toEqual([]);
    });

    it("finds a server's copy of a migrated template by the old id (a plan made before #945 names that one)", () => {
        fs.writeFileSync(templateFile, JSON.stringify({ templates: [
            { id: "abc123", serverId: A, name: "BT", instanceIds: ["bt"], bosses: {}, version: 1 },
            { id: "def456", serverId: B, originId: "abc123", name: "BT", instanceIds: ["bt"], bosses: {}, version: 1 },
        ] }));
        expect(templates.getTemplate(A, "abc123").id).toBe("abc123");
        expect(templates.getTemplate(B, "abc123").id).toBe("def456");
        expect(templates.getTemplate(B, "def456").id).toBe("def456");
    });
});

describe("tactic profiles per server", () => {
    it("lists, reads, changes and deletes a profile only on its own server", () => {
        const p = profiles.createProfile(A, { name: "Tanks", category: "Tank" }).profile;
        expect(profiles.listProfiles(A).map((x) => x.id)).toEqual([p.id]);
        expect(profiles.listProfiles(B)).toEqual([]);
        expect(profiles.getProfile(B, p.id)).toBeNull();
        expect(profiles.updateProfile(B, p.id, { name: "Fremd" }).code).toBe("not_found");
        expect(profiles.deleteProfile(B, p.id)).toBe(false);
        expect(profiles.getProfile(A, p.id).name).toBe("Tanks");
    });
});

describe("migrateToServers (templates)", () => {
    const OLD = [
        { id: "abc123", name: "BT Standard", category: "Raid", instanceIds: ["bt"], versionId: "tbc", bosses: { [BOSS]: BOARD }, version: 3 },
        // made for server B before #945 (the old filter): it goes onto B only
        { id: "t1", name: "Nur B", instanceIds: ["bt"], versionId: "tbc", guildId: B, bosses: {}, version: 1 },
    ];
    function seed() {
        fs.writeFileSync(templateFile, JSON.stringify({ templates: OLD }));
        plans.saveMap(plans.templateMapKey("abc123", BOSS), PNG);
    }

    it("copies every global template onto every server, keeps the animations and copies the room maps", () => {
        seed();
        const lines = templates.migrateToServers([A, B]);
        expect(lines).toEqual([expect.stringContaining("2 Vorlage(n) je Server übernommen (#945) - 3 Kopie(n) auf 2 Server")]);

        const onA = templates.listTemplates(A);
        const onB = templates.listTemplates(B);
        expect(onA.map((t) => t.name)).toEqual(["BT Standard"]);
        expect(onB.map((t) => t.name).sort()).toEqual(["BT Standard", "Nur B"]);
        // the first copy keeps the id (its maps stay), the next one gets its own id with the old one as origin
        const a = onA[0];
        const b = onB.find((t) => t.name === "BT Standard");
        expect(a.id).toBe("abc123");
        expect(b.id).not.toBe("abc123");
        expect(b.originId).toBe("abc123");
        expect(a.bosses).toEqual({ [BOSS]: BOARD });
        expect(b.bosses).toEqual({ [BOSS]: BOARD });
        expect(b.version).toBe(3);
        expect(plans.mapVersion(plans.templateMapKey("abc123", BOSS))).toBeTruthy();
        expect(plans.mapVersion(plans.templateMapKey(b.id, BOSS))).toBeTruthy();
        // the global entries are gone, the backup holds them
        expect(stored(templateFile).templates.every((t) => t.serverId)).toBe(true);
        expect(stored(`${templateFile}.pre-945`).templates).toEqual(OLD);
    });

    it("loses nothing and copies nothing twice on a second run", () => {
        seed();
        templates.migrateToServers([A, B]);
        const after = stored(templateFile);
        expect(templates.migrateToServers([A, B])).toEqual([]);
        expect(stored(templateFile)).toEqual(after);
    });

    it("finishes a run that stopped after the copies: no second copy, then the globals go", () => {
        seed();
        // the copy for A was written, the globals were not removed yet
        const file = stored(templateFile);
        file.templates.push({ ...OLD[0], serverId: A, originId: "" });
        fs.writeFileSync(templateFile, JSON.stringify(file));
        templates.migrateToServers([A, B]);
        expect(templates.listTemplates(A)).toHaveLength(1);
        expect(templates.listTemplates(B)).toHaveLength(2);
        expect(stored(templateFile).templates).toHaveLength(3);
    });

    it("copies the missing room maps of copies already stored, and only then removes the globals", () => {
        seed();
        // a run stopped after writing both copies, before the map copy
        const file = stored(templateFile);
        file.templates.push({ ...OLD[0], serverId: A, originId: "" });
        file.templates.push({ ...OLD[0], id: "zzz999", serverId: B, originId: "abc123" });
        file.templates.push({ ...OLD[1], serverId: B, originId: "" });
        fs.writeFileSync(templateFile, JSON.stringify(file));
        expect(plans.mapVersion(plans.templateMapKey("zzz999", BOSS))).toBe(0);

        const lines = templates.migrateToServers([A, B]);
        expect(lines).toEqual([expect.stringContaining("0 Kopie(n)")]);
        expect(plans.mapVersion(plans.templateMapKey("zzz999", BOSS))).toBeTruthy();
        expect(stored(templateFile).templates.every((t) => t.serverId)).toBe(true);
    });

    it("keeps the globals when a room map cannot be copied, and the next start copies it", () => {
        seed();
        const spy = jest.spyOn(plans, "saveMap").mockImplementationOnce(() => { throw new Error("disk full"); });
        expect(templates.migrateToServers([A, B])).toEqual([expect.stringContaining("WARNUNG")]);
        const copy = templates.listTemplates(B).find((t) => t.originId === "abc123");
        expect(plans.mapVersion(plans.templateMapKey(copy.id, BOSS))).toBe(0);
        expect(stored(templateFile).templates.filter((t) => !t.serverId)).toHaveLength(2);

        spy.mockImplementationOnce(() => ({ code: "invalid", error: "kaputt" }));
        expect(templates.migrateToServers([A, B])).toEqual([expect.stringContaining("WARNUNG")]);
        expect(stored(templateFile).templates.filter((t) => !t.serverId)).toHaveLength(2);

        spy.mockRestore();
        expect(templates.migrateToServers([A, B])).toEqual([expect.stringContaining("0 Kopie(n)")]);
        expect(plans.mapVersion(plans.templateMapKey(copy.id, BOSS))).toBeTruthy();
        expect(templates.listTemplates(B).filter((t) => t.originId === "abc123")).toHaveLength(1);
        expect(stored(templateFile).templates.every((t) => t.serverId)).toBe(true);
    });

    it("keeps the global templates without a server and warns", () => {
        seed();
        const lines = templates.migrateToServers([]);
        expect(lines).toEqual([expect.stringContaining("WARNUNG")]);
        expect(stored(templateFile).templates).toEqual(OLD);
        expect(fs.existsSync(`${templateFile}.pre-945`)).toBe(false);
    });

    it("does not overwrite an earlier backup", () => {
        seed();
        fs.writeFileSync(`${templateFile}.pre-945`, "erste Sicherung");
        templates.migrateToServers([A]);
        expect(fs.readFileSync(`${templateFile}.pre-945`, "utf8")).toBe("erste Sicherung");
    });
});

describe("migrateToServers (tactic profiles)", () => {
    const OLD = [
        { id: "p1", name: "Tanks", category: "Tank", targets: [{ title: "MT" }], notes: "", versionId: "tbc" },
        { id: "p2", name: "Heiler", category: "Heiler", targets: [], notes: "", versionId: "tbc" },
    ];

    it("copies every profile with its id onto every server (a board's profileId finds its server's copy)", () => {
        fs.writeFileSync(profileFile, JSON.stringify({ profiles: OLD }));
        const lines = profiles.migrateToServers([A, B]);
        expect(lines).toEqual([expect.stringContaining("2 Taktik-Profil(e) je Server übernommen (#945) - 4 Kopie(n) auf 2 Server")]);
        for (const server of [A, B]) {
            expect(profiles.listProfiles(server).map((p) => p.id).sort()).toEqual(["p1", "p2"]);
            expect(profiles.getProfile(server, "p1").targets).toEqual([expect.objectContaining({ title: "MT" })]);
        }
        expect(stored(profileFile).profiles).toHaveLength(4);
        expect(stored(`${profileFile}.pre-945`).profiles).toEqual(OLD);
    });

    it("is idempotent, and a change on one server stays there", () => {
        fs.writeFileSync(profileFile, JSON.stringify({ profiles: OLD }));
        profiles.migrateToServers([A, B]);
        const after = stored(profileFile);
        expect(profiles.migrateToServers([A, B])).toEqual([]);
        expect(stored(profileFile)).toEqual(after);
        profiles.updateProfile(B, "p1", { name: "Tanks B" });
        expect(profiles.getProfile(A, "p1").name).toBe("Tanks");
        expect(profiles.getProfile(B, "p1").name).toBe("Tanks B");
    });

    it("keeps the profiles without a server and warns", () => {
        fs.writeFileSync(profileFile, JSON.stringify({ profiles: OLD }));
        expect(profiles.migrateToServers([])).toEqual([expect.stringContaining("WARNUNG")]);
        expect(stored(profileFile).profiles).toEqual(OLD);
    });
});
