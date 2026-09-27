// "Einteilungen posten" (#502): the raid plan's read link in the event channel.
// The stores run for real on an in-memory disk; Discord and the public base url are mocked.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => ({ postLink: jest.fn(), editLink: jest.fn() }));
jest.mock("../../../src/utils/publicUrl", () => ({ publicBaseUrl: jest.fn(() => "https://eh.example") }));

const fs = require("fs");
const discord = require("../../../src/services/discord/discord");
const { publicBaseUrl } = require("../../../src/utils/publicUrl");
const raidplanStore = require("../../../src/stores/raidplanStore");
const { getRaidplanPost, markRaidplanPosted } = require("../../../src/stores/raidplanPostStore");
const { postRaidplanLink, raidplanPostState, linkMessage, eventHasPlan, planFilled } = require("../../../src/services/raidplan/raidplanPost");

const OWN = { id: "eh-1", source: "eventhelper", title: "Karazhan", channelId: "chan1", startTime: 1800000000 };
const RH = { id: "rh-1", source: "raidhelper", title: "Gruul", channelId: "chan2", startTime: 1800000000 };

/** A saved plan with one board, optionally published. */
function savePlan(eventId, { published = false } = {}) {
    raidplanStore.savePlan(eventId, { version: 0, bosses: { "kara/attumen": { notes: "Tank links" } } }, { bossKeys: ["kara/attumen"], allowedUserIds: [], userId: "u1" });
    if (published) raidplanStore.setPublished(eventId, true, { userId: "u1" });
}

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    publicBaseUrl.mockReturnValue("https://eh.example");
    discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m1" });
    discord.editLink.mockResolvedValue({ channelId: "chan1", messageId: "m1" });
});

describe("services/raidplan/raidplanPost", () => {
    describe("linkMessage", () => {
        it("reads in English, with the start as a Discord timestamp", () => {
            expect(linkMessage({ url: "https://x/p/t", title: "Karazhan", startTime: 1800000000, message: " Bitte lesen " })).toEqual({
                url: "https://x/p/t", title: "Raid assignments – Karazhan", message: "Bitte lesen\nRaid start: <t:1800000000:F>",
                label: "Open assignments", emoji: "🗺️",
            });
        });

        it("does without title, start and message", () => {
            expect(linkMessage({ url: "u" })).toMatchObject({ title: "Raid assignments", message: "" });
        });
    });

    describe("eventHasPlan / planFilled", () => {
        it("an own event always has a plan, a Raid-Helper event once switched on", () => {
            expect(eventHasPlan(null, null)).toBe(false);
            expect(eventHasPlan(OWN, null)).toBe(true);
            expect(eventHasPlan(RH, null)).toBe(false);
            expect(eventHasPlan(RH, { link: { enabled: false } })).toBe(false);
            expect(eventHasPlan(RH, { link: { enabled: true } })).toBe(true);
        });

        it("a plan counts as filled once saved with a board", () => {
            expect(planFilled(null)).toBe(false);
            expect(planFilled({ version: 0, bosses: { a: {} } })).toBe(false);
            expect(planFilled({ version: 2, bosses: {} })).toBe(false);
            expect(planFilled({ version: 2, bosses: { a: {} } })).toBe(true);
        });
    });

    describe("postRaidplanLink", () => {
        it("refuses a Raid-Helper event without a plan, an empty plan, a missing base url and a missing channel", async () => {
            expect((await postRaidplanLink({ event: RH })).error).toMatchObject({ status: 409, code: "no_plan" });
            expect((await postRaidplanLink({ event: OWN })).error).toMatchObject({ status: 400, code: "empty_plan" });
            savePlan("eh-1");
            publicBaseUrl.mockReturnValue("");
            expect((await postRaidplanLink({ event: OWN })).error).toMatchObject({ code: "no_public_url" });
            publicBaseUrl.mockReturnValue("https://eh.example");
            expect((await postRaidplanLink({ event: { ...OWN, channelId: "" } })).error).toMatchObject({ code: "no_channel" });
            expect(discord.postLink).not.toHaveBeenCalled();
            // nothing was published on the way
            expect(raidplanStore.getPlan("eh-1").status).toBe("draft");
        });

        it("publishes a draft plan, posts its read link and remembers the message", async () => {
            savePlan("eh-1");
            const r = await postRaidplanLink({ event: OWN, message: "Bitte lesen", userId: "u9" });
            const plan = raidplanStore.getPlan("eh-1");
            expect(plan.status).toBe("published");
            const url = `https://eh.example/p/${plan.publicToken}`;
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.objectContaining({ url, message: "Bitte lesen\nRaid start: <t:1800000000:F>" }));
            expect(r.body).toMatchObject({ updated: false, url, published: true });
            expect(r.body.message).toMatch(/gepostet.*freigegeben/);
            expect(getRaidplanPost("eh-1")).toMatchObject({ channelId: "chan1", messageId: "m1", message: "Bitte lesen", postedBy: "u9" });
        });

        it("edits the message it posted before, keeps the token and the last text", async () => {
            savePlan("eh-1", { published: true });
            const token = raidplanStore.getPlan("eh-1").publicToken;
            markRaidplanPosted("eh-1", { channelId: "chan1", messageId: "m1", message: "Alt" });
            const r = await postRaidplanLink({ event: OWN });
            expect(discord.editLink).toHaveBeenCalledWith("chan1", "m1", expect.objectContaining({ url: `https://eh.example/p/${token}`, message: expect.stringMatching(/^Alt\n/) }));
            expect(discord.postLink).not.toHaveBeenCalled();
            expect(r.body).toMatchObject({ updated: true, published: false, message: "Einteilungs-Nachricht aktualisiert." });
            expect(raidplanStore.getPlan("eh-1").publicToken).toBe(token);
        });

        it("posts afresh when the old message is gone, and clears the text on an empty message", async () => {
            savePlan("eh-1", { published: true });
            markRaidplanPosted("eh-1", { channelId: "chan1", messageId: "m1", message: "Alt" });
            discord.editLink.mockRejectedValue(new Error("Unknown Message"));
            discord.postLink.mockResolvedValue({ channelId: "chan1", messageId: "m2" });
            const r = await postRaidplanLink({ event: OWN, message: "" });
            expect(discord.postLink).toHaveBeenCalledWith("chan1", expect.objectContaining({ message: "Raid start: <t:1800000000:F>" }));
            expect(r.body.updated).toBe(false);
            expect(getRaidplanPost("eh-1")).toMatchObject({ messageId: "m2", message: "" });
        });

        it("answers 500 with Discord's error", async () => {
            savePlan("eh-1", { published: true });
            discord.postLink.mockRejectedValue(new Error("Channel nicht gefunden."));
            expect((await postRaidplanLink({ event: OWN })).error).toEqual({ status: 500, code: "post_failed", message: "Channel nicht gefunden." });
            discord.postLink.mockRejectedValue(null);
            expect((await postRaidplanLink({ event: OWN })).error.message).toBe("Posten fehlgeschlagen.");
            expect(getRaidplanPost("eh-1")).toBeNull();
        });

        it("posts for a Raid-Helper event whose plan is switched on", async () => {
            raidplanStore.setLink("rh-1", { enabled: true, instanceIds: ["gruul"] }, { userId: "u1" });
            raidplanStore.savePlan("rh-1", { version: raidplanStore.getPlan("rh-1").version, bosses: { "gruul/gruul": { notes: "Kite" } } }, { bossKeys: ["gruul/gruul"], allowedUserIds: [], userId: "u1" });
            discord.postLink.mockResolvedValue({ channelId: "chan2", messageId: "m7" });
            const r = await postRaidplanLink({ event: RH });
            expect(r.body).toBeTruthy();
            expect(discord.postLink).toHaveBeenCalledWith("chan2", expect.objectContaining({ title: "Raid assignments – Gruul" }));
        });
    });

    describe("raidplanPostState", () => {
        it("is null without a plan", () => {
            expect(raidplanPostState(RH)).toBeNull();
            expect(raidplanPostState(null)).toBeNull();
        });

        it("says filled, published, the read path and where it was posted", () => {
            expect(raidplanPostState(OWN)).toEqual({ filled: false, published: false, publicPath: "", channelId: "", messageId: "", message: "", postedAt: 0 });
            savePlan("eh-1", { published: true });
            markRaidplanPosted("eh-1", { channelId: "chan1", messageId: "m1", message: "Hi", now: 5 });
            const token = raidplanStore.getPlan("eh-1").publicToken;
            expect(raidplanPostState(OWN)).toEqual({ filled: true, published: true, publicPath: `/p/${token}`, channelId: "chan1", messageId: "m1", message: "Hi", postedAt: 5 });
        });
    });
});
