// src/services/discord/appEmojiSync.js: the bot creates its missing app emojis on start and
// reads them into the cache. No call reaches Discord or zamimg — REST, fetch and
// the client are doubles.
const { ensureAppEmojis } = require("../../../src/services/discord/appEmojiSync");
const { appEmojiMap, resetAppEmojis, emojiCatalog, addonEmojiCatalog } = require("../../../src/services/discord/appEmojis");
const { makeClient } = require("../../helpers/discordClient");

const okFetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    headers: { get: () => "image/png" },
}));

function fakeClient(existing) {
    const stored = existing.map((name, i) => ({ id: String(i + 1), name }));
    const rest = {
        get: jest.fn(async () => ({ items: stored })),
        post: jest.fn(async (route, { body }) => {
            const e = { id: String(stored.length + 1), name: body.name };
            stored.push(e);
            return e;
        }),
    };
    const fetchEmojis = jest.fn(async () => stored.slice());
    return { ...makeClient({ rest, application: { id: "app", emojis: { fetch: fetchEmojis } } }), fetchEmojis };
}

describe("services/discord/appEmojiSync ensureAppEmojis", () => {
    beforeEach(() => {
        resetAppEmojis();
        okFetch.mockClear();
    });

    it("creates every missing catalogue emoji and loads them into the cache", async () => {
        const client = fakeClient(["eh_ui_tank"]);
        // the ~150 checked-in PNGs are not read here: a tiny stand-in keeps the test fast under load
        const readFile = jest.fn(async () => Buffer.from("89504e470d0a1a0a", "hex"));
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, readFile, log: () => {} });
        const total = emojiCatalog().length;
        expect(readFile).toHaveBeenCalledTimes(emojiCatalog().filter((e) => e.file && e.name !== "eh_ui_tank").length);
        expect(out.existing).toBe(1);
        expect(out.created).toHaveLength(total - 1);
        expect(client.rest.get).toHaveBeenCalledWith("/applications/app/emojis");
        expect(client.rest.post).toHaveBeenCalledTimes(total - 1);
        expect(Object.keys(appEmojiMap())).toHaveLength(total);
    });

    it("creates nothing when all exist and still fills the cache", async () => {
        const client = fakeClient(emojiCatalog().map((e) => e.name));
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, log: () => {} });
        expect(out.created).toEqual([]);
        expect(client.rest.post).not.toHaveBeenCalled();
        expect(okFetch).not.toHaveBeenCalled();
        expect(appEmojiMap().eh_ui_tank).toBeTruthy();
    });

    it("never throws when Discord refuses, and keeps the text fallback", async () => {
        const client = fakeClient([]);
        client.rest.get.mockRejectedValue(new Error("Missing Access"));
        client.fetchEmojis.mockRejectedValue(new Error("Missing Access"));
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, log: () => {} });
        expect(out).toEqual({ error: "Missing Access" });
        expect(appEmojiMap()).toEqual({});
        warn.mockRestore();
    });

    it("creates the emoji of a configured addon - with the whole catalogue or only the addon part", async () => {
        const addons = [{ id: "pulse-crafthelper", icon: "trade_blacksmithing" }];
        const all = fakeClient(emojiCatalog().map((e) => e.name));
        const out = await ensureAppEmojis(all, { addons, fetchImpl: okFetch, log: () => {} });
        expect(out.created).toEqual(["eh_addon_pulsecrafthelper"]);
        expect(okFetch).toHaveBeenCalledWith("https://wow.zamimg.com/images/wow/icons/medium/trade_blacksmithing.jpg");
        // the new emoji is read into the cache at once (force reload)
        expect(appEmojiMap().eh_addon_pulsecrafthelper).toBeTruthy();

        resetAppEmojis();
        const only = fakeClient([]);
        const part = await ensureAppEmojis(only, { catalog: addonEmojiCatalog(addons), fetchImpl: okFetch, log: () => {} });
        expect(part.created).toEqual(addonEmojiCatalog(addons).map((e) => e.name));
        expect(part.created).toContain("eh_addon_pulsecrafthelper");
        expect(part.created.every((n) => n.startsWith("eh_addon_"))).toBe(true);
    });

    it("reads the cache afresh when Discord has an emoji the cache does not know (a lost create answer)", async () => {
        const catalog = addonEmojiCatalog([{ id: "pulse-crafthelper", icon: "trade_blacksmithing" }]);
        const client = fakeClient(catalog.map((e) => e.name));
        // the cache was read before, without the addon emoji
        client.fetchEmojis.mockResolvedValueOnce([{ id: "1", name: "eh_ui_tank" }]);
        await ensureAppEmojis(client, { catalog: [], fetchImpl: okFetch, log: () => {} });
        expect(appEmojiMap().eh_addon_pulsecrafthelper).toBeUndefined();

        const out = await ensureAppEmojis(client, { catalog, fetchImpl: okFetch, log: () => {} });
        expect(out.created).toEqual([]);
        expect(client.fetchEmojis).toHaveBeenCalledTimes(2);
        expect(appEmojiMap().eh_addon_pulsecrafthelper).toBeTruthy();
    });

    it("leaves a cache that knows every catalogue emoji alone", async () => {
        const catalog = addonEmojiCatalog([{ id: "pulse-crafthelper", icon: "trade_blacksmithing" }]);
        const client = fakeClient(catalog.map((e) => e.name));
        await ensureAppEmojis(client, { catalog, fetchImpl: okFetch, log: () => {} });
        await ensureAppEmojis(client, { catalog, fetchImpl: okFetch, log: () => {} });
        expect(client.fetchEmojis).toHaveBeenCalledTimes(1);
    });

    it("only logs a failed icon download", async () => {
        const client = fakeClient([]);
        const badFetch = jest.fn(async () => ({ ok: false, status: 404 }));
        const lines = [];
        const catalog = addonEmojiCatalog([{ id: "pulse-crafthelper", icon: "trade_blacksmithing" }]).slice(0, 1);
        const out = await ensureAppEmojis(client, { catalog, fetchImpl: badFetch, log: (m) => lines.push(m) });
        expect(out.failed).toEqual([{ name: "eh_addon_pulsecrafthelper", error: "HTTP 404" }]);
        expect(lines.some((l) => l.includes("FEHLER eh_addon_pulsecrafthelper"))).toBe(true);
    });

    it("does nothing without a ready application", async () => {
        const out = await ensureAppEmojis({}, { fetchImpl: okFetch, log: () => {} });
        expect(out).toEqual({ error: "Bot-Anwendung unbekannt" });
        expect(okFetch).not.toHaveBeenCalled();
    });
});
