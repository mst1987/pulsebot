const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/utils/helper.js");

const helper = require("../../../src/utils/helper.js");
const createOverview = require("../../../src/commands/setup/createOverview.js");

const ADMIN_ID = "233598324022837249";

describe("commands/setup/createOverview", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        helper.showAllEvents.mockResolvedValue("formatted raids");
    });

    it("exports the correct command contract", () => {
        expect(createOverview.name).toBe("createoverview");
        expect(typeof createOverview.description).toBe("string");
        expect(typeof createOverview.execute).toBe("function");
    });

    it("is admin-only unless the Bot-Befehle settings say otherwise", () => {
        // The check itself runs centrally before execute (src/web/botAccess.js).
        expect(createOverview.defaultAccess).toBe("admins");
        expect(typeof createOverview.group).toBe("string");
    });

    it("replies with an error when the channel has no parent category", async () => {
        const interaction = mockInteraction({
            userId: ADMIN_ID,
            channel: { id: "c1", parent: null },
        });

        await createOverview.execute(interaction, {});

        expect(helper.botReply).toHaveBeenCalledTimes(1);
        expect(helper.botReply.mock.calls[0][1]).toBe("Fehler");
        expect(helper.showAllEvents).not.toHaveBeenCalled();
    });

    it("renders the overview with buttons for an admin", async () => {
        const interaction = mockInteraction({
            userId: ADMIN_ID,
            channel: { id: "c1", parent: { id: "cat-1", name: "GDKP Raids" } },
        });

        await createOverview.execute(interaction, {});

        expect(helper.showAllEvents).toHaveBeenCalledWith(interaction, "cat-1");
        expect(helper.botReply).toHaveBeenCalledTimes(1);
        const call = helper.botReply.mock.calls[0];
        expect(call[1]).toBe("GDKP Raids");
        expect(call[2]).toBe("formatted raids");
        // components row is the 6th arg
        expect(Array.isArray(call[5])).toBe(true);
        expect(call[5]).toHaveLength(1);
    });
});
