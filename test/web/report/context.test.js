// What the three views of the report page share (src/web/report/context.js):
// links, review rights, reviewed recommendations, roles and per-raider slices.
const { ROLE_LABEL, reportContext } = require("../../../src/web/report/context");

function report(over = {}) {
    return {
        id: "rep1",
        roster: [{ name: "Brokk" }, { name: "Elun" }, { name: "Dorn" }],
        ...over,
    };
}

describe("web/report/context", () => {
    it("labels the three roles in German", () => {
        expect(ROLE_LABEL).toEqual({ tank: "Tank", healer: "Heiler", dps: "DPS" });
    });

    it("links a roster name to its player page and nothing else", () => {
        const ctx = reportContext(report(), null);
        expect(ctx.linkFor("Elun")).toBe("/r/rep1/p/1");
        expect(ctx.linkFor("Brokk")).toBe("/r/rep1/p/0");
        expect(ctx.linkFor("Fremd")).toBeNull();
    });

    it("indexes the roster for linkFor without throwing on a null entry (#483)", () => {
        const ctx = reportContext(report({ roster: [{ name: "Brokk" }, null, { name: "Elun" }] }), null);
        expect(ctx.linkFor("Brokk")).toBe("/r/rep1/p/0");
        expect(ctx.linkFor("Elun")).toBe("/r/rep1/p/2");
    });

    it("works for a bare report: no recommendations, no fights, empty slices, everyone DPS", () => {
        const ctx = reportContext({ id: "x" }, undefined);
        expect(ctx.reviewer).toBe(false);
        expect(ctx.rec).toBeNull();
        expect(ctx.recItems).toEqual([]);
        expect(ctx.fights).toEqual([]);
        expect(ctx.roleOf("Anyone")).toBe("dps");
        expect(ctx.gearByName.size).toBe(0);
        expect(ctx.rpbDmgByName.size).toBe(0);
        expect(ctx.sent).toEqual({});
        expect(ctx.linkFor("Anyone")).toBeNull();
    });

    it("gives review rights to admins and CLA writers only", () => {
        expect(reportContext(report(), { isAdmin: true }).reviewer).toBe(true);
        expect(reportContext(report(), { access: { cla: { write: true } } }).reviewer).toBe(true);
        expect(reportContext(report(), { access: { cla: { read: true } } }).reviewer).toBe(false);
    });

    it("applies the review to the recommendations and flattens raid and player items", () => {
        const ctx = reportContext(report({
            recommendations: {
                raid: [{ key: "r1", title: "Raid" }],
                players: [{ name: "Elun", items: [{ key: "p1" }, { key: "p2" }] }],
            },
            recommendationReview: { raid: { r1: { approved: true } }, players: { Elun: { p2: { approved: false, text: "eigener" } } } },
            recommendationSent: { Elun: { at: 1 } },
        }), null);
        expect(ctx.recItems.map((i) => [i.key, i.approved, i.custom])).toEqual([["r1", true, ""], ["p1", null, ""], ["p2", false, "eigener"]]);
        expect(ctx.recByName.get("Elun").items).toHaveLength(2);
        expect(ctx.sent).toEqual({ Elun: { at: 1 } });
    });

    it("derives roles from the healers, the fights' tanks and the RPB roles", () => {
        const ctx = reportContext(report({
            healers: { players: [{ name: "Elun" }] },
            timeline: { fights: [{ healers: { tank: { name: "Brokk" } } }, { healers: null }] },
            rpb: { roles: { Dorn: "Healer", Tia: "Tank", Zed: "Caster" } },
        }), null);
        expect(ctx.roleOf("Brokk")).toBe("tank");
        expect(ctx.roleOf("Tia")).toBe("tank");
        expect(ctx.roleOf("Elun")).toBe("healer");
        expect(ctx.roleOf("Dorn")).toBe("healer");
        expect(ctx.roleOf("Zed")).toBe("dps");
        expect(ctx.fights).toHaveLength(2);
    });

    it("indexes every raid-wide summary by name, skipping entries without a name", () => {
        const one = (name) => ({ players: [{ name }, { x: 1 }] });
        const ctx = reportContext(report({
            players: [{ name: "G" }],
            consumables: { players: [null, { name: "C" }] }, potions: one("P"), raidBuffs: one("B"), healers: one("H"),
            activity: one("A"), cooldowns: one("CD"), totems: one("T"), mechanics: one("M"),
            drums: one("D"), shadowResi: one("S"), sunder: [{ name: "SU" }],
            rpb: { damage: one("RD"), activity: one("RA"), usage: [{ name: "RU" }], interrupts: one("RI") },
        }), null);
        const pairs = [
            ["gearByName", "G"], ["consByName", "C"], ["potByName", "P"], ["buffsByName", "B"], ["healByName", "H"],
            ["actByName", "A"], ["cdByName", "CD"], ["totByName", "T"], ["mechByName", "M"], ["drumsByName", "D"],
            ["srByName", "S"], ["sunderByName", "SU"], ["rpbDmgByName", "RD"], ["rpbActByName", "RA"],
            ["rpbUseByName", "RU"], ["rpbIntByName", "RI"],
        ];
        for (const [key, name] of pairs) {
            expect([key, [...ctx[key].keys()]]).toEqual([key, [name]]);
        }
    });
});
