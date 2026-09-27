// The mark on the sheet's section chips (lib/raidplan/bossMine.ts, issue #503): only a personal assignment counts - by name or slot as the
// one who does it, or as the target ("Wirkt auf dich") - never a role group, a raid group or a name in a note.
import { describe, expect, it } from "vitest";
import type { RaidplanAssignment, RaidplanPlayer, RaidplanSlot, RaidplanStep } from "../../api";
import { bossesWithMine, hasMine, isPersonalRow, isPersonalStep, type MineSection } from "./bossMine";
import { isMine } from "./assign";

const player = (userId: string, character: string, group = 1, role = "healer"): RaidplanPlayer => ({ userId, character, classId: "Priest", className: "", classColor: "", spec: "", specLabel: "", role, group }) as RaidplanPlayer;
const slot = (kind: string, n: number, userId = ""): RaidplanSlot => ({ id: `${kind}${n}`, kind, n, userId, x: 0.3, y: 0.3, label: "" }) as RaidplanSlot;
const row = (id: string, type: string, assignees: string[], targets: RaidplanAssignment["targets"], extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra }) as RaidplanAssignment;
const step = (participants: string[]): RaidplanStep => ({ id: "s", action: "move", participants, sentence: "", targets: [], timing: { kind: "", from: null, to: null, text: "" } });
const players = new Map([["h1", player("h1", "Heilbert", 2)], ["t1", player("t1", "Tankwart", 1, "tank")], ["k1", player("k1", "Schleich", 3, "melee")]]);
const slots = [slot("healer", 1, "h1"), slot("tank", 1, "t1")];
const ctx = { slots, players, roles: {} };
const section = (key: string, assignments: RaidplanAssignment[], steps: RaidplanStep[] = []): MineSection => ({ key, slots, assignments, steps });

describe("a personal row", () => {
    it("names me as the one who does it: by character or by my slot", () => {
        expect(isPersonalRow(row("a", "heal", ["user:h1"], [{ kind: "slot", ref: "tank:1" }]), ctx, ["h1"])).toBe(true);
        expect(isPersonalRow(row("b", "kick", ["slot:healer:1"], []), ctx, ["h1"])).toBe(true);
        expect(isPersonalRow(row("c", "tank", ["user:t1"], [{ kind: "text", ref: "Boss" }]), ctx, ["h1"])).toBe(false);
    });
    it("or names me as its target (Wirkt auf dich): me or my slot", () => {
        expect(isPersonalRow(row("a", "ss", ["user:t1"], [{ kind: "player", ref: "h1" }]), ctx, ["h1"])).toBe(true);
        expect(isPersonalRow(row("b", "md", ["user:t1"], [{ kind: "slot", ref: "healer:1" }]), ctx, ["h1"])).toBe(true);
    });
    it("never through my role group, my raid group or my name in words - although those are 'Only for me' rows", () => {
        const byRole = row("r", "special", ["role:healer"], []);
        const onRole = row("o", "buff", ["user:t1"], [{ kind: "role", ref: "healer" }]);
        const onGroup = row("g", "heal", ["user:t1"], [{ kind: "group", ref: "2" }]);
        const inWords = row("w", "other", ["user:t1"], [{ kind: "text", ref: "Heilbert soaks" }], { note: "Heilbert" });
        for (const a of [byRole, onRole, onGroup, inWords]) {
            expect(isMine(a, ctx, ["h1"], ["Heilbert"])).toBe(true);
            expect(isPersonalRow(a, ctx, ["h1"])).toBe(false);
        }
    });
    it("nobody without a visitor", () => {
        expect(isPersonalRow(row("a", "heal", ["user:h1"], []), ctx, [])).toBe(false);
    });
});

describe("a personal step", () => {
    it("has me among its participants by name, not only my group", () => {
        expect(isPersonalStep(step(["user:h1", "user:t1"]), ["h1"])).toBe(true);
        expect(isPersonalStep(step(["group:2"]), ["h1"])).toBe(false);
        expect(isPersonalStep(step([]), ["h1"])).toBe(false);
    });
});

describe("bossesWithMine", () => {
    const bosses = [
        section("general", [row("x", "buff", ["role:healer"], [])]),
        section("winterchill", [row("a", "heal", ["user:h1"], [{ kind: "slot", ref: "tank:1" }])]),
        section("anetheron", [row("b", "heal", ["user:t1"], [{ kind: "group", ref: "2" }])]),
        section("kazrogal", [row("c", "ss", ["user:t1"], [{ kind: "player", ref: "h1" }])]),
        section("azgalor", [], [step(["group:2"])]),
        section("archimonde", [], [step(["user:h1"])]),
    ];
    it("are the sections with a personal row or step of mine", () => {
        expect([...bossesWithMine(bosses, players, ["h1"])]).toEqual(["winterchill", "kazrogal", "archimonde"]);
        expect(hasMine(bosses[2], players, ["h1"])).toBe(false);
    });
    it("follow every player of the visitor (main and alt)", () => {
        expect([...bossesWithMine(bosses, players, ["t1"])]).toEqual(["winterchill", "anetheron", "kazrogal"]);
        expect([...bossesWithMine(bosses, players, ["k1", "h1"])]).toEqual(["winterchill", "kazrogal", "archimonde"]);
    });
    it("are none without a visitor", () => {
        expect(bossesWithMine(bosses, players, []).size).toBe(0);
    });
});
