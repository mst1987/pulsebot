const mockGetConfig = jest.fn();
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: mockGetConfig }));

const MockRaidhelper = jest.fn().mockImplementation((opts) => ({
    opts,
    getAllEvents: jest.fn(async () => [{ id: `ev-${opts.serverId}` }]),
    getEvent: jest.fn(async (id) => (String(id).endsWith(opts.serverId) ? { id } : {})),
    createEvent: jest.fn(async (data) => ({ created: opts.serverId, data })),
}));
jest.mock("../../../src/classes/raidhelper", () => MockRaidhelper);

const { tempStoreFile } = require("../../helpers/tempStore");
const eventsStore = require("../../../src/stores/events/raidhelperEventsStore");
const {
    createRaidhelperClient, raidhelperDisabled, setAfterWrite, NOT_SYNCED, DISABLED_MESSAGE,
} = require("../../../src/utils/raidhelper/client");

const A = "111111111111111111";
const B = "222222222222222222";
const block = (raidhelper) => ({ raidhelper: { enabled: true, apiKey: "fake-key-for-tests", ...raidhelper } });
const servers = (...ids) => ({ servers: ids.map((guildId) => ({ guildId })) });

beforeEach(() => eventsStore.useFile(tempStoreFile("raidhelper-events.json")));
afterAll(() => eventsStore.useFile(null));

describe("utils/raidhelper/client", () => {
    afterEach(() => {
        jest.clearAllMocks();
        setAfterWrite(null);
    });

    describe("one server (#927)", () => {
        beforeEach(() => mockGetConfig.mockReturnValue({ discordServers: servers(A, B), serverSettings: { [A]: block() } }));

        it("asks Raid-Helper by the guild's own id, with the server's key and budget", () => {
            const client = createRaidhelperClient({ guildId: A });
            expect(client.opts.serverId).toBe(A);
            expect(client.opts.apiKey).toBe("fake-key-for-tests");
            expect(client.opts.budget.guildId).toBe(A);
        });

        it("takes the stored Raid-Helper server id over the guild id", () => {
            mockGetConfig.mockReturnValue({ discordServers: servers(A), serverSettings: { [A]: block({ serverId: "333333333333333333" }) } });
            expect(createRaidhelperClient({ guildId: A }).opts.serverId).toBe("333333333333333333");
        });

        it("gives a server without Raid-Helper a client that asks nothing", async () => {
            const client = createRaidhelperClient({ guildId: B });
            expect(client.disabled).toBe(true);
            expect(await client.getAllEvents()).toEqual([]);
            expect(await client.getEvent("x")).toEqual({});
            await expect(client.createEvent({})).rejects.toThrow(DISABLED_MESSAGE);
            await expect(client.signUp("x")).rejects.toMatchObject({ code: "raidhelper_disabled" });
            expect(MockRaidhelper).not.toHaveBeenCalled();
        });

        it("treats a switched-on server without a key as off", () => {
            mockGetConfig.mockReturnValue({ discordServers: servers(A), serverSettings: { [A]: block({ apiKey: "" }) } });
            expect(createRaidhelperClient({ guildId: A }).disabled).toBe(true);
            expect(raidhelperDisabled(undefined, A)).toBe(true);
            expect(raidhelperDisabled()).toBe(true);
        });

        it("says per server whether Raid-Helper is off", () => {
            expect(raidhelperDisabled(undefined, A)).toBe(false);
            expect(raidhelperDisabled(undefined, B)).toBe(true);
            expect(raidhelperDisabled()).toBe(false);
        });

        it("answers with the only active server when no server is named, and refuses a new event for another", async () => {
            const client = createRaidhelperClient();
            expect(client.opts.serverId).toBe(A);
            await expect(client.createEvent({ guildId: B, title: "x" })).rejects.toThrow(DISABLED_MESSAGE);
            await expect(client.createEvent({ guildId: A, title: "x" })).resolves.toMatchObject({ created: A, data: { title: "x" } });
        });
    });

    it("hands out the switched-off client when no server has Raid-Helper", async () => {
        mockGetConfig.mockReturnValue({ discordServers: servers(A, B), raidhelperServerId: A });
        const client = createRaidhelperClient();
        expect(client.disabled).toBe(true);
        expect(await client.getAllEvents()).toEqual([]);
        expect(MockRaidhelper).not.toHaveBeenCalled();
    });

    describe("several servers", () => {
        beforeEach(() => mockGetConfig.mockReturnValue({
            discordServers: servers(A, B),
            serverSettings: { [A]: block(), [B]: block({ apiKey: "other-fake-key" }) },
        }));

        it("joins the lists of every server", async () => {
            const client = createRaidhelperClient();
            expect(client.servers).toEqual([A, B]);
            expect(await client.getAllEvents()).toEqual([{ id: `ev-${A}` }, { id: `ev-${B}` }]);
        });

        it("sends a call about one event to the server whose list holds it", async () => {
            eventsStore.saveSnapshot(B, { syncedAt: 1, since: 0, events: [{ id: "77", startTime: 1 }] });
            const client = createRaidhelperClient();
            await client.getEvent("77");
            const [first, second] = MockRaidhelper.mock.results.map((r) => r.value);
            expect(first.getEvent).not.toHaveBeenCalled();
            expect(second.getEvent).toHaveBeenCalledWith("77");
        });

        it("asks each server in turn for an event no list holds", async () => {
            const client = createRaidhelperClient();
            expect(await client.getEvent(`x${B}`)).toEqual({ id: `x${B}` });
            expect(await client.getEvent("nowhere")).toEqual({});
        });

        it("creates an event only on the server named", async () => {
            const client = createRaidhelperClient();
            await expect(client.createEvent({ guildId: B, title: "t" })).resolves.toMatchObject({ created: B });
            await expect(client.createEvent({ title: "t" })).rejects.toThrow(DISABLED_MESSAGE);
        });

        it("fails a list read only when every server failed", async () => {
            const client = createRaidhelperClient();
            const [first, second] = MockRaidhelper.mock.results.map((r) => r.value);
            first.getAllEvents.mockRejectedValueOnce(new Error("429"));
            expect(await client.getAllEvents()).toEqual([{ id: `ev-${B}` }]);
            first.getAllEvents.mockRejectedValueOnce(new Error("429"));
            second.getAllEvents.mockRejectedValueOnce(new Error("down"));
            await expect(client.getAllEvents()).rejects.toThrow("429");
        });
    });

    // #608: the pages read the synced list, only the sync job asks Raid-Helper
    describe("the synced event list", () => {
        beforeEach(() => mockGetConfig.mockReturnValue({ discordServers: servers(A), serverSettings: { [A]: block() } }));

        it("hands out a client that reads the list from the store by default", () => {
            const { opts } = createRaidhelperClient({ guildId: A });
            expect(typeof opts.snapshot).toBe("function");
            expect(opts.cacheMs).toBeGreaterThan(0);
        });

        it("hands the sync job a live client", () => {
            expect(createRaidhelperClient({ live: true, guildId: A }).opts.snapshot).toBeNull();
        });

        it("answers the server's events from the given start on, ascending", () => {
            eventsStore.saveSnapshot(A, {
                syncedAt: 1000, since: 0,
                events: [{ id: "b", startTime: 300 }, { id: "old", startTime: 50 }, { id: "a", startTime: 200 }],
            });
            eventsStore.saveSnapshot(B, { syncedAt: 1000, since: 0, events: [{ id: "other", startTime: 250 }] });
            const { snapshot } = createRaidhelperClient({ guildId: A }).opts;
            expect(snapshot(100).map((e) => e.id)).toEqual(["a", "b"]);
        });

        it("says so before the first sync, with the last error once there is one", () => {
            const { snapshot } = createRaidhelperClient({ guildId: A }).opts;
            expect(() => snapshot(0)).toThrow(NOT_SYNCED);
            eventsStore.saveSyncError(A, "Raid-Helper: Rate limit encountered", 5);
            expect(() => snapshot(0)).toThrow(/Letzter Fehler: Raid-Helper: Rate limit/);
        });

        it("runs the registered hook with the server after a write, and nothing without one", () => {
            const hook = jest.fn();
            setAfterWrite(hook);
            createRaidhelperClient({ guildId: A }).opts.onWrite();
            expect(hook).toHaveBeenCalledWith(A);
            setAfterWrite(null);
            expect(() => createRaidhelperClient({ guildId: A }).opts.onWrite()).not.toThrow();
        });
    });
});
