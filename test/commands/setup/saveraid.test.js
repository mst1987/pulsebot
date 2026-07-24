const { mockInteraction } = require("../../helpers/mockInteraction.js");

jest.mock("../../../src/classes/raidhelper.js");
jest.mock("../../../src/utils/helper.js");

const Raidhelper = require("../../../src/classes/raidhelper.js");
const helper = require("../../../src/utils/helper.js");
const saveraid = require("../../../src/commands/setup/saveraid.js");

function setupRaidhelper(saveRaidMock) {
    Raidhelper.mockImplementation(() => ({ saveRaid: saveRaidMock }));
}

describe("commands/setup/saveraid", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        helper.checkForPermission.mockReturnValue(true);
        helper.getRaidInfosFromChannel.mockResolvedValue({ raidData: {}, setupData: [] });
    });

    it("exports the correct command contract", () => {
        expect(saveraid.name).toBe("saveraid");
        expect(typeof saveraid.description).toBe("string");
        expect(typeof saveraid.execute).toBe("function");
    });

    it("aborts when the user lacks permission", async () => {
        helper.checkForPermission.mockReturnValue(false);
        const saveRaid = jest.fn();
        setupRaidhelper(saveRaid);
        const interaction = mockInteraction({ userId: "not-admin" });

        await saveraid.execute(interaction, {});

        expect(helper.getRaidInfosFromChannel).not.toHaveBeenCalled();
        expect(saveRaid).not.toHaveBeenCalled();
        expect(helper.botReply).not.toHaveBeenCalled();
    });

    it("confirms with a link when the raid is saved", async () => {
        const saveRaid = jest.fn().mockResolvedValue({ _id: "abc123" });
        setupRaidhelper(saveRaid);
        const interaction = mockInteraction({ userId: "233598324022837249" });

        await saveraid.execute(interaction, {});

        expect(saveRaid).toHaveBeenCalledTimes(1);
        expect(helper.botReply).toHaveBeenCalledTimes(1);
        expect(helper.botReply.mock.calls[0][1]).toBe("Save");
        expect(helper.botReply.mock.calls[0][2]).toMatch(/abc123/);
    });

    it("reports an error when the API returns no id", async () => {
        const saveRaid = jest.fn().mockResolvedValue({});
        setupRaidhelper(saveRaid);
        const interaction = mockInteraction({ userId: "233598324022837249" });

        await saveraid.execute(interaction, {});

        expect(helper.botReply).toHaveBeenCalledTimes(1);
        expect(helper.botReply.mock.calls[0][1]).toBe("Fehler");
    });
});
