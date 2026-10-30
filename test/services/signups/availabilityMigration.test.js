jest.mock("../../../src/services/discord/discord", () => ({ guildMembership: jest.fn() }));
jest.mock("../../../src/stores/settings/configStore", () => ({ getConfig: jest.fn(() => ({})) }));

const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const availabilityStore = require("../../../src/stores/events/availabilityStore");
const migrationMarkStore = require("../../../src/stores/settings/migrationMarkStore");
const configStore = require("../../../src/stores/settings/configStore");
const discord = require("../../../src/services/discord/discord");
const {
    MARK, migrateAvailabilityServers, runAvailabilityMigration, serverOrder,
} = require("../../../src/services/signups/availabilityMigration");

const A = "guild-a";
const B = "guild-b";
const C = "guild-c";
const config = { discordServers: { servers: [{ guildId: A }, { guildId: B }, { guildId: C }] } };

let file;

function entry(id, userId, extra = {}) {
    return {
        id, userId, kind: "absence", from: "2026-11-01", to: "2026-11-03", comment: "",
        skip: ["ev-skip"], applied: { "ev-1": { at: 1, ok: true } }, createdBy: userId, createdAt: 1, via: "", ...extra,
    };
}

function seed(entries) {
    fs.writeFileSync(file, JSON.stringify({ entries, panels: [], links: {}, features: {} }));
}

const stored = () => JSON.parse(fs.readFileSync(file, "utf8")).entries;
const byId = (id) => stored().find((e) => e.id === id);

/** userId -> { guildId: answer } (missing = null, unknown) */
const membershipFrom = (map) => jest.fn(async (guildId, userId) => {
    const answers = map[userId] || {};
    return Object.prototype.hasOwnProperty.call(answers, guildId) ? answers[guildId] : null;
});

beforeEach(() => {
    file = tempStoreFile("availability.json");
    availabilityStore.useFile(file);
    migrationMarkStore.useFile(tempStoreFile("migrations.json"));
});

afterAll(() => {
    availabilityStore.useFile(null);
    migrationMarkStore.useFile(null);
});

describe("services/signups/availabilityMigration serverOrder", () => {
    it("takes the server list in its order, the old single guildId without one", () => {
        expect(serverOrder(config)).toEqual([A, B, C]);
        expect(serverOrder({ guildId: "solo" })).toEqual(["solo"]);
        expect(serverOrder({})).toEqual([]);
    });
});

describe("services/signups/availabilityMigration migrateAvailabilityServers", () => {
    it("gives an entry the first server the raider is a member of (here the second)", async () => {
        seed([entry("e1", "u1")]);
        const membership = membershipFrom({ u1: { [A]: false, [B]: true, [C]: true } });

        const lines = await migrateAvailabilityServers({ membership, config });

        expect(byId("e1").scope).toEqual([{ guildId: B, categoryIds: [] }]);
        // stops at the first "member": the third server is never asked
        expect(membership.mock.calls).toEqual([[A, "u1"], [B, "u1"]]);
        expect(lines).toEqual([expect.stringContaining("1 Ab-/Anwesenheit(en)")]);
        expect(lines[0]).toContain("davon 0 ");
    });

    it("keeps applied, skip and who entered it", async () => {
        seed([entry("e1", "u1")]);
        await migrateAvailabilityServers({ membership: membershipFrom({ u1: { [A]: true } }), config });

        const e = byId("e1");
        expect(e.applied).toEqual({ "ev-1": { at: 1, ok: true } });
        expect(e.skip).toEqual(["ev-skip"]);
        expect(e.createdBy).toBe("u1");
        expect(e.scope).toEqual([{ guildId: A, categoryIds: [] }]);
    });

    it("falls back to the first server when the raider is a member nowhere, and counts it", async () => {
        seed([entry("e1", "u1")]);
        const lines = await migrateAvailabilityServers({ membership: membershipFrom({ u1: { [A]: false, [B]: false, [C]: false } }), config });

        expect(byId("e1").scope).toEqual([{ guildId: A, categoryIds: [] }]);
        expect(lines[0]).toContain("davon 1 ");
        expect(lines[0]).toContain(`ersten Server ${A} (Fallback)`);
    });

    it("falls back to the first server when the membership is unknown everywhere", async () => {
        seed([entry("e1", "u1"), entry("e2", "u2")]);
        const lines = await migrateAvailabilityServers({ membership: membershipFrom({ u2: { [C]: true } }), config });

        expect(byId("e1").scope).toEqual([{ guildId: A, categoryIds: [] }]);
        expect(byId("e2").scope).toEqual([{ guildId: C, categoryIds: [] }]);
        expect(lines[0]).toContain("2 Ab-/Anwesenheit(en)");
        expect(lines[0]).toContain("davon 1 ");
    });

    it("leaves entries with a category or a scope alone", async () => {
        seed([
            entry("cat", "u1", { categoryId: "cat-1" }),
            entry("scoped", "u1", { scope: [{ guildId: C, categoryIds: ["x"] }] }),
            entry("open", "u1"),
        ]);
        await migrateAvailabilityServers({ membership: membershipFrom({ u1: { [B]: true } }), config });

        expect(byId("cat").scope).toBeUndefined();
        expect(byId("cat").categoryId).toBe("cat-1");
        expect(byId("scoped").scope).toEqual([{ guildId: C, categoryIds: ["x"] }]);
        expect(byId("open").scope).toEqual([{ guildId: B, categoryIds: [] }]);
    });

    it("moves expired entries too, and asks once per raider and server - not per entry", async () => {
        seed([
            entry("old", "u1", { from: "2026-01-01", to: "2026-01-02" }),
            entry("now", "u1"),
            entry("presence", "u1", { kind: "presence", characters: [{ character: "Thrall", spec: "Elemental", versionId: "tbc" }] }),
        ]);
        const membership = membershipFrom({ u1: { [A]: false, [B]: true } });
        await migrateAvailabilityServers({ membership, config });

        expect(stored().map((e) => e.scope)).toEqual([
            [{ guildId: B, categoryIds: [] }], [{ guildId: B, categoryIds: [] }], [{ guildId: B, categoryIds: [] }],
        ]);
        expect(membership).toHaveBeenCalledTimes(2);
    });

    it("runs only once: the mark makes later starts skip it", async () => {
        seed([entry("e1", "u1")]);
        await migrateAvailabilityServers({ membership: membershipFrom({ u1: { [A]: true } }), config });
        expect(migrationMarkStore.isDone(MARK)).toBe(true);

        seed([entry("e2", "u2")]);
        const membership = membershipFrom({ u2: { [B]: true } });
        const lines = await migrateAvailabilityServers({ membership, config });

        expect(lines).toEqual([]);
        expect(membership).not.toHaveBeenCalled();
        expect(byId("e2").scope).toBeUndefined();
    });

    it("marks a store without old entries as done, without asking Discord", async () => {
        seed([entry("cat", "u1", { categoryId: "cat-1" })]);
        const membership = membershipFrom({});
        expect(await migrateAvailabilityServers({ membership, config })).toEqual([]);
        expect(membership).not.toHaveBeenCalled();
        expect(migrationMarkStore.isDone(MARK)).toBe(true);
    });

    it("writes nothing when a query throws, and tries again on the next start", async () => {
        seed([entry("e1", "u1"), entry("e2", "u2")]);
        const failing = jest.fn(async () => {
            throw new Error("rate limited");
        });
        const lines = await migrateAvailabilityServers({ membership: failing, config });

        expect(lines[0]).toContain("fehlgeschlagen (rate limited)");
        expect(byId("e1").scope).toBeUndefined();
        expect(migrationMarkStore.isDone(MARK)).toBe(false);

        await migrateAvailabilityServers({ membership: membershipFrom({ u1: { [A]: true }, u2: { [B]: true } }), config });
        expect(byId("e1").scope).toEqual([{ guildId: A, categoryIds: [] }]);
        expect(byId("e2").scope).toEqual([{ guildId: B, categoryIds: [] }]);
        expect(migrationMarkStore.isDone(MARK)).toBe(true);
    });

    it("waits for the bot when it reaches none of the servers (no fallback for everyone)", async () => {
        seed([entry("e1", "u1")]);
        const membership = membershipFrom({});
        const lines = await migrateAvailabilityServers({ membership, config, reachable: () => false });

        expect(lines[0]).toContain("nächster Start versucht es erneut");
        expect(membership).not.toHaveBeenCalled();
        expect(byId("e1").scope).toBeUndefined();
        expect(migrationMarkStore.isDone(MARK)).toBe(false);
    });

    it("skips a server the bot does not reach and asks the others", async () => {
        seed([entry("e1", "u1")]);
        const membership = membershipFrom({ u1: { [A]: true, [B]: true } });
        await migrateAvailabilityServers({ membership, config, reachable: (g) => g !== A });

        expect(byId("e1").scope).toEqual([{ guildId: B, categoryIds: [] }]);
        expect(membership.mock.calls).toEqual([[B, "u1"]]);
    });

    it("warns and waits without any configured server", async () => {
        seed([entry("e1", "u1")]);
        const lines = await migrateAvailabilityServers({ membership: membershipFrom({}), config: {} });

        expect(lines[0]).toContain("WARNUNG");
        expect(byId("e1").scope).toBeUndefined();
        expect(migrationMarkStore.isDone(MARK)).toBe(false);
    });

    it("leaves an entry alone the orga gave a scope while the queries waited", async () => {
        seed([entry("e1", "u1")]);
        const membership = jest.fn(async () => {
            availabilityStore.updateEntry("e1", { scope: [{ guildId: C, categoryIds: [] }] });
            return true;
        });
        const lines = await migrateAvailabilityServers({ membership, config });

        expect(byId("e1").scope).toEqual([{ guildId: C, categoryIds: [] }]);
        expect(lines[0]).toContain("0 Ab-/Anwesenheit(en)");
    });
});

describe("services/signups/availabilityMigration runAvailabilityMigration", () => {
    const client = (ids) => ({ guilds: { cache: new Map(ids.map((id) => [id, {}])) } });

    beforeEach(() => {
        configStore.getConfig.mockReturnValue(config);
        discord.guildMembership.mockReset();
    });

    it("asks discord.guildMembership on the servers the bot is on and logs the line", async () => {
        seed([entry("e1", "u1")]);
        discord.guildMembership.mockImplementation(async (guildId) => guildId === B);
        const log = jest.fn();
        const warn = jest.fn();

        const lines = await runAvailabilityMigration(client([A, B]), { log, warn });

        expect(byId("e1").scope).toEqual([{ guildId: B, categoryIds: [] }]);
        expect(discord.guildMembership.mock.calls.map((c) => c[0])).toEqual([A, B]);
        expect(log).toHaveBeenCalledWith(`[settings] Migration: ${lines[0]}`);
        expect(warn).not.toHaveBeenCalled();
    });

    it("logs a failed query also as a warning and never throws", async () => {
        seed([entry("e1", "u1")]);
        discord.guildMembership.mockRejectedValue(new Error("boom"));
        const warn = jest.fn();

        await expect(runAvailabilityMigration(client([A]), { log: jest.fn(), warn })).resolves.toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("fehlgeschlagen (boom)"));
    });

    it("catches an error outside the queries", async () => {
        configStore.getConfig.mockImplementation(() => {
            throw new Error("config kaputt");
        });
        const warn = jest.fn();
        await expect(runAvailabilityMigration(client([A]), { log: jest.fn(), warn })).resolves.toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("config kaputt"));
    });
});
