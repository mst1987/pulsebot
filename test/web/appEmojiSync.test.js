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
        delete: jest.fn(async (route) => {
            const id = String(route).split("/").pop();
            const idx = stored.findIndex((e) => e.id === id);
            if (idx !== -1) stored.splice(idx, 1);
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

    // "eh_hunter_survival" and "eh_priest_holy" are excluded here on purpose —
    // the RECREATE list below always deletes and recreates them, see the next test.
    it("creates nothing when all (other) emojis exist and still fills the cache", async () => {
        const names = emojiCatalog().map((e) => e.name).filter((n) => n !== "eh_hunter_survival" && n !== "eh_priest_holy");
        const client = fakeClient(names);
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, readFile: async () => Buffer.from("89504e470d0a1a0a", "hex"), log: () => {} });
        expect(out.created.sort()).toEqual(["eh_hunter_survival", "eh_priest_holy"]);
        expect(client.rest.delete).not.toHaveBeenCalled();
        expect(appEmojiMap().eh_ui_tank).toBeTruthy();
    });

    it("deletes and recreates the two known-stale spec icons even though they already exist (2bbb7a58)", async () => {
        const client = fakeClient(emojiCatalog().map((e) => e.name));
        const readFile = jest.fn(async () => Buffer.from("89504e470d0a1a0a", "hex"));
        const out = await ensureAppEmojis(client, { fetchImpl: okFetch, readFile, log: () => {} });
        expect(client.rest.delete).toHaveBeenCalledTimes(2);
        expect(out.created.sort()).toEqual(["eh_hunter_survival", "eh_priest_holy"]);
        expect(appEmojiMap().eh_hunter_survival).toBeTruthy();
        expect(appEmojiMap().eh_priest_holy).toBeTruthy();
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
