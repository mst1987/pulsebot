// src/web/appEmojiSync.js: the bot creates its missing app emojis on start and
// reads them into the cache. No call reaches Discord or zamimg — REST, fetch and
// the client are doubles.
const { ensureAppEmojis } = require("../../src/web/appEmojiSync");
const { appEmojiMap, resetAppEmojis, emojiCatalog } = require("../../src/web/appEmojis");

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
    return { rest, application: { id: "app", emojis: { fetch: fetchEmojis } }, fetchEmojis };
}

describe("web/appEmojiSync ensureAppEmojis", () => {
    beforeEach(() => {
        resetAppEmojis();
        okFetch.mockClear();
    });

    it("creates every missing catalogue emoji and loads them into the cache", async () => {
        const client = fakeClient(["eh_ui_tank"]);
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, log: () => {} });
        const total = emojiCatalog().length;
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

    it("does nothing without a ready application", async () => {
        const out = await ensureAppEmojis({}, { fetchImpl: okFetch, log: () => {} });
        expect(out).toEqual({ error: "Bot-Anwendung unbekannt" });
        expect(okFetch).not.toHaveBeenCalled();
    });
});
