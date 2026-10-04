// A new server language redraws the public messages; a failing step never throws.
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ refreshPanels: jest.fn(async () => ({ edited: 2, failed: 0 })) }));
jest.mock("../../../src/services/events/eventMessage", () => ({ sweepEventMessages: jest.fn(async () => ({ checked: 3, redrawn: 3 })) }));
jest.mock("../../../src/services/talk/talkOverview", () => ({ syncOverview: jest.fn(async () => ({ results: [] })) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({ refreshSetupMessages: jest.fn(async () => ({ edited: 1, failed: 0 })) }));

const availabilityPanel = require("../../../src/services/signups/availabilityPanel");
const eventMessage = require("../../../src/services/events/eventMessage");
const talkOverview = require("../../../src/services/talk/talkOverview");
const setupMessage = require("../../../src/services/setup/setupMessage");
const { afterServerLangChange } = require("../../../src/services/discord/languageChange");

describe("services/discord/languageChange", () => {
    it("redraws the panels with the new config", async () => {
        const config = { botLanguage: "en" };
        const out = await afterServerLangChange({ config });
        expect(availabilityPanel.refreshPanels).toHaveBeenCalledWith({ config });
        expect(out.panels).toEqual({ edited: 2, failed: 0 });
    });

    it("redraws the event messages, the talk overview and the setup messages", async () => {
        const config = { botLanguage: "de" };
        const out = await afterServerLangChange({ config });
        expect(eventMessage.sweepEventMessages).toHaveBeenCalled();
        expect(talkOverview.syncOverview).toHaveBeenCalledWith({ config });
        expect(setupMessage.refreshSetupMessages).toHaveBeenCalled();
        expect(out).toMatchObject({ eventMessages: { checked: 3, redrawn: 3 }, talkOverview: { results: [] }, setupMessages: { edited: 1, failed: 0 } });
    });

    it("keeps going when one step fails", async () => {
        eventMessage.sweepEventMessages.mockRejectedValueOnce(new Error("offline"));
        const out = await afterServerLangChange();
        expect(out.eventMessages).toEqual({ error: "offline" });
        expect(talkOverview.syncOverview).toHaveBeenCalledWith({});
        expect(out.setupMessages).toEqual({ edited: 1, failed: 0 });
    });

    it("reports a failing step instead of throwing", async () => {
        availabilityPanel.refreshPanels.mockRejectedValueOnce(new Error("offline"));
        expect((await afterServerLangChange()).panels).toEqual({ error: "offline" });
    });
});
