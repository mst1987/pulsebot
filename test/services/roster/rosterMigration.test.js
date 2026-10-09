const { categoriesToMigrate, categoryFacts, primaryEventGuild, migrationLine } = require("../../../src/services/roster/rosterMigration");

const G1 = "1100000000000000001";
const G2 = "1100000000000000002";

describe("services/roster/rosterMigration primaryEventGuild", () => {
    it("the first event server, else the old single guildId, else nothing", () => {
        expect(primaryEventGuild({ discordServers: { eventGuilds: [{ guildId: "" }, { guildId: G2 }] }, guildId: G1 })).toBe(G2);
        expect(primaryEventGuild({ discordServers: {}, guildId: G1 })).toBe(G1);
        expect(primaryEventGuild(null)).toBe("");
    });
});

describe("services/roster/rosterMigration categoryFacts", () => {
    it("takes server and name from the snapshot first, then from the newest event", () => {
        const facts = categoryFacts({
            snapshot: { [G1]: { c1: "Donnerstag" }, bad: "x" },
            events: [
                { guildId: G2, categoryId: "c2", categoryName: "Alt", startTime: 1 },
                { guildId: G2, categoryId: "c2", categoryName: "Neu", startTime: 5 },
                { guildId: G2, categoryId: "c1", categoryName: "Event-Name", startTime: 9 },
                { guildId: "", categoryId: "", categoryName: "x" },
                null,
            ],
        });
        expect(facts.get("c1")).toEqual({ guildId: G1, name: "Donnerstag" });
        expect(facts.get("c2")).toEqual({ guildId: G2, name: "Neu" });
        expect(facts.size).toBe(2);
    });

    it("works without input", () => {
        expect(categoryFacts().size).toBe(0);
        expect(categoryFacts({ snapshot: null, events: null }).size).toBe(0);
    });
});

describe("services/roster/rosterMigration categoriesToMigrate", () => {
    const config = {
        categoryIds: ["c3", "c1"],
        categoryRoles: { c1: ["10"], c2: ["20", ""] },
        categoryVersion: { c3: "forever" },
        discordServers: { eventGuilds: [{ guildId: G1 }] },
    };

    it("one entry per category with roles or assignments, configured ones first", () => {
        const out = categoriesToMigrate({
            config,
            assignments: { c3: { u1: "Devi Res", u2: "  ", "": "x" }, c4: { u3: "Kes-Realm" }, c1: "junk", c5: {} },
            snapshot: { [G2]: { c4: "Freitag" } },
        });
        expect(out).toEqual([
            { categoryId: "c3", guildId: G1, name: "c3", versionId: "forever", roleIds: [], members: { u1: { key: "forever~devi res", name: "Devi Res" } } },
            { categoryId: "c1", guildId: G1, name: "c1", versionId: "tbc", roleIds: ["10"], members: {} },
            { categoryId: "c2", guildId: G1, name: "c2", versionId: "tbc", roleIds: ["20"], members: {} },
            { categoryId: "c4", guildId: G2, name: "Freitag", versionId: "tbc", roleIds: [], members: { u3: { key: "kes", name: "Kes-Realm" } } },
        ]);
    });

    it("nothing to migrate for an empty install", () => {
        expect(categoriesToMigrate()).toEqual([]);
        expect(categoriesToMigrate({ config: { categoryIds: ["c1"] } })).toEqual([]);
    });
});

describe("services/roster/rosterMigration migrationLine", () => {
    it("one line with every roster, nothing for none", () => {
        expect(migrationLine([])).toBe("");
        expect(migrationLine([
            { name: "Donnerstag", members: 2, roleIds: 1, guildId: G1 },
            { name: "c9", members: 0, roleIds: 0, guildId: "" },
        ])).toBe("rosters.json: 2 Roster aus den Raid-Kategorien übernommen (Rollen + Charakter-Zuordnungen, #653) - Donnerstag (2 Mitglied(er), 1 Rolle(n)), c9 (0 Mitglied(er), 0 Rolle(n), ohne Server)");
    });
});
