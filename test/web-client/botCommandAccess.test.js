// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): the rules in
// src/web-client/src/lib/botCommandAccess.ts, run in plain Node, and the view in
// components/BotCommandAccess.tsx, checked on its source (no React renderer here).
//
// The lib is written to be strippable like lib/settingsLogic.ts; the loader
// below removes exactly the type syntax it may use.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

/** Split a parameter list at its top-level commas. */
function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function load(src) {
    const out = [];
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line) || /^export type .*;\s*$/.test(line)) continue;
        const fn = line.match(/^export function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[2]).map((p) => p.trim().split(":")[0].trim()).filter(Boolean);
            out.push(`function ${fn[1]}(${params.join(", ")}) {`);
            continue;
        }
        const constant = line.match(/^export const (\w+): .+? = (.*)$/);
        if (constant) { out.push(`const ${constant[1]} = ${constant[2]}`); continue; }
        out.push(line);
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const logic = load(read("lib", "botCommandAccess.ts"));
const view = read("components", "BotCommandAccess.tsx");
const page = read("pages", "SettingsPage.tsx");
const api = read("api", "botCommands.ts");

const ORGA = "123456789012345678";
const LEAD = "223456789012345678";
const cmd = (name, group, defaultAccess, extra = {}) => ({
    name, group, description: "", kind: "slash", defaultAccess, access: null, effective: defaultAccess, inherits: [], ...extra,
});
const ADMINS = { mode: "admins", roleIds: [] };
const EVERYONE = { mode: "everyone", roleIds: [] };
const COMMANDS = [
    cmd("createauction", "auctions", ADMINS),
    cmd("endauction", "auctions", ADMINS),
    cmd("bid", "auctions", EVERYONE),
    cmd("apply", "recruitment", EVERYONE, { kind: "button" }),
];
const roleName = (id) => ({ [ORGA]: "@Orga", [LEAD]: "@Raidleiter" }[id] || "Unbekannte Rolle");

describe("Bot-Befehle rules", () => {
    it("writes slash commands with a slash and buttons without", () => {
        expect(logic.commandLabel(COMMANDS[0])).toBe("/createauction");
        expect(logic.commandLabel(COMMANDS[3])).toBe("apply");
    });

    it("stores a rule only while it differs from the default", () => {
        const roles = { mode: "roles", roleIds: [ORGA, ORGA] };
        const map = logic.withRule({}, COMMANDS[0], roles);
        expect(map).toEqual({ createauction: { mode: "roles", roleIds: [ORGA] } });
        expect(logic.ruleOf(COMMANDS[0], map)).toEqual({ mode: "roles", roleIds: [ORGA] });
        // back to the default = "Zurücksetzen": the entry disappears
        expect(logic.withRule(map, COMMANDS[0], ADMINS)).toEqual({});
        expect(logic.ruleOf(COMMANDS[0], {})).toBe(ADMINS);
    });

    it("compares role rules regardless of order and needs a role for Nur Rollen", () => {
        expect(logic.sameRule({ mode: "roles", roleIds: [ORGA, LEAD] }, { mode: "roles", roleIds: [LEAD, ORGA] })).toBe(true);
        expect(logic.sameRule({ mode: "roles", roleIds: [ORGA] }, ADMINS)).toBe(false);
        expect(logic.ruleValid({ mode: "roles", roleIds: [] })).toBe(false);
        expect(logic.ruleValid(ADMINS)).toBe(true);
        expect(logic.cleanRule({ mode: "everyone", roleIds: [ORGA] })).toEqual(EVERYONE);
    });

    it("takes one rule over for every command of the group", () => {
        const rule = { mode: "roles", roleIds: [ORGA] };
        const map = logic.withGroupRule({ apply: ADMINS }, COMMANDS, "auctions", rule);
        expect(map).toEqual({ apply: ADMINS, createauction: rule, endauction: rule, bid: rule });
    });

    it("sums a group up in one short line", () => {
        const auctions = logic.commandsOfGroup(COMMANDS, "auctions");
        expect(logic.groupSummary(auctions, {}, roleName)).toBe("3 Befehle · 1 für jeden · 2 nur Admins");
        const map = { createauction: { mode: "roles", roleIds: [ORGA, LEAD] }, endauction: { mode: "roles", roleIds: [ORGA] }, bid: { mode: "roles", roleIds: [LEAD] } };
        expect(logic.groupSummary(auctions, map, roleName)).toBe("3 Befehle · @Orga, @Raidleiter");
        expect(logic.groupSummary(logic.commandsOfGroup(COMMANDS, "recruitment"), {}, roleName)).toBe("1 Befehl · Jeder");
        expect(logic.customizedCount(auctions, map)).toBe(3);
    });
});

describe("Bot-Befehle view", () => {
    it("loads its own data and saves the whole map through PATCH /api/settings", () => {
        expect(api).toMatch(/getBotCommands[\s\S]*"\/api\/bot-commands"/);
        expect(view).toMatch(/getBotCommands\(\)/);
        expect(view).toMatch(/updateSettings\(csrfToken, \{ botCommandAccess: next \}\)/);
    });

    it("folds each group to one line with the shared Details button", () => {
        expect(view).toMatch(/<Expand open=\{isOpen\}/);
        expect(view).toMatch(/groupSummary\(commands, map, roleName\)/);
        expect(view).toMatch(/\{isOpen && \(/);
    });

    it("edits a command in a modal: segment, role picker, default with reset, group action", () => {
        expect(view).toMatch(/<Modal[\s\S]*title=\{commandLabel\(command\)\}/);
        expect(view).toMatch(/<Segment<BotAccessMode>/);
        expect(view).toMatch(/const MODES: BotAccessMode\[\] = \["everyone", "roles", "admins"\]/);
        expect(view).toMatch(/Zurücksetzen/);
        expect(view).toMatch(/Standard/);
        expect(view).toMatch(/für alle \{groupSize\} Befehle der Gruppe übernehmen/);
        expect(view).toMatch(/withGroupRule\(map, data\.commands, editCommand\.group, rule\)/);
    });

    it("explains roles in the tooltip box (name and member count), never a native title", () => {
        expect(view).toMatch(/memberCount/);
        expect(view).toMatch(/tipSub=\{sub\}/);
        // on a plain element; `title` on PartHead/Modal is their heading
        expect(view).not.toMatch(/<[a-z]+\b[^>]*\stitle=/);
    });

    it("is a second view of the Berechtigungen section, kept in the url", () => {
        expect(page).toMatch(/usePersistedSearchParam<PermView>\("settings-perm-view", "perm", "areas", PERM_VIEWS\)/);
        expect(page).toMatch(/permView === "bot" \? \(\s*<BotCommandAccess/);
        expect(page).toMatch(/label: "Bot-Befehle"/);
    });
});
