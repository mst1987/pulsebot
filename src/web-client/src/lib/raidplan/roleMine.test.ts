// A role group ("Melees -> Boss", "Ranged soaken hier") is a task of / acts on every raider of that role: his spec role from the setup, a
// flex role on this boss wins, no names are split out (lib/assign.ts inRoleGroup / meInRole, lib/mineView.ts); the server twin decides the
// same (src/web/raidplanAssign.js inRoleGroup).
import { describe, expect, it } from "vitest";
import * as assign from "./assign";
import * as mv from "./mineView";
import { requireBackend } from "../../test/backend";

const server = requireBackend("services/raidplan/raidplanAssign");

const P = (userId, role) => ({ userId, character: userId, classId: "Rogue", className: "", classColor: "", spec: "", role, group: 1 });
const players = new Map([["m", P("m", "melee")], ["r", P("r", "ranged")], ["h", P("h", "healer")], ["t", P("t", "tank")], ["d", P("d", "dps")]]);
const ctx = (roles = {}) => ({ slots: [], players, roles });
const row = (id, assignees, targets, type = "other") => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false });

describe("who is in a role group", () => {
    it("the same answer on client and server for every role and spec role", () => {
        for (const role of ["melee", "ranged", "healer", "tank", "dps"]) {
            for (const pr of ["melee", "ranged", "healer", "tank", "dps", ""]) expect([role, pr, assign.inRoleGroup(role, pr)]).toEqual([role, pr, server.inRoleGroup(role, pr)]);
        }
        // "DPS" = everybody who is neither tank nor healer
        expect(assign.inRoleGroup("dps", "melee")).toBe(true);
        expect(assign.inRoleGroup("dps", "healer")).toBe(false);
    });

    it("a flex role on this boss wins over the setup's", () => {
        expect(assign.meInRole("melee", ctx(), ["m"])).toBe(true);
        expect(assign.meInRole("melee", ctx({ m: "ranged" }), ["m"])).toBe(false);
        expect(assign.meInRole("ranged", ctx({ m: "ranged" }), ["m"])).toBe(true);
        expect(assign.meInRole("melee", ctx(), [])).toBe(false);
    });
});

describe("Meine Aufgaben / Wirkt auf dich", () => {
    const rows = [row("a", ["role:melee"], [{ kind: "mob", ref: "b:x", name: "Boss", icon: "" }], "tank"), row("b", ["user:h"], [{ kind: "role", ref: "ranged" }], "heal"), row("c", ["role:ranged"], [])];

    it("\"Melees -> Boss\" is a task of every melee, never of a ranged; \"Heal -> Ranged\" acts on every ranged", () => {
        const melee = mv.splitMine(rows, ctx(), ["m"], []);
        expect(melee.modes).toEqual({ a: "do" });
        const ranged = mv.splitMine(rows, ctx(), ["r"], []);
        expect(ranged.modes).toEqual({ b: "on", c: "do" });
        expect(assign.isMine(rows[0], ctx(), ["m"])).toBe(true);
        expect(assign.isMine(rows[0], ctx(), ["r"])).toBe(false);
        expect(assign.isMine(rows[1], ctx(), ["r"])).toBe(true);
        // a healer who does it does it, the target role group is not him
        expect(mv.splitMine(rows, ctx(), ["h"], []).modes).toEqual({ b: "do" });
    });

    it("the chip names the role group, not the players", () => {
        const card = mv.mineCard(mv.rowMode(rows[1], ctx(), ["r"], []));
        expect(card.who).toEqual(["user:h"]);
        expect(assign.resolveTarget({ kind: "role", ref: "ranged" }, ctx())).toMatchObject({ kind: "role", player: null, label: "Ranged" });
    });
});
