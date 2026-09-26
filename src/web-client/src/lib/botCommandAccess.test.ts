// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): the rules in
// lib/botCommandAccess.ts. The view (pages/settings/BotCommandAccess.tsx) is
// checked on its source in test/web-client/botCommandAccess.test.js.
import { describe, expect, it } from "vitest";
import * as logic from "./botCommandAccess";
import type { BotAccessRule, BotCommand } from "../api";
import { inLang } from "../test/i18n";

const ORGA = "123456789012345678";
const LEAD = "223456789012345678";
const cmd = (name: string, group: string, defaultAccess: BotAccessRule, extra = {}) => ({
    name, group, description: "", kind: "slash", defaultAccess, access: null, effective: defaultAccess, inherits: [], ...extra,
}) as unknown as BotCommand;
const ADMINS = { mode: "admins", roleIds: [] } as BotAccessRule;
const EVERYONE = { mode: "everyone", roleIds: [] } as BotAccessRule;
const COMMANDS = [
    cmd("createauction", "auctions", ADMINS),
    cmd("endauction", "auctions", ADMINS),
    cmd("bid", "auctions", EVERYONE),
    cmd("apply", "recruitment", EVERYONE, { kind: "button" }),
];
const roleName = (id: string) => ({ [ORGA]: "@Orga", [LEAD]: "@Raidleiter" } as Record<string, string>)[id] || "Unbekannte Rolle";

describe("Bot-Befehle rules", () => {
    it("writes slash commands with a slash and buttons without", () => {
        expect(logic.commandLabel(COMMANDS[0])).toBe("/createauction");
        expect(logic.commandLabel(COMMANDS[3])).toBe("apply");
    });

    it("stores a rule only while it differs from the default", () => {
        const roles = { mode: "roles", roleIds: [ORGA, ORGA] } as BotAccessRule;
        const map = logic.withRule({}, COMMANDS[0], roles);
        expect(map).toEqual({ createauction: { mode: "roles", roleIds: [ORGA] } });
        expect(logic.ruleOf(COMMANDS[0], map)).toEqual({ mode: "roles", roleIds: [ORGA] });
        // back to the default = "Zurücksetzen": the entry disappears
        expect(logic.withRule(map, COMMANDS[0], ADMINS)).toEqual({});
        expect(logic.ruleOf(COMMANDS[0], {})).toBe(ADMINS);
    });

    it("compares role rules regardless of order and needs a role for Nur Rollen", () => {
        expect(logic.sameRule({ mode: "roles", roleIds: [ORGA, LEAD] } as BotAccessRule, { mode: "roles", roleIds: [LEAD, ORGA] } as BotAccessRule)).toBe(true);
        expect(logic.sameRule({ mode: "roles", roleIds: [ORGA] } as BotAccessRule, ADMINS)).toBe(false);
        expect(logic.ruleValid({ mode: "roles", roleIds: [] } as BotAccessRule)).toBe(false);
        expect(logic.ruleValid(ADMINS)).toBe(true);
        expect(logic.cleanRule({ mode: "everyone", roleIds: [ORGA] } as BotAccessRule)).toEqual(EVERYONE);
    });

    it("takes one rule over for every command of the group", () => {
        const rule = { mode: "roles", roleIds: [ORGA] } as BotAccessRule;
        const map = logic.withGroupRule({ apply: ADMINS }, COMMANDS, "auctions", rule);
        expect(map).toEqual({ apply: ADMINS, createauction: rule, endauction: rule, bid: rule });
    });

    it("sums a group up in one short line", () => {
        const auctions = logic.commandsOfGroup(COMMANDS, "auctions");
        expect(logic.groupSummary(auctions, {}, roleName)).toBe("3 Befehle · 1 für jeden · 2 nur Admins");
        const map = { createauction: { mode: "roles", roleIds: [ORGA, LEAD] }, endauction: { mode: "roles", roleIds: [ORGA] }, bid: { mode: "roles", roleIds: [LEAD] } } as Record<string, BotAccessRule>;
        expect(logic.groupSummary(auctions, map, roleName)).toBe("3 Befehle · @Orga, @Raidleiter");
        expect(logic.groupSummary(logic.commandsOfGroup(COMMANDS, "recruitment"), {}, roleName)).toBe("1 Befehl · Jeder");
        expect(logic.customizedCount(auctions, map)).toBe(3);
    });

    it("says the mode and the summary in English once the page is switched", async () => {
        await inLang("en", () => {
            expect(logic.modeLabel("roles")).toBe("Roles only");
            const auctions = logic.commandsOfGroup(COMMANDS, "auctions");
            expect(logic.groupSummary(auctions, {}, roleName)).toBe("3 commands · 1 for everyone · 2 admins only");
            expect(logic.groupSummary(logic.commandsOfGroup(COMMANDS, "recruitment"), {}, roleName)).toBe("1 command · Everyone");
        });
    });
});
