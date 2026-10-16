// The character page's Blizzard read (services/characters/charGear.js): summary
// and gear side by side, a found character kept for ten minutes.
const { loadCharGear, GEAR_CACHE_TTL_MS, GEAR_CACHE_MAX, _resetForTests } = require("../../../src/services/characters/charGear");

const BZ = { region: "eu", realmSlug: "thunderstrike", namespace: "profile-classicann-eu" };
const GEAR = [{ slot: "Head", itemId: 1 }];

/** A fake Blizzard client; `lastError` is written by each request like the real one. */
function fakeClient({ summary = { name: "Anna" }, gear = GEAR, gearError = null, summaryError = null, delayMs = 0 } = {}) {
    const client = { lastError: null };
    const settle = (value, error, resolve) => {
        client.lastError = value === null ? error : null;
        resolve(value);
    };
    const answer = (value, error) => new Promise((resolve) => (delayMs
        ? setTimeout(() => settle(value, error, resolve), delayMs)
        : settle(value, error, resolve)));
    client.getCharacterSummary = jest.fn(() => answer(summary, summaryError));
    client.getEquipment = jest.fn(() => answer(gear, gearError));
    return client;
}

beforeEach(() => _resetForTests());
afterEach(() => jest.useRealTimers());

describe("loadCharGear", () => {
    it("asks for summary and gear side by side, not one after the other", async () => {
        jest.useFakeTimers();
        const client = fakeClient({ delayMs: 1000 });
        const pending = loadCharGear({ ...BZ, client }, "Anna");
        // both requests are out before either answered
        expect(client.getCharacterSummary).toHaveBeenCalledTimes(1);
        expect(client.getEquipment).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1000);
        await expect(pending).resolves.toEqual({ charSummary: { name: "Anna" }, gear: GEAR, error: null });
    });

    it("reports the gear request's own error, even when the summary answers after it", async () => {
        jest.useFakeTimers();
        const client = { lastError: null };
        client.getEquipment = jest.fn(() => new Promise((r) => setTimeout(() => { client.lastError = { status: 404 }; r(null); }, 10)));
        client.getCharacterSummary = jest.fn(() => new Promise((r) => setTimeout(() => { client.lastError = null; r({ name: "Anna" }); }, 50)));
        const pending = loadCharGear({ ...BZ, client }, "Anna");
        await jest.advanceTimersByTimeAsync(50);
        await expect(pending).resolves.toEqual({ charSummary: { name: "Anna" }, gear: null, error: { status: 404 } });
    });

    it("keeps a found character for ten minutes, then asks again", async () => {
        const client = fakeClient();
        await loadCharGear({ ...BZ, client }, "Anna", 1_000);
        await loadCharGear({ ...BZ, client }, "anna ", 1_000 + GEAR_CACHE_TTL_MS - 1);
        expect(client.getEquipment).toHaveBeenCalledTimes(1);
        await loadCharGear({ ...BZ, client }, "Anna", 1_000 + GEAR_CACHE_TTL_MS);
        expect(client.getEquipment).toHaveBeenCalledTimes(2);
    });

    it("never keeps a failed answer", async () => {
        const client = fakeClient({ gear: null, gearError: { status: 500 } });
        const first = await loadCharGear({ ...BZ, client }, "Anna");
        expect(first.error).toEqual({ status: 500 });
        await loadCharGear({ ...BZ, client }, "Anna");
        expect(client.getEquipment).toHaveBeenCalledTimes(2);
    });

    it("an error without details still reads as an error", async () => {
        const client = fakeClient({ gear: null, gearError: null });
        expect((await loadCharGear({ ...BZ, client }, "Anna")).error).toEqual({});
    });

    it("keeps the same name on another realm or namespace apart", async () => {
        const client = fakeClient();
        await loadCharGear({ ...BZ, client }, "Anna");
        await loadCharGear({ ...BZ, realmSlug: "spineshatter", client }, "Anna");
        await loadCharGear({ ...BZ, namespace: "profile-classic-eu", client }, "Anna");
        expect(client.getEquipment).toHaveBeenCalledTimes(3);
    });

    it("drops the oldest character once the cap is reached", async () => {
        const client = fakeClient();
        for (let i = 0; i <= GEAR_CACHE_MAX; i += 1) await loadCharGear({ ...BZ, client }, `Char${i}`);
        expect(client.getEquipment).toHaveBeenCalledTimes(GEAR_CACHE_MAX + 1);
        await loadCharGear({ ...BZ, client }, `Char${GEAR_CACHE_MAX}`); // newest: still kept
        expect(client.getEquipment).toHaveBeenCalledTimes(GEAR_CACHE_MAX + 1);
        await loadCharGear({ ...BZ, client }, "Char0"); // oldest: dropped
        expect(client.getEquipment).toHaveBeenCalledTimes(GEAR_CACHE_MAX + 2);
    });
});
