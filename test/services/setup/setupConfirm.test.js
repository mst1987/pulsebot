// Confirm/Cancel als ein Dienst fuer Raider-Klick und Orga-Haken im Editor
// (src/services/setup/setupConfirm.js): setzen, zuruecknehmen, wer es war,
// nur fuer Gruppen-Plaetze, die gepostete Nachricht folgt.
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) };
        return JSON.parse(JSON.stringify(e));
    }),
}));
jest.mock("../../../src/services/setup/setupMessage", () => ({ postOrEditSetupMessage: jest.fn(async () => ({ action: "edited" })) }));

const eventStore = require("../../../src/stores/eventStore");
const { postOrEditSetupMessage } = require("../../../src/services/setup/setupMessage");
const { setConfirmation } = require("../../../src/services/setup/setupConfirm");
const { confirmationsFor } = require("../../../src/services/setup/setupCore");

const slot = (userId) => ({ userId, character: `C${userId}`, spec: "Priest-Holy", role: "healer" });

function seed(over = {}) {
    const approved = { version: 4, groups: [{ index: 1, slots: [slot("1"), slot("2")] }], bench: [slot("5")] };
    mockEvents.set("eh-1", { id: "eh-1", setup: { status: "approved", version: 4, approved }, setupPost: { channelId: "c1", messageId: "m1" }, ...over });
}

beforeEach(() => {
    mockEvents.clear();
    jest.clearAllMocks();
});

describe("setConfirmation", () => {
    it("lets the orga set a raider's check and take it away again — the message follows each time", async () => {
        seed();
        expect(await setConfirmation("eh-1", "1", "confirmed", { by: "orga", now: 7 })).toMatchObject({ status: "confirmed", refreshed: { action: "edited" } });
        expect(mockEvents.get("eh-1").setupPost.confirmations).toEqual({ 1: { status: "confirmed", at: 7, by: "orga" } });
        expect(postOrEditSetupMessage).toHaveBeenCalledWith("eh-1", { userId: "orga" });

        await setConfirmation("eh-1", "1", "", { by: "orga" });
        expect(mockEvents.get("eh-1").setupPost.confirmations).toEqual({});
        expect(postOrEditSetupMessage).toHaveBeenCalledTimes(2);
    });

    it("keeps everybody else's answer", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "m1", confirmations: { 2: { status: "declined", at: 1, by: "2" } } } });
        await setConfirmation("eh-1", "1", "confirmed", { by: "orga" });
        expect(confirmationsFor(mockEvents.get("eh-1"), mockEvents.get("eh-1").setup.approved)).toEqual({ 1: "confirmed", 2: "declined" });
    });

    it("refuses an unknown status, the bench, a stranger, a missing event or setup", async () => {
        seed();
        expect((await setConfirmation("eh-1", "1", "maybe")).code).toBe("invalid");
        expect((await setConfirmation("eh-1", "5", "confirmed")).code).toBe("not_placed");
        expect((await setConfirmation("eh-1", "", "confirmed")).code).toBe("not_placed");
        expect((await setConfirmation("eh-x", "1", "confirmed")).code).toBe("not_found");
        seed({ setup: { status: "draft", version: 1 } });
        expect((await setConfirmation("eh-1", "1", "confirmed")).code).toBe("no_approved_setup");
        expect(eventStore.setEventSetupPost).not.toHaveBeenCalled();
    });

    it("never posts a message of its own when none is out yet", async () => {
        seed({ setupPost: null });
        expect(await setConfirmation("eh-1", "1", "confirmed", { by: "orga" })).toMatchObject({ status: "confirmed", refreshed: null });
        expect(postOrEditSetupMessage).not.toHaveBeenCalled();
    });
});
