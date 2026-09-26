// Every file under src/commands/ says who may run it (issue #252): either its own
// `group` + `defaultAccess`, or `accessOf` naming the command whose access a
// button/select/modal inherits. A file that declares neither would still be
// admin-only at runtime (fail-closed) — this scan makes sure nobody relies on it
// by accident, and that no file still carries its own ad-hoc admin check.
const fs = require("fs");
const { GROUP_IDS, normalizeRule } = require("../../src/config/botCommands");
const { commandFiles, commandDefinitions } = require("../../src/commands/loader");

const files = commandFiles();
const modules = files.map(([rel, file]) => [rel, require(file)]);
const byName = new Map(modules.map(([, m]) => [m.name, m]));

describe("bot command access declarations", () => {
    it("finds the command files", () => {
        expect(files.length).toBeGreaterThan(20);
    });

    it.each(modules)("%s declares defaultAccess or accessOf, not both", (rel, command) => {
        const own = command.defaultAccess !== undefined;
        const inherited = command.accessOf !== undefined;
        expect({ rel, declares: own !== inherited }).toEqual({ rel, declares: true });
        if (own) {
            expect(GROUP_IDS).toContain(command.group);
            expect(normalizeRule(command.defaultAccess)).not.toBeNull();
        } else {
            expect(command.group).toBeUndefined();
            const owner = byName.get(command.accessOf);
            expect({ rel, owner: owner && owner.name }).toEqual({ rel, owner: command.accessOf });
            expect(owner.accessOf).toBeUndefined();
        }
    });

    it("keeps no ad-hoc admin check in a command file", () => {
        for (const [rel, file] of files) {
            expect({ rel, check: /checkForPermission|adminUserId/.test(fs.readFileSync(file, "utf8")) }).toEqual({ rel, check: false });
        }
    });

    it("keeps today's behaviour for the admin commands and the member lookups", () => {
        const access = (name) => normalizeRule(byName.get(name).defaultAccess).mode;
        for (const name of ["createapplication", "recruitment", "createoverview", "fillsetup"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "admins" });
        }
        for (const name of ["show-mysetups", "show-signups", "show-allsetups", "signup", "update-events",
            "apply", "logcheck"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "everyone" });
        }
    });

    it("opens the lookups about oneself and loot to everyone, keeps the rest for admins (#265, #259)", () => {
        const access = (name) => normalizeRule(byName.get(name).defaultAccess).mode;
        for (const name of ["loot", "raids", "raid", "anwesenheit", "report"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "everyone" });
        }
        for (const name of ["anwesenheit-raider", "council", "kanal"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "admins" });
        }
    });

    it("keeps /event anlegen for admins (the orga role gets it in the menu) and hangs its flow under it (#260)", () => {
        expect(normalizeRule(byName.get("event").defaultAccess).mode).toBe("admins");
        expect(byName.get("event").group).toBe("raids");
        expect(byName.get("event-new").accessOf).toBe("event");
        expect(byName.get("event-form").accessOf).toBe("event");
        const commands = commandDefinitions();
        const def = commands.find((c) => c.name === "event");
        expect(def.options.map((o) => [o.name, o.type])).toEqual([["anlegen", 1], ["verwalten", 1]]);
    });

    it("hangs Event verwalten under /event: subcommand, buttons, modals and the message context menu (#288)", () => {
        // "invite-call": the Invite-callen button under the setup message — the orga's, like /event
        for (const name of ["event-manage", "event-manage-form", "Event verwalten", "invite-call"]) {
            expect({ name, accessOf: byName.get(name).accessOf }).toEqual({ name, accessOf: "event" });
        }
        const commands = commandDefinitions();
        const menu = commands.find((c) => c.name === "Event verwalten");
        // a message command (type 3) carries no description
        expect(menu).toEqual({ name: "Event verwalten", type: 3 });
        expect(menu.description).toBeUndefined();
        const sub = commands.find((c) => c.name === "event").options.find((o) => o.name === "verwalten");
        expect(sub.options).toEqual([expect.objectContaining({ name: "event", type: 3, required: false, autocomplete: true })]);
    });

    it("registers every lookup command, with descriptions Discord accepts", () => {
        const commands = commandDefinitions();
        const registered = new Set(commands.map((c) => c.name));
        for (const name of ["loot", "raids", "raid", "anwesenheit", "anwesenheit-raider", "report", "council", "kanal"]) {
            expect({ name, registered: registered.has(name) }).toEqual({ name, registered: true });
        }
        const check = (options = []) => {
            for (const opt of options) {
                expect({ name: opt.name, ok: String(opt.description || "").length <= 100 }).toEqual({ name: opt.name, ok: true });
                check(opt.options);
            }
        };
        check(commands);
    });

    it("gives every command with autocomplete options an autocomplete handler", () => {
        const commands = commandDefinitions();
        const hasAutocomplete = (options = []) => options.some((o) => o.autocomplete || hasAutocomplete(o.options));
        for (const def of commands.filter((c) => hasAutocomplete(c.options))) {
            expect({ name: def.name, handler: typeof (byName.get(def.name) || {}).autocomplete }).toEqual({ name: def.name, handler: "function" });
        }
    });

    it("hangs the buttons, selects and modals under their command", () => {
        expect(byName.get("apply-class").accessOf).toBe("apply");
        expect(byName.get("apply-spec").accessOf).toBe("apply");
        expect(byName.get("apply-modal").accessOf).toBe("apply");
        expect(byName.get("logcheck-eval").accessOf).toBe("logcheck");
        expect(byName.get("logcheck-force").accessOf).toBe("logcheck");
    });
});
