// Which council content a game version has (#748): TBC everything, any other version nothing.
const { councilContentFor } = require("../../src/config/councilContent");

describe("config/councilContent", () => {
    it("gives TBC all of the council's content", () => {
        expect(councilContentFor("tbc")).toEqual({ bis: true, sim: true, tiers: true, itemTable: true });
    });

    it.each(["forever", "classic", "", undefined, "unknown"])("gives %p none of it", (id) => {
        expect(councilContentFor(id)).toEqual({ bis: false, sim: false, tiers: false, itemTable: false });
    });

    it("hands out a copy, not the shared map", () => {
        const a = councilContentFor("tbc");
        a.bis = false;
        expect(councilContentFor("tbc").bis).toBe(true);
    });
});
