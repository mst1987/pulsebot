// "Kanal neu anlegen" (#537): an own event whose Discord channel was deleted
// gets a new one — named by the naming rule, in its category — and its signup
// message is posted there. Stores run for real on an in-memory disk; Discord,
// the naming and every redraw are mocks.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({
    getClient: jest.fn(() => null),
    listCategories: jest.fn(() => [{ id: "cat", name: "Raids" }]),
    listAllChannels: jest.fn(() => []),
}));
jest.mock("../../../src/services/discord/discordChannels", () => ({
    createFromTemplate: jest.fn(async (guildId, { name }) => ({ id: "c-new", name })),
    placeChannel: jest.fn(async () => true),
    discordErrorText: jest.requireActual("../../../src/services/discord/discordChannels").discordErrorText,
}));
jest.mock("../../../src/services/discord/channelNaming", () => ({ deriveChannelName: jest.fn() }));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => ({ channelId: "c-new", messageId: "m-new", reposted: true })) }));
jest.mock("../../../src/services/talk/talkOverview", () => ({ scheduleOverviewSync: jest.fn() }));
jest.mock("../../../src/services/discord/pingDelivery", () => ({ deliverUserPing: jest.fn(), sendDms: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/setup/setupEditor", () => ({ setupSummary: jest.fn(() => null) }));
jest.mock("../../../src/services/setup/setupMessage", () => ({
    refreshSetupMessage: jest.fn(async () => null),
    postOrEditSetupMessage: jest.fn(async () => ({ action: "posted" })),
}));
jest.mock("../../../src/services/discord/discordEvent", () => ({
    syncForEvent: jest.fn(async () => ({ skipped: "disabled" })),
    warningOf: (r) => (r && r.warning ? `Discord-Event: ${r.warning}` : ""),
}));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const discordChannels = require("../../../src/services/discord/discordChannels");
const channelNaming = require("../../../src/services/discord/channelNaming");
const { refreshEventMessage } = require("../../../src/services/events/eventMessage");
const { postOrEditSetupMessage } = require("../../../src/services/setup/setupMessage");
const { scheduleOverviewSync } = require("../../../src/services/talk/talkOverview");
const discordEvent = require("../../../src/services/discord/discordEvent");
const eventStore = require("../../../src/stores/eventStore");
const { markRaidplanPosted, getRaidplanPost } = require("../../../src/stores/raidplanPostStore");
const manage = require("../../../src/services/events/eventManage");
const { knownChannels, deletedChannels, linkCheck } = require("../../helpers/linkCheck");

const ORGA = { id: "900000000000000001", name: "Orga" };
const START = Math.floor(Date.now() / 1000) + 7 * 86400;

function seed(over = {}) {
    return eventStore.createEvent({
        guildId: "g1", channelId: "c-old", channelName: "mi-24-09-kara", categoryId: "cat", categoryName: "Raids",
        title: "Karazhan", startTime: START, instanceIds: ["kara"], size: 10, ...over,
    }).event;
}

const run = (eventId, guildId = "g1") => manage.recreateChannel({ guildId, eventId, user: ORGA, byName: "Orga" });

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    deletedChannels("c-old");
    channelNaming.deriveChannelName.mockResolvedValue({ name: "mi-24-09-kara", templateChannelId: "tpl", placement: { afterChannelId: "c-prev" } });
    discord.listCategories.mockReturnValue([{ id: "cat", name: "Raids" }]);
});

describe("services/events/eventManage — recreateChannel (#537)", () => {
    it("creates the channel by the naming rule in the event's category and posts the signup message there", async () => {
        const event = seed();
        eventStore.setEventMessage(event.id, { channelId: "c-old", messageId: "m-old", hash: "h" });
        markRaidplanPosted(event.id, { channelId: "c-old", messageId: "m-plan", message: "" });

        const result = await run(event.id);

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ channelId: "c-new", channelName: "mi-24-09-kara" });
        expect(result.body.message).toMatch(/Kanal #mi-24-09-kara angelegt/);
        expect(channelNaming.deriveChannelName).toHaveBeenCalledWith(expect.objectContaining({ guildId: "g1", categoryId: "cat", excludeChannelId: "c-old", instanceIds: ["kara"] }));
        expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("g1", { name: "mi-24-09-kara", parentId: "cat", templateChannelId: "tpl", afterChannelId: "c-prev" });
        const stored = eventStore.getEvent(event.id);
        expect(stored).toMatchObject({ channelId: "c-new", channelName: "mi-24-09-kara", message: null });
        expect(refreshEventMessage).toHaveBeenCalledWith(event.id);
        expect(getRaidplanPost(event.id)).toBeNull();
        expect(discordEvent.syncForEvent).toHaveBeenCalledWith(event.id);
        expect(scheduleOverviewSync).toHaveBeenCalled();
        expect(linkCheck.channelLink("g1", "c-new")).toBe("https://discord.com/channels/g1/c-new");
        expect(stored.log.at(-1)).toMatchObject({ action: "channel", by: ORGA.id, detail: "#mi-24-09-kara → #mi-24-09-kara" });
        expect(postOrEditSetupMessage).not.toHaveBeenCalled();
    });

    it("posts a setup that was posted before into the new channel", async () => {
        const event = seed();
        eventStore.setEventSetupPost(event.id, { channelId: "c-old", messageId: "m-setup", version: 2 });
        await run(event.id);
        expect(eventStore.getEvent(event.id).setupPost).toMatchObject({ channelId: "", messageId: "", version: 2 });
        expect(postOrEditSetupMessage).toHaveBeenCalledWith(event.id);
    });

    it("refuses while the channel still exists, and while nothing is known (bot offline)", async () => {
        const event = seed();
        knownChannels("c-old");
        expect((await run(event.id)).error).toMatchObject({ status: 409, code: "channel_exists" });
        linkCheck._reset();
        expect((await run(event.id)).error).toMatchObject({ status: 503, code: "bot_offline" });
        expect(discordChannels.createFromTemplate).not.toHaveBeenCalled();
    });

    it("refuses a Raid-Helper event and an event of another server", async () => {
        const event = seed();
        expect((await run("12345")).error).toMatchObject({ code: "not_own_event" });
        expect((await run(event.id, "g-other")).error).toMatchObject({ status: 404 });
    });

    it("reports Discord's refusal without touching the event", async () => {
        const event = seed();
        discordChannels.createFromTemplate.mockRejectedValueOnce(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        const result = await run(event.id);
        expect(result.error).toMatchObject({ status: 400, code: "create_failed", message: expect.stringContaining("fehlende Rechte") });
        expect(eventStore.getEvent(event.id).channelId).toBe("c-old");
    });

    it("falls back to the stored name and to no category when the category is gone, and says so", async () => {
        const event = seed();
        channelNaming.deriveChannelName.mockRejectedValueOnce(new Error("offline"));
        discord.listCategories.mockReturnValue([]);
        refreshEventMessage.mockRejectedValueOnce(new Error("Missing Access"));
        const result = await run(event.id);
        expect(discordChannels.createFromTemplate).toHaveBeenCalledWith("g1", { name: "mi-24-09-kara", parentId: "", templateChannelId: "" });
        expect(result.body.warnings).toEqual([
            "Die Kategorie des Events gibt es nicht mehr – der Kanal steht ohne Kategorie.",
            "Anmelde-Nachricht: Missing Access",
        ]);
    });
});
