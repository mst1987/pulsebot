const { REASONS, reasonIdFor, reasonMeta, describeReason, reasonCatalog } = require("../../src/utils/lootReasons");

describe("lootReasons", () => {
    describe("reasonIdFor", () => {
        it.each([
            ["BiS", "bis"],
            ["Best in Slot", "bis"],
            ["Upgrade", "upgrade"],
            ["Major Upgrade", "upgrade"],
            ["Minor Upgrade", "minor"],
            ["Sidegrade", "minor"],
            ["Main Spec", "mainspec"],
            ["Mainspec", "mainspec"],
            ["MS", "mainspec"],
            ["Off Spec", "offspec"],
            ["Off-Spec", "offspec"],
            ["OS", "offspec"],
            ["Zweitspec", "offspec"],
            ["PvP", "pvp"],
            ["Greed", "greed"],
            ["Free Roll", "greed"],
            ["Disenchant", "disenchant"],
            ["Entzaubern", "disenchant"],
            ["Gildenbank", "bank"],
            ["Bank", "bank"],
        ])("maps the response %p to %p", (response, expected) => {
            expect(reasonIdFor({ response })).toBe(expected);
        });

        it("prefers the more specific bucket over the broader one", () => {
            // "Minor Upgrade" contains "Upgrade", "Off-Spec Upgrade" contains both.
            expect(reasonIdFor({ response: "Minor Upgrade" })).toBe("minor");
            expect(reasonIdFor({ response: "Off-Spec Upgrade" })).toBe("offspec");
        });

        it("falls back to the offspec flag when the response says nothing usable", () => {
            expect(reasonIdFor({ response: "", offspec: true })).toBe("offspec");
            expect(reasonIdFor({ response: "???", offspec: true })).toBe("offspec");
        });

        it("reports an unrecognised mainspec-side response as other, never as a guess", () => {
            // A guild wording nobody has taught the parser must not be counted
            // as a mainspec win — the breakdown would be quietly wrong.
            expect(reasonIdFor({ response: "Ratsentscheid", offspec: false })).toBe("other");
            expect(reasonIdFor({})).toBe("other");
            expect(reasonIdFor(null)).toBe("other");
        });

        it("is case-insensitive", () => {
            expect(reasonIdFor({ response: "off spec" })).toBe("offspec");
            expect(reasonIdFor({ response: "BIS" })).toBe("bis");
        });
    });

    describe("reasonMeta", () => {
        it("returns label, tone and display order for a known reason", () => {
            expect(reasonMeta("mainspec")).toEqual({ id: "mainspec", label: "Mainspec", tone: "mainspec", order: 1 });
        });

        it("orders the buckets from strongest to weakest", () => {
            expect(reasonMeta("bis").order).toBeLessThan(reasonMeta("mainspec").order);
            expect(reasonMeta("mainspec").order).toBeLessThan(reasonMeta("offspec").order);
            expect(reasonMeta("offspec").order).toBeLessThan(reasonMeta("other").order);
        });

        it("falls back to other for an unknown id instead of returning null", () => {
            expect(reasonMeta("nope").id).toBe("other");
            expect(reasonMeta(undefined).id).toBe("other");
        });
    });

    it("describeReason adds the three fields the client renders", () => {
        expect(describeReason({ response: "Off Spec" })).toEqual({
            reason: "offspec", reasonLabel: "Offspec", reasonTone: "offspec",
        });
    });

    it("reasonCatalog lists every reason with a tone the stylesheet can use", () => {
        const catalog = reasonCatalog();
        expect(catalog).toHaveLength(REASONS.length);
        expect(catalog.map((r) => r.order)).toEqual(REASONS.map((_, i) => i));
        for (const r of catalog) expect(r.tone).toBeTruthy();
    });
});
