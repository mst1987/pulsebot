// The read side of the orga's hint at signup (#983): who of a batch carries a
// warning or a shadowban on the raid's server, one line each, into the
// Orga-Zentrale or the orga channel - never free text or an author.
const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");

const mockVisible = new Set();
const mockChannelGuild = new Map();
jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(async () => ({ id: "m1" })),
    channelVisible: jest.fn((id) => mockVisible.has(id)),
    getClient: () => ({ channels: { cache: { get: (id) => (mockChannelGuild.has(id) ? { guildId: mockChannelGuild.get(id) } : undefined) } } }),
}));
let mockHub = null;
jest.mock("../../../src/stores/discord/orgaHubStore", () => ({
    getHub: jest.fn(() => mockHub),
}));

const discord = require("../../../src/services/discord/discord");
const notes = require("../../../src/stores/roster/userNotesStore");
const queue = require("../../../src/services/vermerke/orgaSignupQueue");
const notice = require("../../../src/services/vermerke/orgaSignupNotice");

const U = "111111111111111111";
const V = "222222222222222222";
const W = "333333333333333333";
const HUB = "900000000000000001";
const ORGA = "900000000000000002";
const OWN = "900000000000000003";
const BASE = "https://eh.example";
const by = { by: "9", byName: "AUTOR-NAME", now: 1000 };
const item = (userId, extra = {}) => ({ eventId: "e1", categoryId: "c1", title: "Karazhan", startTime: 1800000000, userId, name: "Zed", ...extra });
const config = (level = "warning", extra = {}) => ({
    serverSettings: { A: { vermerkeOrgaNotice: { enabled: true, level }, signupNoteChannelId: ORGA }, B: { vermerkeOrgaNotice: { enabled: true } } },
    ...extra,
});
const postedText = () => discord.postPayload.mock.calls.map(([, payload]) => JSON.stringify(payload)).join("\n");

beforeEach(() => {
    const file = tempStoreFile("user-notes.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    notes.useFile(file);
    discord.postPayload.mockClear();
    discord.postPayload.mockImplementation(async () => ({ id: "m1" }));
    mockVisible.clear();
    mockVisible.add(HUB).add(ORGA).add(OWN);
    mockHub = null;
    mockChannelGuild.clear();
});
afterAll(() => notes.useFile(null));

describe("services/vermerke/orgaSignupNotice", () => {
    it("writes a line with name, raid, level and reasons with counts - no text, no author", () => {
        notes.addEntry("A", U, { level: "warning", reason: "no_show", text: "GEHEIM" }, by);
        const line = notice.buildNoticeLine(item(U), { level: "warning", reasons: { no_show: 3, behavior: 1 } }, { base: BASE });
        expect(line).toBe(`<@${U}> (Zed) · **Karazhan** <t:1800000000:f> · Warnung · Nicht erschienen ×3 · Verhalten · [Vermerke](${BASE}/vermerke?user=${U})`);
        // a name or title cannot format or ping
        const odd = notice.buildNoticeLine(item(U, { name: "@everyone *x*", title: "", startTime: 0 }), { level: "shadowban", reasons: {} }, { base: "" });
        expect(odd).toBe(`<@${U}> (@\u200beveryone \\*x\\*) · **Raid** · Shadowban`);
    });

    it("counts by the server's switch: from warning, or shadowban only", () => {
        expect(notice.levelCounts("hint", "warning")).toBe(false);
        expect(notice.levelCounts("warning", "warning")).toBe(true);
        expect(notice.levelCounts("shadowban", "warning")).toBe(true);
        expect(notice.levelCounts("warning", "shadowban")).toBe(false);
        expect(notice.levelCounts("shadowban", "shadowban")).toBe(true);
    });

    it("posts one card with the people who carry a Vermerk, into the orga channel", async () => {
        notes.addEntry("A", U, { level: "warning", reason: "no_show", text: "GEHEIM" }, by);
        notes.addEntry("A", U, { level: "hint", reason: "no_show" }, by);
        notes.addEntry("A", V, { level: "hint", reason: "loot" }, by);
        const res = await notice.postBatch("A", [item(U), item(V), item(W)], { config: config(), base: BASE });
        expect(res).toEqual({ posted: 1, lines: 1, noChannel: 0 });
        expect(discord.postPayload).toHaveBeenCalledTimes(1);
        const [channelId, payload, opts] = discord.postPayload.mock.calls[0];
        expect(channelId).toBe(ORGA);
        expect(opts).toEqual({ guildId: "A" });
        const text = JSON.stringify(payload);
        expect(text).toContain("Anmeldung mit Vermerk");
        expect(text).toContain("Nicht erschienen ×2");
        expect(text).toContain(`/vermerke?user=${U}`);
        expect(text).not.toMatch(/GEHEIM|AUTOR-NAME/);
        expect(text).not.toContain(V);
    });

    it("with the switch on shadowban only, leaves out warnings", async () => {
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        notes.addEntry("A", V, { level: "shadowban", reason: "behavior" }, by);
        const res = await notice.postBatch("A", [item(U), item(V)], { config: config("shadowban"), base: BASE });
        expect(res.lines).toBe(1);
        expect(postedText()).toContain(V);
        expect(postedText()).not.toContain(`<@${U}>`);
    });

    it("re-reads the switch: switched off in the meantime posts nothing", async () => {
        notes.addEntry("A", U, { level: "shadowban", reason: "behavior" }, by);
        const res = await notice.postBatch("A", [item(U)], { config: {}, base: BASE });
        expect(res).toEqual({ posted: 0, lines: 0 });
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("counts the Vermerke of the raid's server only (own and shared)", async () => {
        notes.addEntry("B", U, { level: "shadowban", reason: "behavior" }, by);
        notes.addEntry("B", V, { level: "warning", reason: "loot", shared: true }, by);
        const res = await notice.postBatch("A", [item(U), item(V)], { config: config(), base: BASE });
        expect(res.lines).toBe(1);
        expect(postedText()).toContain(`<@${V}>`);
        expect(postedText()).not.toContain(`<@${U}>`);
    });

    it("prefers the Orga-Zentrale of the category, but only on the raid's server and when reachable", async () => {
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        mockHub = { categoryId: "c1", guildId: "A", channelId: HUB };
        await notice.postBatch("A", [item(U)], { config: config(), base: BASE });
        expect(discord.postPayload.mock.calls[0][0]).toBe(HUB);

        discord.postPayload.mockClear();
        mockHub = { categoryId: "c1", guildId: "B", channelId: HUB };
        await notice.postBatch("A", [item(U)], { config: config(), base: BASE });
        expect(discord.postPayload.mock.calls[0][0]).toBe(ORGA);

        discord.postPayload.mockClear();
        mockHub = { categoryId: "c1", guildId: "A", channelId: HUB };
        mockVisible.delete(HUB);
        await notice.postBatch("A", [item(U)], { config: config("warning", { categorySignupNoteChannel: { c1: OWN } }), base: BASE });
        expect(discord.postPayload.mock.calls[0][0]).toBe(OWN);
    });

    it("falls back to the server's channel when the category's own channel lives on another server", async () => {
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        mockChannelGuild.set(OWN, "B").set(ORGA, "A");
        const res = await notice.postBatch("A", [item(U)], { config: config("warning", { categorySignupNoteChannel: { c1: OWN } }), base: BASE });
        expect(res).toEqual({ posted: 1, lines: 1, noChannel: 0 });
        expect(discord.postPayload.mock.calls[0][0]).toBe(ORGA);
        // the server's default on another server as well: nowhere
        mockChannelGuild.set(ORGA, "B");
        expect(notice.channelFor("c1", "A", config("warning", { categorySignupNoteChannel: { c1: OWN } }))).toBe("");
    });

    it("only logs without a channel", async () => {
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        notes.addEntry("B", U, { level: "warning", reason: "behavior" }, by);
        const res = await notice.postBatch("B", [item(U)], { config: config(), base: BASE });
        expect(res).toEqual({ posted: 0, lines: 1, noChannel: 1 });
        expect(discord.postPayload).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining("kein Orga-Kanal"));
        log.mockRestore();
    });

    it("survives a failing post", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        discord.postPayload.mockImplementation(async () => { throw new Error("Missing Access"); });
        notes.addEntry("A", U, { level: "warning", reason: "behavior" }, by);
        await expect(notice.postBatch("A", [item(U)], { config: config(), base: BASE })).resolves.toEqual({ posted: 0, lines: 1, noChannel: 0 });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Missing Access"));
        warn.mockRestore();
    });

    it("splits a long list into several cards and names the count", () => {
        const line = "x".repeat(300);
        const posts = notice.buildNoticePosts(Array.from({ length: 30 }, () => line));
        expect(posts.length).toBeGreaterThan(1);
        expect(JSON.stringify(posts[0])).toMatch(/\d+ Anmeldungen mit Vermerk/);
        for (const post of posts) expect(JSON.stringify(post)).toContain("die Person sieht das nicht");
    });

    it("registers itself as the queue's handler and unregisters on stop", async () => {
        const spy = jest.spyOn(queue, "setFlushHandler");
        notice.startOrgaSignupNotice();
        expect(typeof spy.mock.calls[0][0]).toBe("function");
        await spy.mock.calls[0][0]("A", []);
        notice.stopOrgaSignupNotice();
        expect(spy).toHaveBeenLastCalledWith(null);
        spy.mockRestore();
    });
});
