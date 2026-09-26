// src/commands/loader.js (#413): one loader for the bot and for the command
// registration, the definitions live in the modules (`data`), names are unique.
const fs = require("fs");
const path = require("path");
const {
    kindOf, commandFiles, loadCommandModules, definitionOf, commandDefinitions,
} = require("../../src/commands/loader");
const { tempStoreFile } = require("../helpers/tempStore");

// Components that carry their own `group`: the first click of a flow nobody
// starts with a slash command. Anything else with a group must be a command.
const COMPONENT_ENTRY_POINTS = ["apply", "event-btn", "event-join", "event-signup", "talk-signup"];

const modules = loadCommandModules();
const definitions = commandDefinitions(modules);
const names = definitions.map((d) => d.name);

/** A scratch commands folder: `{ "folder/file.js": "source" }`. */
function scratchCommands(files) {
    const dir = path.dirname(tempStoreFile("commands"));
    for (const [rel, source] of Object.entries(files)) {
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), source);
    }
    return dir;
}

describe("commands/loader", () => {
    it("collects the definition of every module with data, each name exactly once", () => {
        const withData = [...modules.values()].filter((m) => m.data);
        expect(withData.length).toBeGreaterThan(15);
        for (const m of withData) {
            expect({ name: m.name, collected: names.filter((n) => n === m.name).length }).toEqual({ name: m.name, collected: 1 });
        }
        expect(new Set(names).size).toBe(names.length);
        expect(definitions.length).toBe(withData.length);
    });

    it("gives every definition the module's own name", () => {
        for (const m of modules.values()) {
            if (m.data) expect({ file: m.name, data: definitionOf(m).name }).toEqual({ file: m.name, data: m.name });
        }
    });

    it("registers every module with a group, except the known component entry points", () => {
        const unregistered = [...modules.values()].filter((m) => m.group && !m.data).map((m) => m.name).sort();
        expect(unregistered).toEqual([...COMPONENT_ENTRY_POINTS].sort());
    });

    it("points every accessOf at a module with a group", () => {
        for (const m of modules.values()) {
            if (!m.accessOf) continue;
            const owner = modules.get(m.accessOf);
            expect({ name: m.name, ownerGroup: owner && owner.group }).toEqual({ name: m.name, ownerGroup: expect.any(String) });
        }
    });

    it("has every /command named in the Discord guide", () => {
        const guide = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "guide-discord.md"), "utf8");
        const mentioned = [...guide.matchAll(/`\/([a-z0-9_-]+)/g)].map((m) => m[1]);
        expect(mentioned.length).toBeGreaterThan(10);
        for (const name of new Set(mentioned)) {
            expect({ name, registered: names.includes(name) }).toEqual({ name, registered: true });
        }
    });

    it("keeps the old option numbers out: every option type comes from the builders", () => {
        // spot check of what `npm run register` sends
        const kanal = definitions.find((d) => d.name === "kanal");
        expect(kanal.options.map((o) => [o.name, o.type])).toEqual([["umbenennen", 1], ["archivieren", 1], ["anlegen", 1]]);
        expect(kanal.options[0].options[0]).toMatchObject({ name: "kanal", type: 7, required: true, channel_types: [0, 2, 5, 13, 15] });
        expect(kanal.options[2].options[0]).toMatchObject({ name: "kategorie", channel_types: [4] });
        expect(definitions.find((d) => d.name === "Event verwalten")).toEqual({ name: "Event verwalten", type: 3 });
    });

    it("tells commands from components by their data", () => {
        expect(kindOf(modules.get("event"))).toBe("command");
        expect(kindOf(modules.get("Event verwalten"))).toBe("command");
        expect(kindOf(modules.get("event-manage"))).toBe("component");
        expect(kindOf(modules.get("apply"))).toBe("component");
        expect(kindOf(undefined)).toBe("component");
    });

    it("takes a plain definition object as it is", () => {
        const data = { name: "plain", description: "x" };
        expect(definitionOf({ name: "plain", data })).toBe(data);
    });

    it("skips files directly in the folder and folders starting with _", () => {
        const dir = scratchCommands({
            "shared.js": "module.exports = {};",
            "_lib/helper.js": "module.exports = {};",
            "one/a.js": "module.exports = { name: \"a\" };",
            "one/notes.txt": "",
        });
        expect(commandFiles(dir).map(([rel]) => rel)).toEqual(["one/a.js"]);
        expect([...loadCommandModules(dir).keys()]).toEqual(["a"]);
        const rels = commandFiles().map(([rel]) => rel);
        expect(rels).not.toContain("loader.js");
        expect(rels).not.toContain("componentRoute.js");
    });

    it("throws on a name used twice, naming both files", () => {
        const dir = scratchCommands({
            "one/a.js": "module.exports = { name: \"same\" };",
            "two/b.js": "module.exports = { name: \"same\" };",
        });
        expect(() => loadCommandModules(dir)).toThrow("Duplicate command name \"same\" in one/a.js and two/b.js.");
    });

    it("throws on a module without a name", () => {
        const dir = scratchCommands({ "one/a.js": "module.exports = { execute() {} };" });
        expect(() => loadCommandModules(dir)).toThrow(/one\/a\.js exports no name/);
    });
});
