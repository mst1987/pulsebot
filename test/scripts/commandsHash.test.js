// scripts/lib/commandsHash.js: deploy.sh registers the slash commands only
// when this fingerprint changed since the last deploy, so it must be the same
// for the same registration and differ for every real change.
const { stableStringify, commandsHash } = require("../../scripts/lib/commandsHash");

const command = (overrides = {}) => ({
    name: "event",
    description: "Create an event",
    options: [
        { name: "title", type: 3, required: true },
        { name: "date", type: 3, required: false },
    ],
    ...overrides,
});

describe("scripts/lib/commandsHash", () => {
    describe("stableStringify", () => {
        it("sorts object keys at every level and keeps array order", () => {
            expect(stableStringify({ b: 1, a: { d: [3, 1], c: null } })).toBe("{\"a\":{\"c\":null,\"d\":[3,1]},\"b\":1}");
        });

        it("leaves out undefined members and functions like JSON.stringify", () => {
            expect(stableStringify({ a: undefined, b: () => 1, c: 2 })).toBe("{\"c\":2}");
            expect(stableStringify([undefined])).toBe("[null]");
        });

        it("uses toJSON() where an object has one (a builder)", () => {
            expect(stableStringify({ x: { toJSON: () => ({ z: 1, y: 2 }) } })).toBe("{\"x\":{\"y\":2,\"z\":1}}");
        });
    });

    describe("commandsHash", () => {
        const base = { body: [command()], clientId: "app", guildIds: ["200", "300"] };

        it("is deterministic: same registration, same hash - whatever the key order", () => {
            const reordered = {
                options: command().options.map((o) => ({ required: o.required, type: o.type, name: o.name })),
                description: "Create an event",
                name: "event",
            };
            expect(commandsHash(base)).toMatch(/^[0-9a-f]{64}$/);
            expect(commandsHash(base)).toBe(commandsHash({ ...base }));
            expect(commandsHash({ ...base, body: [reordered] })).toBe(commandsHash(base));
        });

        it("does not care about the order of the servers or a duplicate", () => {
            expect(commandsHash({ ...base, guildIds: ["300", "200", "200"] })).toBe(commandsHash(base));
        });

        it("changes with every change Discord would see", () => {
            const hash = commandsHash(base);
            const changed = [
                { ...base, body: [command({ description: "Create a raid" })] },
                { ...base, body: [command({ options: [...command().options].reverse() })] },
                { ...base, body: [command(), command({ name: "signup" })] },
                { ...base, body: [] },
            ];
            for (const c of changed) expect(commandsHash(c)).not.toBe(hash);
        });

        it("changes with the targets: another app, a new server, global", () => {
            const hash = commandsHash(base);
            expect(commandsHash({ ...base, clientId: "other" })).not.toBe(hash);
            expect(commandsHash({ ...base, guildIds: ["200", "300", "400"] })).not.toBe(hash);
            expect(commandsHash({ ...base, global: true })).not.toBe(hash);
            // global ignores the server list
            expect(commandsHash({ ...base, global: true, guildIds: [] })).toBe(commandsHash({ ...base, global: true }));
        });

        it("works without arguments", () => {
            expect(commandsHash()).toBe(commandsHash({ body: [], clientId: "", guildIds: [] }));
        });
    });
});
