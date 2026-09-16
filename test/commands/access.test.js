// Every file under src/commands/ says who may run it (issue #252): either its own
// `group` + `defaultAccess`, or `accessOf` naming the command whose access a
// button/select/modal inherits. A file that declares neither would still be
// admin-only at runtime (fail-closed) — this scan makes sure nobody relies on it
// by accident, and that no file still carries its own ad-hoc admin check.
const fs = require("fs");
const path = require("path");
const { GROUP_IDS, normalizeRule } = require("../../src/config/botCommands");

const DIR = path.join(__dirname, "..", "..", "src", "commands");

function commandFiles() {
    const out = [];
    for (const folder of fs.readdirSync(DIR)) {
        for (const file of fs.readdirSync(path.join(DIR, folder)).filter((f) => f.endsWith(".js"))) {
            out.push([`${folder}/${file}`, path.join(DIR, folder, file)]);
        }
    }
    return out;
}

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
        for (const name of ["createapplication", "recruitment", "auctionstatus", "createauction", "deleteauction",
            "endauction", "updateauction", "createoverview", "saveraid", "fillsetup"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "admins" });
        }
        for (const name of ["show-mysetups", "show-signups", "show-allsetups", "signup", "update-events", "bid",
            "currentspent", "lastspent", "totalspent", "apply", "logcheck"]) {
            expect({ name, mode: access(name) }).toEqual({ name, mode: "everyone" });
        }
    });

    it("hangs the buttons, selects and modals under their command", () => {
        expect(byName.get("bid-5k").accessOf).toBe("bid");
        expect(byName.get("bid-10k").accessOf).toBe("bid");
        expect(byName.get("bid-custom").accessOf).toBe("bid");
        expect(byName.get("apply-class").accessOf).toBe("apply");
        expect(byName.get("apply-spec").accessOf).toBe("apply");
        expect(byName.get("apply-modal").accessOf).toBe("apply");
        expect(byName.get("logcheck-eval").accessOf).toBe("logcheck");
        expect(byName.get("logcheck-force").accessOf).toBe("logcheck");
    });
});
