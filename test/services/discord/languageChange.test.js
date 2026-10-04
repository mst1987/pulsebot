// A new server language redraws the public messages; a failing step never throws.
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ refreshPanels: jest.fn(async () => ({ edited: 2, failed: 0 })) }));

const availabilityPanel = require("../../../src/services/signups/availabilityPanel");
const { afterServerLangChange } = require("../../../src/services/discord/languageChange");

describe("services/discord/languageChange", () => {
    it("redraws the panels with the new config", async () => {
        const config = { botLanguage: "en" };
        const out = await afterServerLangChange({ config });
        expect(availabilityPanel.refreshPanels).toHaveBeenCalledWith({ config });
        expect(out.panels).toEqual({ edited: 2, failed: 0 });
    });

    it("reports a failing step instead of throwing", async () => {
        availabilityPanel.refreshPanels.mockRejectedValueOnce(new Error("offline"));
        expect((await afterServerLangChange()).panels).toEqual({ error: "offline" });
    });
});
