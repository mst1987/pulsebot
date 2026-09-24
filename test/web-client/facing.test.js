// The auto facing of a boss / mob icon towards its tank (lib/assign.ts facingOf): from the effective rows, never a jump, one pure function.
const { loadTs, makeT } = require("./i18nHelper");

const mention = loadTs("lib/mention.ts");
const assign = loadTs("lib/assign.ts", { t: makeT("de"), ...mention });

const slot = (kind, n, x, y, extra = {}) => ({ id: `${kind}${n}`, kind, n, userId: "", x, y, label: "", placed: true, ...extra });
const icon = (id, x, y, extra = {}) => ({ id, iconKey: "boss:609", x, y, rotation: 30, mobId: "", autoFace: true, hidden: false, ...extra });
const tankRow = (id, assignees, mob, type = "tank") => ({ id, type, title: "", spell: null, assignees, targets: [{ kind: "mob", ref: mob }], note: "", suggested: false });
const board = (over) => ({ tokens: [], slots: [], icons: [], marks: [], assignments: [], ...over });
const UP = 0, RIGHT = 90;

describe("facing towards the tank", () => {
    it("a boss icon without a mob follows the tank of the section's boss (the resolved 'boss of this section', also from the Standard)", () => {
        const b = board({ slots: [slot("tank", 1, 0.5, 0.2)], icons: [icon("i", 0.5, 0.5)], assignments: [tankRow("r", ["slot:tank:1"], "b:bt/supremus")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(UP);
        expect(assign.followsTank(b, b.icons[0])).toBe(true);
    });
    it("an icon of a mob follows the tank of that mob only", () => {
        const b = board({ slots: [slot("tank", 1, 0.9, 0.5), slot("tank", 2, 0.5, 0.1)], icons: [icon("m", 0.5, 0.5, { iconKey: "mob:1", mobId: "d:gathios" })], assignments: [tankRow("r", ["slot:tank:1"], "d:gathios"), tankRow("s", ["slot:tank:2"], "d:other")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(RIGHT);
    });
    it("a tank who is not placed leaves the icon as it is (no jump)", () => {
        const b = board({ slots: [slot("tank", 1, 0.5, 0.2, { placed: false })], icons: [icon("i", 0.5, 0.5)], assignments: [tankRow("r", ["slot:tank:1"], "b:x")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(30);
        expect(assign.followsTank(b, b.icons[0])).toBe(false);
        expect(assign.facingOf(board({ icons: [icon("i", 0.5, 0.5)] }), icon("i", 0.5, 0.5), 1)).toBe(30);
    });
    it("several tanks: the first PLACED one of the rows counts, an off-tank row does not override a placed main tank", () => {
        const b = board({ slots: [slot("tank", 1, 0.5, 0.2, { placed: false }), slot("tank", 2, 0.9, 0.5), slot("tank", 3, 0.1, 0.5)], icons: [icon("i", 0.5, 0.5)], assignments: [tankRow("r", ["slot:tank:1", "slot:tank:2"], "b:x"), tankRow("o", ["slot:tank:3"], "b:x")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(RIGHT);
    });
    it("a raider named by hand or by a resolved class stands where his token or slot is", () => {
        const b = board({ tokens: [{ userId: "u1", x: 0.5, y: 0.9, hidden: false }], icons: [icon("i", 0.5, 0.5)], assignments: [tankRow("r", ["user:u1"], "b:x")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(180);
        const c = board({ slots: [slot("tank", 1, 0.5, 0.1, { userId: "u2" })], icons: [icon("i", 0.5, 0.5)], assignments: [tankRow("r", ["user:u2"], "b:x")] });
        expect(assign.facingOf(c, c.icons[0], 1)).toBe(UP);
    });
    it("a manual angle wins, and 'automatic again' follows the tank again", () => {
        const b = board({ slots: [slot("tank", 1, 0.9, 0.5)], icons: [icon("i", 0.5, 0.5, { autoFace: false, rotation: 200 })], assignments: [tankRow("r", ["slot:tank:1"], "b:x")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(200);
        expect(assign.followsTank(b, b.icons[0])).toBe(false);
        expect(assign.facingOf(b, { ...b.icons[0], autoFace: true }, 1)).toBe(RIGHT);
    });
    it("two icons of the same mob take the tanks of that mob in the order of the icons", () => {
        const b = board({ slots: [slot("tank", 1, 0.9, 0.5), slot("tank", 2, 0.1, 0.5)], icons: [icon("a", 0.5, 0.5, { iconKey: "mob:9", mobId: "d:flame" }), icon("b", 0.5, 0.5, { iconKey: "mob:9", mobId: "d:flame" })], assignments: [tankRow("r", ["slot:tank:1"], "d:flame"), tankRow("s", ["slot:tank:2"], "d:flame")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(RIGHT);
        expect(assign.facingOf(b, b.icons[1], 1)).toBe(270);
        const one = board({ ...b, assignments: [tankRow("r", ["slot:tank:1"], "d:flame")] });
        expect(assign.facingOf(one, one.icons[1], 1)).toBe(RIGHT);
    });
    it("a tank row for another mob, or none at all, changes nothing; trash tank rows count too", () => {
        const b = board({ slots: [slot("tank", 1, 0.9, 0.5)], icons: [icon("m", 0.5, 0.5, { iconKey: "mob:1", mobId: "d:a" })], assignments: [tankRow("r", ["slot:tank:1"], "d:b")] });
        expect(assign.facingOf(b, b.icons[0], 1)).toBe(30);
        const t = board({ slots: [slot("tank", 1, 0.9, 0.5)], icons: [icon("m", 0.5, 0.5, { iconKey: "mob:1", mobId: "d:a" })], assignments: [tankRow("r", ["slot:tank:1"], "d:a", "trashtank")] });
        expect(assign.facingOf(t, t.icons[0], 1)).toBe(RIGHT);
    });
});
