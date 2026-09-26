// "Meine Aufgaben" / "Auf mich wirkend" (lib/raidplan/mineView.ts): the split by relation to the visitor, the fixed order of the kinds of task, no mixing.
import { describe, expect, it } from "vitest";
import * as mv from "./mineView";

const player = (userId, character, group = 1, role = "healer") => ({ userId, character, classId: "Priest", className: "", classColor: "", spec: "", specLabel: "", role, group });
const slot = (kind, n, userId = "") => ({ id: `${kind}${n}`, kind, n, userId, x: 0.3, y: 0.3, label: "" });
const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const players = new Map([["h1", player("h1", "Heilbert", 2)], ["h2", player("h2", "Segenreich", 1)], ["t1", player("t1", "Tankwart", 1, "tank")], ["k1", player("k1", "Schleich", 3, "melee")], ["k2", player("k2", "Meuchler", 3, "melee")]]);
const ctx = { slots: [slot("healer", 1, "h1"), slot("healer", 2, "h2"), slot("tank", 1, "t1")], players, catalog: null };
const names = ["Heilbert"];
const split = (list, me = ["h1"]) => mv.splitMine(list, ctx, me, names);
const ids = (blocks) => blocks.map((b) => [b.group, b.rows.map((r) => r.a.id)]);

describe("kinds of task", () => {
    it("come in a fixed order and the small ones share a group", () => {
        expect(mv.TASK_GROUPS.map((g) => g.id)).toEqual(["tank", "heal", "kick", "md", "ss", "fearward", "support", "curse", "warrior", "other"]);
        expect(mv.taskGroupOf("trashtank")).toBe("tank");
        expect(mv.taskGroupOf("dispel")).toBe("support");
        expect(mv.taskGroupOf("cc")).toBe("support");
        expect(mv.taskGroupOf("demoshout")).toBe("warrior");
        expect(mv.taskGroupOf("special")).toBe("other");
        expect(mv.taskGroupOf("nonsense")).toBe("other");
    });
});

describe("my tasks", () => {
    it("are the rows where I am the one who does it, grouped by kind in the fixed order, only kinds with content", () => {
        const list = [row("k", "kick", ["slot:healer:1"], [{ kind: "text", ref: "Fear" }]), row("h", "heal", ["user:h1"], [{ kind: "slot", ref: "tank:1" }]), row("x", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:1" }]), row("s", "ss", ["slot:tank:1"], [])];
        const r = split(list);
        expect(ids(r.mine)).toEqual([["heal", ["h"]], ["kick", ["k"]]]);
        expect(r.mine[0].badge).toBe("heal");
        expect(r.modes).toEqual({ h: "do", k: "do" });
    });
    it("a kick rotation shows my place in it", () => {
        const r = split([row("k", "kick", ["user:k1", "user:k2"], [])], ["k2"]);
        expect(r.mine[0].rows[0].order).toBe(2);
        expect(split([row("k", "kick", ["user:k1"], [])], ["k1"]).mine[0].rows[0].order).toBe(0);
    });
});

describe("what acts on me", () => {
    it("is somebody else's row that targets me, my slot, my group, or names me in words - and never mixes with my tasks", () => {
        const list = [
            row("a", "ss", ["slot:tank:1"], [{ kind: "player", ref: "h1" }]),
            row("b", "heal", ["slot:healer:2"], [{ kind: "group", ref: "2" }]),
            row("c", "md", ["slot:tank:1"], [{ kind: "slot", ref: "healer:1" }]),
            row("d", "fearward", ["slot:tank:1"], [{ kind: "text", ref: "Fear auf Heilbert" }]),
            row("e", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:1" }]),
            row("f", "heal", ["user:h1"], [{ kind: "slot", ref: "tank:1" }]),
        ];
        const r = split(list);
        expect(ids(r.onMe)).toEqual([["heal", ["b"]], ["md", ["c"]], ["ss", ["a"]], ["fearward", ["d"]]]);
        expect(ids(r.mine)).toEqual([["heal", ["f"]]]);
        expect(r.onMe.flatMap((b) => b.rows).map((x) => [x.a.id, x.via, x.group])).toEqual([["b", "group", 2], ["c", "player", 0], ["a", "player", 0], ["d", "text", 0]]);
        const mineIds = r.mine.flatMap((b) => b.rows.map((x) => x.a.id));
        const onIds = r.onMe.flatMap((b) => b.rows.map((x) => x.a.id));
        expect(mineIds.filter((i) => onIds.indexOf(i) >= 0)).toEqual([]);
    });
    it("a row where I am both the one who does it and the target is a task of mine, with the hint 'also on you'", () => {
        const r = split([row("a", "heal", ["user:h1"], [{ kind: "player", ref: "h1" }]), row("b", "heal", ["user:h1"], [{ kind: "group", ref: "2" }]), row("c", "heal", ["user:h1"], [{ kind: "slot", ref: "tank:1" }])]);
        expect(r.onMe).toEqual([]);
        expect(r.mine[0].rows.map((x) => x.alsoOnMe)).toEqual([true, true, false]);
    });
    it("an alt counts, a stranger and a visitor without a recognised player see nothing", () => {
        const list = [row("a", "ss", ["slot:tank:1"], [{ kind: "player", ref: "h1" }])];
        expect(split(list, ["h1", "zzz"]).onMe).toHaveLength(1);
        expect(split(list, ["t1"]).onMe).toEqual([]);
        const none = mv.splitMine(list, ctx, [], []);
        expect(none).toEqual({ mine: [], onMe: [], modes: {} });
    });
    it("names in words only count when the visitor has names", () => {
        const list = [row("d", "other", ["slot:tank:1"], [], { note: "Heilbert wechselt" })];
        expect(mv.splitMine(list, ctx, ["h1"], ["Heilbert"]).onMe).toHaveLength(1);
        expect(mv.splitMine(list, ctx, ["h1"], []).onMe).toEqual([]);
    });
});

describe("the card of one row", () => {
    const rows = (list, me = ["h1"]) => mv.splitMine(list, ctx, me, names);
    it("a task of mine is one card: me as the one who does it and ALL targets of the row together", () => {
        const r = rows([row("h", "heal", ["user:h1"], [{ kind: "group", ref: "1" }, { kind: "group", ref: "5" }, { kind: "slot", ref: "tank:1" }], { note: "nach dem Pull" })]);
        const card = mv.mineCard(r.mine[0].rows[0]);
        expect(card).toMatchObject({ id: "h", type: "heal", whoMe: true, who: [], recipient: "", note: "nach dem Pull" });
        expect(card.to).toEqual([{ kind: "group", ref: "1" }, { kind: "group", ref: "5" }, { kind: "slot", ref: "tank:1" }]);
    });
    it("what acts on me is one card: who does it, and me or my group as the one receiver, no text repeated", () => {
        const r = rows([row("a", "ss", ["slot:tank:1"], [{ kind: "player", ref: "h1" }]), row("b", "heal", ["slot:healer:2"], [{ kind: "group", ref: "2" }]), row("d", "fearward", ["slot:tank:1"], [{ kind: "text", ref: "Fear auf Heilbert" }])]);
        const cards = r.onMe.flatMap((b) => b.rows).map(mv.mineCard);
        expect(cards.map((c) => [c.id, c.whoMe, c.recipient, c.group])).toEqual([["b", false, "group", 2], ["a", false, "me", 0], ["d", false, "text", 0]]);
        expect(cards[0].who).toEqual(["slot:healer:2"]);
        expect(cards[0].to).toEqual([]);
    });
    it("a spell and a title make the text of the card, the kick order and 'also on you' ride along", () => {
        const r = rows([row("k", "kick", ["user:k1", "user:h1"], [{ kind: "group", ref: "2" }], { title: "Fear", spell: { id: "d:kick", name: "Kick", icon: "x" } })]);
        const card = mv.mineCard(r.mine[0].rows[0]);
        expect(card).toMatchObject({ text: "Kick: Fear", order: 2, alsoOnMe: true });
    });
});

describe("runs of groups", () => {
    const g = (n) => ({ kind: "group", ref: String(n), label: `Gruppe ${n}`, group: n, player: null, open: false, mark: "", role: "", icon: "" });
    const pl = { kind: "player", ref: "u", label: "Tank", group: 0, player: null, open: false, mark: "", role: "", icon: "" };
    const name = (a, b) => `Gruppe ${a}-${b}`;
    it("three or more consecutive groups become one entry where the first stood; pairs and singles stay", () => {
        const r = mv.mergeGroupRuns([g(1), g(2), g(3), pl, g(5)], name);
        expect(r.map((x) => x.label)).toEqual(["Gruppe 1-3", "Tank", "Gruppe 5"]);
        expect(r[0].ref).toBe("1-3");
        const two = [g(1), g(2), g(5)];
        expect(mv.mergeGroupRuns(two, name)).toBe(two);
    });
    it("works on an unordered list and several runs", () => {
        const r = mv.mergeGroupRuns([g(5), g(1), g(4), g(2), g(3), g(6)], name);
        expect(r.map((x) => x.label)).toEqual(["Gruppe 1-6"]);
        const s = mv.mergeGroupRuns([g(1), g(2), g(3), g(7), g(8), g(9)], name);
        expect(s.map((x) => x.label)).toEqual(["Gruppe 1-3", "Gruppe 7-9"]);
    });
});
