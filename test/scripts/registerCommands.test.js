// scripts/register-commands.js registers for every configured server (#251).
// Nothing here talks to Discord: the REST client is a jest double.
const {
    collectCommands, parseArgs, targetGuildIds, registerCommands, hashLine, HASH_PREFIX,
} = require("../../scripts/register-commands");
const { commandDefinitions } = require("../../src/commands/loader");

const routes = {
    applicationCommands: (app) => `/applications/${app}/commands`,
    applicationGuildCommands: (app, guild) => `/applications/${app}/guilds/${guild}/commands`,
};

describe("scripts/register-commands", () => {
    it("collects the definitions from the command modules (#413)", () => {
        const commands = collectCommands();
        expect(commands.length).toBeGreaterThan(15);
        expect(commands).toEqual(commandDefinitions());
        expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["event", "Event verwalten", "kanal", "signup"]));
        // gone with #413: never registered, and it posted to a dead backend
        expect(commands.map((c) => c.name)).not.toContain("saveraid");
    });

    describe("parseArgs", () => {
        it("reads the flags and the --guild value", () => {
            expect(parseArgs(["--dev", "--guild", "123456", "--clear"])).toEqual({ dev: true, global: false, clear: true, printHash: false, guild: "123456" });
            expect(parseArgs([])).toEqual({ dev: false, global: false, clear: false, printHash: false, guild: "" });
            expect(parseArgs(["--global"]).global).toBe(true);
        });

        it("reads --print-hash", () => {
            expect(parseArgs(["--print-hash"]).printHash).toBe(true);
        });

        it("does not take the next flag as a server id", () => {
            expect(parseArgs(["--guild", "--dev"]).guild).toBe("");
            expect(parseArgs(["--guild"]).guild).toBe("");
        });
    });

    describe("targetGuildIds", () => {
        it("registers for both configured servers, event first", () => {
            expect(targetGuildIds({ configuredIds: ["200", "300"], envGuildId: "100" })).toEqual(["200", "300"]);
        });

        it("targets only the server named by --guild", () => {
            expect(targetGuildIds({ guildArg: "400", configuredIds: ["200", "300"] })).toEqual(["400"]);
        });

        it("falls back to GUILD_ID from the env file and drops blanks and duplicates", () => {
            expect(targetGuildIds({ configuredIds: ["", " "], envGuildId: "100" })).toEqual(["100"]);
            expect(targetGuildIds({ configuredIds: ["200", "200"] })).toEqual(["200"]);
            expect(targetGuildIds()).toEqual([]);
        });
    });

    // deploy.sh greps the line for its prefix and registers only on a change.
    describe("hashLine (--print-hash)", () => {
        it("prints the prefix deploy.sh looks for and a sha256", () => {
            const line = hashLine({ body: [{ name: "a" }], clientId: "app", guildIds: ["200"] });
            expect(HASH_PREFIX).toBe("commands-hash: ");
            expect(line).toMatch(/^commands-hash: [0-9a-f]{64}$/);
        });

        it("gives the real command set the same hash on every load", () => {
            let again;
            jest.isolateModules(() => {
                again = require("../../scripts/register-commands").collectCommands();
            });
            const args = { clientId: "app", guildIds: ["200", "300"] };
            expect(hashLine({ ...args, body: again })).toBe(hashLine({ ...args, body: collectCommands() }));
        });
    });

    describe("registerCommands", () => {
        it("puts the command list on every server", async () => {
            const rest = { put: jest.fn(async () => {}) };
            const log = jest.fn();
            const failures = await registerCommands({ rest, routes, clientId: "app", guildIds: ["200", "300"], body: [{ name: "a" }], log });
            expect(failures).toEqual([]);
            expect(rest.put.mock.calls).toEqual([
                ["/applications/app/guilds/200/commands", { body: [{ name: "a" }] }],
                ["/applications/app/guilds/300/commands", { body: [{ name: "a" }] }],
            ]);
            expect(log).toHaveBeenCalledTimes(2);
        });

        it("clears with an empty list and registers globally once", async () => {
            const rest = { put: jest.fn(async () => {}) };
            await registerCommands({ rest, routes, clientId: "app", guildIds: ["200"], clear: true, log: jest.fn() });
            expect(rest.put).toHaveBeenCalledWith("/applications/app/guilds/200/commands", { body: [] });

            rest.put.mockClear();
            await registerCommands({ rest, routes, clientId: "app", guildIds: ["200", "300"], global: true, log: jest.fn() });
            expect(rest.put).toHaveBeenCalledTimes(1);
            expect(rest.put).toHaveBeenCalledWith("/applications/app/commands", { body: collectCommands() });
        });

        it("keeps going when one server fails and reports it", async () => {
            const rest = { put: jest.fn(async (route) => { if (route.includes("/200/")) throw new Error("Missing Access"); }) };
            const failures = await registerCommands({ rest, routes, clientId: "app", guildIds: ["200", "300"], log: jest.fn() });
            expect(rest.put).toHaveBeenCalledTimes(2);
            expect(failures.map((f) => [f.target, f.error.message])).toEqual([["guild 200", "Missing Access"]]);
        });
    });
});
