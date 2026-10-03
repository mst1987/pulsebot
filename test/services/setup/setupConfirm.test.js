// Confirm/Cancel als ein Dienst fuer Raider-Klick und Orga-Haken im Editor
// (src/services/setup/setupConfirm.js): setzen, zuruecknehmen, wer es war, nur
// fuer Gruppen-Plaetze; die gepostete Nachricht folgt — beim Raider sofort (in
// der Warteschlange), bei der Orga gebuendelt etwas spaeter. "Alle bestaetigen".
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
jest.mock("../../../src/services/setup/setupMessage", () => ({
    editSetupMessageQueued: jest.fn(async () => ({ action: "edited" })),
    scheduleSetupEdit: jest.fn(),
}));

const eventStore = require("../../../src/stores/eventStore");
const { editSetupMessageQueued, scheduleSetupEdit } = require("../../../src/services/setup/setupMessage");
const { setConfirmation, confirmAll } = require("../../../src/services/setup/setupConfirm");

const slot = (userId) => ({ userId, character: `C${userId}`, spec: "Priest-Holy", role: "healer" });

function seed(over = {}) {
    const approved = { version: 4, groups: [{ index: 1, slots: [slot("1"), slot("2")] }, { index: 2, slots: [slot("3")] }], bench: [slot("5")] };
    mockEvents.set("eh-1", { id: "eh-1", setup: { status: "approved", version: 4, approved }, setupPost: { channelId: "c1", messageId: "m1" }, ...over });
}

beforeEach(() => {
    mockEvents.clear();
    jest.clearAllMocks();
});

describe("setConfirmation", () => {
    it("a raider's own click edits the message at once, in the queue", async () => {
        seed();
        expect(await setConfirmation("eh-1", "1", "confirmed", { by: "1", now: 7 })).toMatchObject({ status: "confirmed", confirmations: { 1: "confirmed" }, refreshed: { action: "edited" } });
        expect(mockEvents.get("eh-1").setupPost.confirmations).toEqual({ 1: { status: "confirmed", at: 7, by: "1" } });
        expect(editSetupMessageQueued).toHaveBeenCalledWith("eh-1", { userId: "1" });
        expect(scheduleSetupEdit).not.toHaveBeenCalled();
    });

    it("the orga's marks answer at once and only schedule the edit — one for a run of clicks", async () => {
        seed();
        const first = await setConfirmation("eh-1", "1", "confirmed", { by: "orga", edit: "later" });
        expect(first).toMatchObject({ confirmations: { 1: "confirmed" }, refreshed: { scheduled: true } });
        await setConfirmation("eh-1", "2", "confirmed", { by: "orga", edit: "later" });
        expect(editSetupMessageQueued).not.toHaveBeenCalled();
        expect(scheduleSetupEdit).toHaveBeenCalledTimes(2);
        expect(scheduleSetupEdit).toHaveBeenCalledWith("eh-1", { userId: "orga" });

        const cleared = await setConfirmation("eh-1", "1", "", { by: "orga", edit: "later" });
        expect(cleared.confirmations).toEqual({ 2: "confirmed" });
    });

    it("keeps everybody else's answer", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "m1", confirmations: { 2: { status: "declined", at: 1, by: "2" } } } });
        const out = await setConfirmation("eh-1", "1", "confirmed", { by: "orga" });
        expect(out.confirmations).toEqual({ 1: "confirmed", 2: "declined" });
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

    it("never touches Discord when no message is out yet", async () => {
        seed({ setupPost: null });
        expect(await setConfirmation("eh-1", "1", "confirmed", { by: "orga" })).toMatchObject({ status: "confirmed", refreshed: null });
        expect(editSetupMessageQueued).not.toHaveBeenCalled();
        expect(scheduleSetupEdit).not.toHaveBeenCalled();
    });
});

describe("confirmAll", () => {
    it("checks everybody in a group without an answer — a cancel stays, the bench is no part of it", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "m1", confirmations: { 2: { status: "declined", at: 1, by: "2" } } } });
        const out = await confirmAll("eh-1", { by: "orga", now: 9 });
        expect(out).toEqual({ count: 2, confirmations: { 1: "confirmed", 2: "declined", 3: "confirmed" } });
        expect(mockEvents.get("eh-1").setupPost.confirmations["3"]).toEqual({ status: "confirmed", at: 9, by: "orga" });
        expect(mockEvents.get("eh-1").setupPost.confirmations["5"]).toBeUndefined();
        expect(scheduleSetupEdit).toHaveBeenCalledWith("eh-1", { userId: "orga" });
    });

    it("does nothing when everybody answered, and refuses without an approved setup", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "m1", confirmations: { 1: { status: "confirmed" }, 2: { status: "confirmed" }, 3: { status: "declined" } } } });
        expect(await confirmAll("eh-1", { by: "orga" })).toMatchObject({ count: 0 });
        expect(eventStore.setEventSetupPost).not.toHaveBeenCalled();
        expect(scheduleSetupEdit).not.toHaveBeenCalled();
        seed({ setup: { status: "draft", version: 1 } });
        expect((await confirmAll("eh-1")).code).toBe("no_approved_setup");
    });
});
