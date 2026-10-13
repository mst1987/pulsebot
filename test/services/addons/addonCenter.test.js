// The addon download centre's posting, redraw and version job (src/services/addons/addonCenter.js),
// with Discord and the release cache mocked; the centre's store is real.
const mockLog = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
let mockReleases = {};
let mockOnline = true;
let mockChannels = {};
const mockSend = jest.fn();
const mockFetchMessage = jest.fn();

jest.mock("../../../src/logger", () => ({ ...mockLog, child: () => mockLog }));
jest.mock("../../../src/services/discord/discord", () => ({
    getClient: () => ({ channels: { cache: { get: (id) => mockChannels[id] || null } } }),
    isOnline: () => mockOnline,
    postPayload: jest.fn(),
    editPayload: jest.fn(),
    deleteMessage: jest.fn(async () => true),
    fetchTextChannel: jest.fn(async (id) => ({ id, guildId: "g1", send: mockSend, messages: { fetch: mockFetchMessage } })),
}));
jest.mock("../../../src/services/addons/addonReleases", () => ({
    ...jest.requireActual("../../../src/services/addons/addonReleases"),
    releaseFor: jest.fn(async (addon) => mockReleases[addon.id] || { state: "no_release", release: null }),
}));
jest.mock("../../../src/services/discord/appEmojis", () => ({ ...jest.requireActual("../../../src/services/discord/appEmojis"), appEmojiMap: () => ({}) }));

const { defaultAddons } = require("../../../src/services/addons/addonConfig");
let mockConfig = {};
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));

const discord = require("../../../src/services/discord/discord");
const store = require("../../../src/stores/addonCenterStore");
const center = require("../../../src/services/addons/addonCenter");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = Date.UTC(2026, 9, 14, 7, 41, 0);
const CH = "100000000000000001";
const ROLE = "200000000000000002";

const ok = (version, over = {}) => ({
    state: "ok",
    release: { version, tag: `v${version}`, publishedAt: "2026-10-14T07:00:00Z", notes: "- Neu", assets: [{ id: 7, name: `File-${version}.zip`, size: 100 }], ...over },
});
const posted = (messageId = "m1") => ({ guildId: "g1", channelId: CH, messageId, url: `https://discord.com/channels/g1/${CH}/${messageId}` });
const unknownMessage = () => Object.assign(new Error("Unknown Message"), { code: 10008 });

/** The addon files are matched by pattern: give each default addon one fitting file. */
function releaseOf(id, version) {
    const addon = defaultAddons().find((a) => a.id === id);
    const name = addon.assets[0].replace("*", version);
    return ok(version, { assets: [{ id: 7, name, size: 100 }] });
}

beforeAll(() => store.useFile(tempStoreFile("addon-center.json")));
afterAll(() => store.useFile(null));
let file;
beforeEach(() => {
    jest.clearAllMocks();
    file = tempStoreFile("addon-center.json");
    store.useFile(file);
    mockConfig = { addonDownloads: defaultAddons(), mainVersion: "forever", botLanguage: "de" };
    mockOnline = true;
    mockChannels = { [CH]: { id: CH, parentId: "cat-forever", isThread: () => false } };
    mockReleases = { levelhelper: releaseOf("levelhelper", "0.3.0"), professionkit: releaseOf("professionkit", "0.2.0") };
    discord.postPayload.mockResolvedValue(posted());
    discord.editPayload.mockResolvedValue(posted());
    mockSend.mockResolvedValue({ id: "u1" });
    mockFetchMessage.mockResolvedValue({ id: "m1" });
    store.setSettings({ channelId: CH, roleId: ROLE, announce: true });
});

describe("addonCenter compareVersions", () => {
    it("compares the numeric parts in turn", () => {
        expect(center.compareVersions("0.10.0", "0.9.9")).toBe(1);
        expect(center.compareVersions("v1.2", "1.2.0")).toBe(0);
        expect(center.compareVersions("1.2.0", "1.3")).toBe(-1);
        expect(center.compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    });
});

describe("addonCenter channelVersion", () => {
    it("reads the version of the channel's category, a hidden one falls back to the main version", () => {
        mockConfig.categoryVersion = { "cat-tbc": "tbc" };
        mockChannels.x = { id: "x", parentId: "cat-tbc", isThread: () => false };
        expect(center.channelVersion("x", mockConfig)).toBe("tbc");
        expect(center.channelVersion(CH, mockConfig)).toBe("forever");
        expect(center.channelVersion("x", { ...mockConfig, hideOtherVersions: true })).toBe("forever");
    });
});

describe("addonCenter game version setting", () => {
    it("a picked version wins over the category; empty, unknown or hidden falls back to the category", () => {
        mockConfig.categoryVersion = { "cat-tbc": "tbc" };
        mockChannels.x = { id: "x", parentId: "cat-tbc", isThread: () => false };
        expect(center.channelVersion("x", mockConfig)).toBe("tbc");
        store.setSettings({ versionId: "forever" });
        expect(center.channelVersion("x", mockConfig)).toBe("forever");
        store.setSettings({ versionId: "classic" });
        expect(center.channelVersion(CH, mockConfig)).toBe("classic");
        // a hidden version (only the main one is shown) falls back
        expect(center.channelVersion("x", { ...mockConfig, hideOtherVersions: true })).toBe("forever");
        store.setSettings({ versionId: "" });
        expect(center.channelVersion("x", mockConfig)).toBe("tbc");
    });

    it("names the version in the empty state", async () => {
        store.setSettings({ versionId: "classic" });
        const built = await center.currentPayload({ channelId: CH, config: mockConfig, now: NOW });
        expect(built.versionId).toBe("classic");
        expect(JSON.stringify(built.payload)).toContain("Für Classic Era gibt es hier keine Addons.");
    });

    it("a changed version redraws a posted centre and only remembers the versions of the addons now shown", async () => {
        const tbcAddon = { ...defaultAddons()[0], id: "tbcaddon", name: "TbcAddon", versions: ["tbc"], assets: ["Tbc-*.zip"] };
        mockConfig.addonDownloads = [...defaultAddons(), tbcAddon];
        mockReleases.tbcaddon = ok("1.0.0", { assets: [{ id: 9, name: "Tbc-1.0.0.zip", size: 1 }] });
        await center.postCenter({ now: NOW });
        expect(store.getSeen().tbcaddon).toBeUndefined();
        const res = await center.saveSettings({ versionId: "tbc" }, { config: mockConfig, now: NOW });
        expect(res.settings.versionId).toBe("tbc");
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(discord.editPayload.mock.calls[0][2])).toContain("addonhub:dl:tbcaddon");
        expect(store.getSeen().tbcaddon).toEqual({ version: "1.0.0", previous: "", newSince: 0, notifiedAt: 0 });
        expect(mockSend).not.toHaveBeenCalled();
        // the same setting again changes nothing
        discord.editPayload.mockClear();
        await center.saveSettings({ versionId: "tbc" }, { config: mockConfig, now: NOW });
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(await center.saveSettings({ versionId: "nope" })).toEqual({ error: "Ungültige Spielversion." });
    });

    it("the version check follows the picked version", async () => {
        await center.postCenter({ now: NOW });
        store.setSettings({ versionId: "classic" });
        expect(await center.checkVersions({ config: mockConfig, now: NOW })).toEqual({ remembered: [], updated: [], announced: [] });
    });
});

describe("addonCenter postCenter / removeCenter", () => {
    it("posts the centre with the channel's addons only (no orga-only, no other version) and remembers it", async () => {
        const res = await center.postCenter({ by: "1", now: NOW });
        expect(res.center).toMatchObject({ channelId: CH, messageId: "m1", postedBy: "1", postedAt: NOW, url: posted().url });
        const payload = discord.postPayload.mock.calls[0][1];
        const ids = JSON.stringify(payload).match(/addonhub:dl:[a-z-]+/g);
        expect(ids).toEqual(["addonhub:dl:levelhelper", "addonhub:dl:professionkit"]);
        expect(JSON.stringify(payload)).not.toContain("EventHelper Sync");
        // what it shows is known from now on: nothing of it is announced later
        expect(store.getSeen()).toEqual({
            levelhelper: { version: "0.3.0", previous: "", newSince: 0, notifiedAt: 0 },
            professionkit: { version: "0.2.0", previous: "", newSince: 0, notifiedAt: 0 },
        });
    });

    it("drops a disabled addon and one of another version", async () => {
        mockConfig.addonDownloads = defaultAddons().map((a) => (a.id === "levelhelper" ? { ...a, enabled: false } : a.id === "professionkit" ? { ...a, versions: ["tbc"] } : a));
        await center.postCenter({ now: NOW });
        expect(JSON.stringify(discord.postPayload.mock.calls[0][1])).not.toMatch(/addonhub:dl:(levelhelper|professionkit)/);
    });

    it("deletes the earlier message when posting again", async () => {
        await center.postCenter({ now: NOW });
        discord.postPayload.mockResolvedValue(posted("m2"));
        await center.postCenter({ now: NOW + 1 });
        expect(discord.deleteMessage).toHaveBeenCalledWith(CH, "m1");
        expect(store.getCenter().messageId).toBe("m2");
    });

    it("refuses without a channel, while offline, and when Discord refuses", async () => {
        store.setSettings({ channelId: "" });
        expect(await center.postCenter()).toEqual({ error: "Kein Kanal gewählt." });
        store.setSettings({ channelId: CH });
        mockOnline = false;
        expect((await center.postCenter()).error).toMatch(/nicht mit Discord verbunden/);
        mockOnline = true;
        discord.postPayload.mockRejectedValue(new Error("Missing Access"));
        expect((await center.postCenter()).error).toMatch(/Missing Access/);
        expect(store.getCenter()).toBeNull();
    });

    it("removes the centre and its message", async () => {
        await center.postCenter({ now: NOW });
        expect(await center.removeCenter()).toMatchObject({ messageId: "m1" });
        expect(discord.deleteMessage).toHaveBeenCalledWith(CH, "m1");
        expect(await center.removeCenter()).toBeNull();
    });
});

describe("addonCenter runCheck (the job)", () => {
    it("does nothing while no centre is posted or the bot is offline", async () => {
        expect(await center.runCheck({ now: NOW })).toEqual({ skipped: true });
        await center.postCenter({ now: NOW });
        mockOnline = false;
        expect(await center.runCheck({ now: NOW })).toEqual({ skipped: true });
        expect(discord.editPayload).not.toHaveBeenCalled();
    });

    it("first run without a known version: only remembers, posts nothing", async () => {
        store.setCenter({ guildId: "g1", channelId: CH, messageId: "m1", url: posted().url, hash: "old" }, { now: NOW });
        const res = await center.runCheck({ now: NOW });
        expect(res.remembered.sort()).toEqual(["levelhelper", "professionkit"]);
        expect(res.announced).toEqual([]);
        expect(mockSend).not.toHaveBeenCalled();
        expect(store.getCheckedAt()).toBe(NOW);
    });

    it("a new version: NEU in the centre (edited) and an update message pinging the role", async () => {
        await center.postCenter({ now: NOW });
        mockReleases.professionkit = releaseOf("professionkit", "0.3.0");
        const res = await center.runCheck({ now: NOW + 1000 });
        expect(res).toMatchObject({ updated: ["professionkit"], announced: ["professionkit"], center: "edited" });
        const update = mockSend.mock.calls[0][0];
        expect(update.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
        expect(update.components[0].content).toBe(`<@&${ROLE}>`);
        expect(JSON.stringify(update)).toContain("ProfessionKit 0.3.0 ist da");
        expect(JSON.stringify(update)).toContain("vorher 0.2.0");
        expect(JSON.stringify(update)).toContain(posted().url);
        expect(JSON.stringify(discord.editPayload.mock.calls[0][2])).toContain("### ProfessionKit `NEU`");
        expect(store.getSeen().professionkit).toEqual({ version: "0.3.0", previous: "0.2.0", newSince: NOW + 1000, notifiedAt: NOW + 1000 });
        expect(store.listUpdates()).toEqual([{ addonId: "professionkit", version: "0.3.0", guildId: "g1", channelId: CH, messageId: "u1", postedAt: NOW + 1000 }]);
        // the next check finds nothing new and leaves the message alone
        const again = await center.runCheck({ now: NOW + 2000 });
        expect(again).toMatchObject({ updated: [], center: "unchanged" });
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("with the switch off only the centre changes; without a role nobody is pinged", async () => {
        await center.postCenter({ now: NOW });
        store.setSettings({ announce: false });
        mockReleases.levelhelper = releaseOf("levelhelper", "0.4.0");
        const res = await center.runCheck({ now: NOW + 1 });
        expect(res).toMatchObject({ updated: ["levelhelper"], announced: [], center: "edited" });
        expect(mockSend).not.toHaveBeenCalled();

        store.setSettings({ announce: true, roleId: "" });
        mockReleases.levelhelper = releaseOf("levelhelper", "0.5.0");
        await center.runCheck({ now: NOW + 2 });
        expect(mockSend.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
        expect(JSON.stringify(mockSend.mock.calls[0][0])).not.toContain("<@&");
    });

    it("an older 'latest' is taken over quietly", async () => {
        await center.postCenter({ now: NOW });
        mockReleases.levelhelper = releaseOf("levelhelper", "0.2.9");
        const res = await center.runCheck({ now: NOW + 1 });
        expect(res.updated).toEqual([]);
        expect(store.getSeen().levelhelper).toMatchObject({ version: "0.2.9", newSince: 0 });
    });

    it("a failed update post is logged, the check goes on", async () => {
        await center.postCenter({ now: NOW });
        mockReleases.levelhelper = releaseOf("levelhelper", "0.4.0");
        mockSend.mockRejectedValue(new Error("Missing Permissions"));
        const res = await center.runCheck({ now: NOW + 1 });
        expect(res.announced).toEqual([]);
        expect(res.updated).toEqual(["levelhelper"]);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Missing Permissions"));
    });

    it("after a restart it goes on with the stored centre and versions", async () => {
        await center.postCenter({ now: NOW });
        // a new process: the store reads its file again, the centre and the versions come back from it
        store.useFile(null);
        store.useFile(file);
        expect(store.getCenter()).toMatchObject({ messageId: "m1" });
        mockReleases.professionkit = releaseOf("professionkit", "0.3.0");
        const res = await center.runCheck({ now: NOW + 5 });
        expect(res.announced).toEqual(["professionkit"]);
        expect(discord.editPayload).toHaveBeenCalledWith(CH, "m1", expect.any(Object));
    });

    it("a deleted centre is posted anew (edit refused, or found missing while unchanged)", async () => {
        await center.postCenter({ now: NOW });
        // unchanged content, but the message is gone (deleted while the bot was away)
        mockFetchMessage.mockRejectedValueOnce(unknownMessage());
        discord.editPayload.mockRejectedValueOnce(unknownMessage());
        discord.postPayload.mockResolvedValue(posted("m9"));
        expect(await center.refreshCenter({ now: NOW + 1 })).toBe("reposted");
        expect(store.getCenter()).toMatchObject({ messageId: "m9", url: posted("m9").url });
    });

    it("a redraw that fails is logged once and never throws", async () => {
        await center.postCenter({ now: NOW });
        discord.editPayload.mockRejectedValue(new Error("Missing Access"));
        expect(await center.refreshCenter({ force: true, now: NOW })).toBe("failed");
        expect(await center.refreshCenter({ force: true, now: NOW })).toBe("failed");
        expect(mockLog.warn).toHaveBeenCalledTimes(1);
        // unchanged and still there: nothing to do
        expect(await center.refreshCenter({ now: NOW })).toBe("unchanged");
        store.clearCenter();
        expect(await center.refreshCenter()).toBe("none");
    });
});

describe("addonCenter onCenterMessageDeleted", () => {
    it("forgets the fingerprint of the centre's message and redraws soon; other messages are none of its business", async () => {
        jest.useFakeTimers();
        try {
            await center.postCenter({ now: NOW });
            expect(center.onCenterMessageDeleted("other")).toBe(false);
            discord.editPayload.mockRejectedValueOnce(unknownMessage());
            discord.postPayload.mockResolvedValue(posted("m5"));
            expect(center.onCenterMessageDeleted("m1", { delayMs: 10 })).toBe(true);
            expect(store.getCenter().hash).toBe("");
            await jest.advanceTimersByTimeAsync(20);
            expect(store.getCenter().messageId).toBe("m5");
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("addonCenter saveSettings", () => {
    it("only saves while no centre is posted", async () => {
        const res = await center.saveSettings({ roleId: "" });
        expect(res).toEqual({ settings: { channelId: CH, roleId: "", announce: true, versionId: "" }, center: null });
        expect(discord.postPayload).not.toHaveBeenCalled();
        expect(await center.saveSettings({ channelId: "bad" })).toEqual({ error: "Ungültiger Kanal." });
    });

    it("another channel moves the centre: posted there, the old message deleted", async () => {
        await center.postCenter({ now: NOW });
        const other = "100000000000000009";
        discord.postPayload.mockResolvedValue({ guildId: "g1", channelId: other, messageId: "m7", url: "u" });
        const res = await center.saveSettings({ channelId: other }, { by: "1" });
        expect(discord.postPayload).toHaveBeenLastCalledWith(other, expect.any(Object));
        expect(discord.deleteMessage).toHaveBeenCalledWith(CH, "m1");
        expect(res.center).toMatchObject({ channelId: other, messageId: "m7" });
    });

    it("no channel any more takes the centre down; a failed move says why", async () => {
        await center.postCenter({ now: NOW });
        discord.postPayload.mockRejectedValue(new Error("Missing Access"));
        const failed = await center.saveSettings({ channelId: "100000000000000009" });
        expect(failed.error).toMatch(/Missing Access/);
        expect(failed.center).toMatchObject({ messageId: "m1" });
        const res = await center.saveSettings({ channelId: "" });
        expect(res.center).toBeNull();
        expect(store.getCenter()).toBeNull();
    });

    it("another role redraws the centre (the subscribe button comes and goes)", async () => {
        await center.postCenter({ now: NOW });
        await center.saveSettings({ roleId: "" });
        expect(JSON.stringify(discord.editPayload.mock.calls[0][2])).not.toContain("addonhub:sub");
    });
});

describe("addonCenter startAddonCenter", () => {
    it("checks after the first delay and then on every interval, until stopped", async () => {
        jest.useFakeTimers();
        try {
            await center.postCenter({ now: NOW });
            const stop = center.startAddonCenter({ firstDelayMs: 100, intervalMs: 1000 });
            expect(center.startAddonCenter()).toBe(stop);
            await jest.advanceTimersByTimeAsync(150);
            expect(store.getCheckedAt()).toBeGreaterThan(0);
            store.setCheckedAt(0);
            await jest.advanceTimersByTimeAsync(1000);
            expect(store.getCheckedAt()).toBeGreaterThan(0);
            center.stopAddonCenter();
            store.setCheckedAt(0);
            await jest.advanceTimersByTimeAsync(5000);
            expect(store.getCheckedAt()).toBe(0);
            center.stopAddonCenter();
        } finally {
            jest.useRealTimers();
        }
    });
});
