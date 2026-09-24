// "That is you" in the assignments: named in words, lines that concern the visitor (lib/assign.ts + lib/mention.ts).
const { loadTs, makeT } = require("./i18nHelper");

const mention = loadTs("lib/mention.ts");
const assign = loadTs("lib/assign.ts", { t: makeT("de"), ...mention });

const player = (userId, character, group = 1) => ({ userId, character, classId: "Priest", className: "", classColor: "", spec: "", specLabel: "", role: "healer", group });
const slot = (kind, n, userId = "", x = 0.3, y = 0.3) => ({ id: `${kind}${n}`, kind, n, userId, x, y, label: "" });
const row = (id, type, assignees, targets, extra = {}) => ({ id, type, title: "", spell: null, assignees, targets, note: "", suggested: false, ...extra });
const ctx = { slots: [slot("healer", 1, "h1"), slot("tank", 1, "t1")], players: new Map([["h1", player("h1", "Heilbert", 2)], ["t1", player("t1", "Tankwart", 1)]]), catalog: null };

describe("isMine also finds the visitor named in words", () => {
    const names = ["Heilbert", "Bärchen"];
    it("as assignee, as target, in a group of his, and by name in the note or a free-text target", () => {
        expect(assign.isMine(row("a", "heal", ["slot:healer:1"], []), ctx, ["h1"], names)).toBe(true);
        expect(assign.isMine(row("b", "ss", ["slot:tank:1"], [{ kind: "player", ref: "h1" }]), ctx, ["h1"], names)).toBe(true);
        expect(assign.isMine(row("c", "heal", ["slot:tank:1"], [{ kind: "group", ref: "2" }]), ctx, ["h1"], names)).toBe(true);
        expect(assign.isMine(row("d", "other", ["slot:tank:1"], [], { note: "wenn heilbert tot ist" }), ctx, ["h1"], names)).toBe(true);
        expect(assign.isMine(row("e", "cc", ["slot:tank:1"], [{ kind: "text", ref: "Fear auf Bärchen" }]), ctx, ["h1"], names)).toBe(true);
    });
    it("not for somebody else's rows, not without a recognised visitor, and without names only the references count", () => {
        expect(assign.isMine(row("f", "kick", ["slot:tank:1"], [{ kind: "text", ref: "Fear" }], { note: "Baumbart" }), ctx, ["h1"], names)).toBe(false);
        expect(assign.isMine(row("d", "other", ["slot:tank:1"], [], { note: "Heilbert" }), ctx, [], names)).toBe(false);
        expect(assign.isMine(row("d", "other", ["slot:tank:1"], [], { note: "Heilbert" }), ctx, ["h1"])).toBe(false);
    });
});

describe("my tasks", () => {
    it("include a row that only names the visitor in words, once, and keep the assignee's own tasks", () => {
        const list = [row("a", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }]), row("n", "other", ["slot:tank:1"], [], { title: "Achtung", note: "Heilbert wechselt" })];
        const mine = assign.myTasks(list, ctx, ["h1"], ["Heilbert"]);
        expect(mine.map((k) => k.id.split(":")[0])).toEqual(["a", "n"]);
        expect(assign.myTasks(list, ctx, ["h1"]).map((k) => k.id.split(":")[0])).toEqual(["a"]);
        expect(assign.myTasks(list, ctx, [], ["Heilbert"])).toEqual([]);
    });
});

describe("lines that concern the visitor", () => {
    const board = { slots: [slot("healer", 1, "h1", 0.2, 0.2), slot("healer", 2, "h2", 0.3, 0.2), slot("tank", 1, "t1", 0.5, 0.5), slot("tank", 2, "t2", 0.6, 0.5)], tokens: [], marks: [], assignments: [
        row("x", "heal", ["slot:healer:1"], [{ kind: "slot", ref: "tank:1" }]),
        row("y", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:2" }]),
        row("z", "heal", ["slot:healer:2"], [{ kind: "slot", ref: "tank:1" }]),
    ] };
    it("are marked when the visitor is the healer or the one healed", () => {
        const links = assign.assignmentLinks(board, ["h1"]);
        expect(links.map((k) => !!k.mine)).toEqual([true, false, false]);
        const tank = assign.assignmentLinks(board, ["t1"]);
        expect(tank.map((k) => !!k.mine)).toEqual([true, false, true]);
        expect(assign.assignmentLinks(board).every((k) => !k.mine)).toBe(true);
    });
});
