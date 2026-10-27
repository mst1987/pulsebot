// The words of the roles page: uses, the "Bot kann vergeben" cell, the rank and
// the bot divider, the member filter and initials; plus the permission groups.
import { describe, expect, it } from "vitest";
import type { ServerRole } from "../../api";
import { assignView, botRelation, commonSensitiveItems, dividerAt, initialsOf, matchesMember, ranks, roleUseLabel, roleUseLines } from "./serverRoles";
import { ALL_PERMISSIONS, groupPermissions, permissionLabel } from "./permissions";

function role(over: Partial<ServerRole> = {}): ServerRole {
    return {
        id: "r1", name: "Raider", color: "", position: 3, managed: false, everyone: false, isBotRole: false,
        memberCount: 4, permissions: [], sensitive: [], unusual: [], uses: [], assign: { ok: true, reason: "" }, hints: [],
        ...over,
    };
}

describe("roleUseLabel / roleUseLines", () => {
    it("puts every use into words", () => {
        expect(roleUseLabel({ code: "orga" })).toBe("Orga-Rolle");
        expect(roleUseLabel({ code: "botCommand", commands: ["event", "setup"] })).toBe("Bot-Befehle: /event, /setup");
        expect(roleUseLabel({ code: "categoryRaider", categoryIds: ["c1"], categories: [{ id: "c1", name: "Naxx" }] })).toBe("Raider-Rolle Naxx");
        expect(roleUseLabel({ code: "categoryRaider", categoryIds: ["c1"] })).toBe("Raider-Rolle einer Kategorie");
        expect(roleUseLabel({ code: "roleSync", guildIds: ["g2", "g3"], servers: [{ guildId: "g2", name: "Talkgilde" }, { guildId: "g3", name: "" }] }))
            .toBe("Rollen-Abgleich (Talkgilde, g3)");
        expect(roleUseLabel({ code: "roleSync", guildIds: [] })).toBe("Rollen-Abgleich");
        expect(roleUseLabel({ code: "roster", rosterId: "x", name: "Main", kinds: ["member", "trial"] })).toBe("Roster Main: Mitglied, Probe");
        expect(roleUseLabel({ code: "roleMessage", messageId: "m", title: "Berufe" })).toBe("Rollen-Nachricht „Berufe“");
        expect(roleUseLabel({ code: "rolePermissions", areas: ["raids"] })).toMatch(/^Web-Rechte: /);
    });

    it("says what a role without a use is", () => {
        expect(roleUseLines(role({ everyone: true }))).toEqual(["Grundrechte aller"]);
        expect(roleUseLines(role())).toEqual(["nicht genutzt"]);
        expect(roleUseLines(role({ managed: true }))).toEqual(["Integration einer App"]);
        expect(roleUseLines(role({ isBotRole: true, managed: true, uses: [{ code: "addonUpdates" }] }))).toEqual(["eigene Bot-Rolle", "Ping bei Addon-Updates"]);
    });
});

describe("assignView", () => {
    it("gives yes, the plain reasons and the ones to fix", () => {
        expect(assignView(role(), "PulseBot")).toEqual({ text: "ja", short: "ja", tone: "ok" });
        expect(assignView(role({ assign: { ok: false, reason: "everyone" } }), "PulseBot").tone).toBe("plain");
        expect(assignView(role({ assign: { ok: false, reason: "managed" } }), "PulseBot")).toMatchObject({ text: "Integration, fest", tone: "plain" });
        expect(assignView(role({ assign: { ok: false, reason: "noManageRoles" } }), "PulseBot")).toMatchObject({ text: "nein, Recht fehlt", tone: "fix" });
        expect(assignView(role({ assign: { ok: false, reason: "above" } }), "PulseBot")).toEqual({ text: "nein, steht darüber", short: "nein", tone: "plain" });
        expect(assignView(role({ assign: { ok: false, reason: "above" }, hints: ["aboveBot"] }), "PulseBot")).toMatchObject({ text: "nein, PulseBot darüber ziehen", short: "zu hoch", tone: "fix" });
        expect(assignView(role({ assign: { ok: false, reason: "noManageRoles" } }), "PulseBot").short).toBe("Recht fehlt");
        // the bot's own role says so, not "integration, fixed" like an app's role
        expect(assignView(role({ assign: { ok: false, reason: "botRole" } }), "PulseBot")).toEqual({
            text: "nein, eigene Rolle",
            short: "eigene",
            sub: "Das ist die Rolle des Bots selbst. Er kann sie sich weder geben noch nehmen.",
            tone: "plain",
        });
    });
});

describe("botRelation", () => {
    it("reads where a role stands to the bot from the assign answer", () => {
        expect(botRelation(role())).toBe("below");
        expect(botRelation(role({ assign: { ok: false, reason: "above" } }))).toBe("above");
        expect(botRelation(role({ assign: { ok: false, reason: "botRole" } }))).toBe("own");
        expect(botRelation(role({ assign: { ok: false, reason: "noManageRoles" } }))).toBe("");
        expect(botRelation(role({ assign: { ok: false, reason: "managed" } }))).toBe("");
        expect(botRelation(role({ everyone: true, assign: { ok: false, reason: "everyone" } }))).toBe("");
    });
});

describe("commonSensitiveItems", () => {
    it("names @everyone or the share of roles", () => {
        const items = commonSensitiveItems([
            { key: "MentionEveryone", roles: 0, everyone: true },
            { key: "ManageMessages", roles: 4, everyone: false },
        ], 6, (k) => k);
        expect(items).toEqual(["MentionEveryone (alle über @everyone)", "ManageMessages (4 von 6 Rollen)"]);
        expect(commonSensitiveItems([], 6, (k) => k)).toEqual([]);
    });
});

describe("ranks / dividerAt", () => {
    it("counts from the top, @everyone without a rank", () => {
        const roles = [role({ id: "a", position: 3 }), role({ id: "b", position: 2 }), role({ id: "e", position: 0, everyone: true }), role({ id: "c", position: 1 })];
        const r = ranks(roles);
        expect([r.get("a"), r.get("b"), r.get("c"), r.get("e")]).toEqual([1, 2, 3, null]);
    });

    it("puts the divider at the bot role, or nowhere", () => {
        const rows = [role({ id: "a" }), role({ id: "bot" }), role({ id: "c" })];
        expect(dividerAt(rows, "bot")).toBe(1);
        expect(dividerAt(rows, null)).toBe(-1);
        expect(dividerAt(rows, "gone")).toBe(-1);
    });
});

describe("member helpers", () => {
    it("filters case-insensitively and makes initials", () => {
        expect(matchesMember("Thrall", "  thr ")).toBe(true);
        expect(matchesMember("Thrall", "jaina")).toBe(false);
        expect(matchesMember("Thrall", "")).toBe(true);
        expect(initialsOf("Jaina Proudmoore")).toBe("JP");
        expect(initialsOf("thrall")).toBe("TH");
        expect(initialsOf("  ")).toBe("?");
    });
});

describe("groupPermissions", () => {
    it("shows only the set ones by default, sensitive marked, unknown keys under Erweitert", () => {
        const groups = groupPermissions(["ManageRoles", "SendMessages", "FutureFlag"], false);
        expect(groups.map((g) => g.id)).toEqual(["general", "text", "advanced"]);
        expect(groups[0].rows).toEqual([{ key: "ManageRoles", label: permissionLabel("ManageRoles"), set: true, sensitive: true }]);
        expect(groups[1].rows[0]).toMatchObject({ key: "SendMessages", sensitive: false });
        expect(groups[2].rows.map((r) => r.key)).toEqual(["FutureFlag"]);
        expect(permissionLabel("FutureFlag")).toBe("FutureFlag");
    });

    it("lists every permission when all is on", () => {
        const rows = groupPermissions([], true).flatMap((g) => g.rows);
        expect(rows).toHaveLength(ALL_PERMISSIONS.length);
        expect(rows.every((r) => !r.set)).toBe(true);
        expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    });
});
