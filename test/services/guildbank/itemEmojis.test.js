// The guild bank items' application emojis (#633): created when an item is
// offered ("give"), deleted when no bank offers it any more, shared per item
// id, the 2000 limit, failures, and the background queue. Discord's REST and
// the icon download are fakes.
jest.mock("../../../src/services/discord/discord", () => ({ getClient: jest.fn(() => null) }));

const discord = require("../../../src/services/discord/discord");
const store = require("../../../src/stores/guildBankStockStore");
const emojis = require("../../../src/services/guildbank/itemEmojis");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;

/** A bank with the items `[[itemId, icon, status]]` on server g1. */
function bank(items, { project = "tbc", guild = "Alpha" } = {}) {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project }, guild: { name: guild, realm: "Spineshatter" }, scannedAt: 1791000000,
        tabs: [{ index: 1, name: "A", items: items.map(([itemId]) => ({ itemId, count: 5 })) }],
    });
    const { bank: b } = store.recordScan(scan, { now: 1, guildId: "g1" });
    for (const [itemId, icon, status] of items) {
        store.setItemMeta(project, itemId, { name: `Item ${itemId}`, icon }, { source: "wowhead" });
        store.setItemSettings(b.key, itemId, { status });
    }
    return b.key;
}

/** A fake application: its emojis, and the REST calls on them. */
function fakeClient(existing = []) {
    const app = [...existing];
    let next = 100;
    const rest = {
        get: jest.fn(async () => ({ items: app.map((e) => ({ ...e })) })),
        post: jest.fn(async (_route, { body }) => {
            const e = { id: String(next++), name: body.name };
            app.push(e);
            return e;
        }),
        delete: jest.fn(async (route) => {
            const id = route.split("/").pop();
            const at = app.findIndex((e) => e.id === id);
            if (at < 0) throw Object.assign(new Error("Unknown Emoji"), { code: 10014 });
            app.splice(at, 1);
        }),
    };
    return { app, rest, client: { application: { id: "app1" }, rest } };
}

const okFetch = jest.fn(async () => ({
    ok: true,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
}));
const sync = (client, over = {}) => emojis.syncItemEmojis({ client, fetchImpl: okFetch, sleep: async () => {}, now: NOW, log: () => {}, ...over });

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const b of store.listBanks()) store.removeBank(b.key);
    for (const id of Object.keys(store.itemEmojis())) store.setItemEmoji(id, null);
    okFetch.mockClear();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
    console.warn.mockRestore();
    console.log.mockRestore();
    emojis._setRunnerForTests(null);
    jest.useRealTimers();
});

describe("services/guildbank/itemEmojis", () => {
    it("names an item's emoji gb_<id> and reads the id back", () => {
        expect(emojis.emojiName(22854)).toBe("gb_22854");
        expect(emojis.itemIdOfName("gb_22854")).toBe(22854);
        expect(emojis.itemIdOfName("eh_ui_date")).toBe(0);
    });

    it("does nothing while the bot is offline", async () => {
        expect(await emojis.syncItemEmojis({ client: null })).toMatchObject({ skipped: "offline" });
        expect(await emojis.syncItemEmojis()).toMatchObject({ skipped: "offline" });
        expect(discord.getClient).toHaveBeenCalled();
    });

    it("creates one emoji per offered item from its zamimg icon and remembers its id", async () => {
        bank([[22854, "inv_potion_1", "give"], [24027, "inv_gem", "show"], [13444, "inv_potion_2", "hide"]]);
        const { client, rest } = fakeClient();
        const result = await sync(client);
        expect(result).toMatchObject({ created: [22854], deleted: [], failed: [], full: [] });
        expect(okFetch).toHaveBeenCalledWith("https://wow.zamimg.com/images/wow/icons/large/inv_potion_1.jpg");
        expect(rest.post).toHaveBeenCalledWith("/applications/app1/emojis", { body: { name: "gb_22854", image: "data:image/jpeg;base64,AQID" } });
        expect(store.itemEmojis()).toEqual({ 22854: { id: "100", name: "gb_22854", icon: "inv_potion_1", createdAt: NOW } });
        // nothing to do the second time
        rest.post.mockClear();
        expect(await sync(client)).toMatchObject({ created: [], deleted: [] });
        expect(rest.post).not.toHaveBeenCalled();
    });

    it("shares one emoji across banks and deletes it only when no bank offers the item", async () => {
        const tbc = bank([[22854, "inv_potion_1", "give"]]);
        const forever = bank([[22854, "inv_potion_1", "give"]], { project: "forever" });
        const { client, rest, app } = fakeClient();
        await sync(client);
        expect(rest.post).toHaveBeenCalledTimes(1);
        store.setItemSettings(tbc, 22854, { status: "hide" });
        expect(await sync(client)).toMatchObject({ deleted: [] });
        store.setItemSettings(forever, 22854, { status: "show" });
        expect(await sync(client)).toMatchObject({ deleted: [22854] });
        expect(rest.delete).toHaveBeenCalledWith("/applications/app1/emojis/100");
        expect(app).toEqual([]);
        expect(store.itemEmojis()).toEqual({});
    });

    it("re-creates an emoji deleted by hand or whose icon changed, adopts a stray one, deletes strays nobody offers", async () => {
        const key = bank([[22854, "inv_potion_1", "give"], [24027, "inv_gem", "give"]]);
        store.setItemEmoji(22854, { id: "gone", name: "gb_22854", icon: "inv_potion_1" });
        const { client, rest } = fakeClient([{ id: "7", name: "gb_24027" }, { id: "8", name: "gb_999" }, { id: "9", name: "eh_ui_date" }]);
        const result = await sync(client);
        expect(result).toMatchObject({ adopted: [24027], deleted: [999], created: [22854] });
        expect(rest.delete).toHaveBeenCalledTimes(1);
        expect(store.itemEmojis()[24027]).toMatchObject({ id: "7", icon: "inv_gem" });
        // a new icon: the old emoji goes, a new one comes
        store.setItemMeta("tbc", 24027, { name: "Item 24027", icon: "inv_gem_2" }, { source: "wowhead" });
        expect(store.getBank(key).items.find((it) => it.itemId === 24027).icon).toBe("inv_gem_2");
        const again = await sync(client);
        expect(again.created).toEqual([24027]);
        expect(rest.delete).toHaveBeenCalledWith("/applications/app1/emojis/7");
        expect(store.itemEmojis()[24027].icon).toBe("inv_gem_2");
    });

    it("skips with a log line when the application already has 2000 emojis", async () => {
        bank([[22854, "inv_potion_1", "give"]]);
        const full = Array.from({ length: emojis.MAX_APP_EMOJIS }, (_, i) => ({ id: `x${i}`, name: `eh_x${i}` }));
        const { client, rest } = fakeClient(full);
        expect(await sync(client)).toMatchObject({ created: [], full: [22854] });
        expect(rest.post).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith("[warn]", expect.stringContaining("2000 Emojis"));
    });

    it("collects failures instead of throwing: a broken download, a refused create, a refused delete", async () => {
        const key = bank([[22854, "inv_potion_1", "give"], [24027, "inv_gem", "give"]]);
        const { client, rest } = fakeClient();
        const fetchImpl = jest.fn(async (url) => (url.includes("inv_gem") ? { ok: false, status: 404 } : okFetch(url)));
        rest.post.mockRejectedValueOnce(new Error("Rate limited"));
        const result = await sync(client, { fetchImpl });
        expect(result.failed.map((f) => f.itemId).sort()).toEqual([22854, 24027]);
        expect(store.itemEmojis()).toEqual({});
        // the next run makes them
        expect((await sync(client)).created.sort()).toEqual([22854, 24027]);
        store.setItemSettings(key, 22854, { status: "show" });
        rest.delete.mockRejectedValueOnce(new Error("Missing Access"));
        expect((await sync(client)).failed).toEqual([{ itemId: 22854, error: "Missing Access" }]);
        expect(store.itemEmojis()[22854]).toBeTruthy();
    });

    it("pauses between two Discord calls of one run", async () => {
        bank([[22854, "inv_potion_1", "give"], [24027, "inv_gem", "give"]]);
        const sleep = jest.fn(async () => {});
        await sync(fakeClient().client, { sleep });
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(emojis.PAUSE_MS);
    });

    describe("the queue", () => {
        it("debounces several requests into one run and never throws", async () => {
            jest.useFakeTimers();
            const runner = jest.fn(async () => ({ created: [], failed: [] }));
            emojis._setRunnerForTests(runner);
            emojis.queueItemEmojiSync();
            emojis.queueItemEmojiSync();
            await jest.advanceTimersByTimeAsync(emojis.DEBOUNCE_MS);
            expect(runner).toHaveBeenCalledTimes(1);

            runner.mockRejectedValueOnce(new Error("boom"));
            expect(await emojis.runQueued()).toEqual({ skipped: "error" });
        });

        it("runs again after a run that was asked for while it ran, and retries a failed run later", async () => {
            jest.useFakeTimers();
            let release;
            const runner = jest.fn()
                .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
                .mockResolvedValue({ failed: [{ itemId: 1, error: "x" }] });
            emojis._setRunnerForTests(runner);
            const first = emojis.runQueued();
            const second = emojis.runQueued();
            release({ created: [] });
            await first;
            await second;
            await jest.advanceTimersByTimeAsync(emojis.DEBOUNCE_MS);
            expect(runner).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(emojis.RETRY_MS + emojis.DEBOUNCE_MS);
            expect(runner).toHaveBeenCalledTimes(3);
        });
    });
});
