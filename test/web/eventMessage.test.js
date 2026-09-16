jest.mock("../../src/web/eventStore", () => ({ getEvent: jest.fn(), setEventMessage: jest.fn() }));
const mockListeners = [];
jest.mock("../../src/web/signupStore", () => ({
    listSignups: jest.fn(() => []),
    onSignupsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
jest.mock("../../src/web/discord", () => ({ getClient: jest.fn() }));

const { getEvent, setEventMessage } = require("../../src/web/eventStore");
const { listSignups } = require("../../src/web/signupStore");
const discord = require("../../src/web/discord");
const {
    buildEventMessage, rosterCounts, signupButtonId, postEventMessage, refreshEventMessage, startEventMessageSync,
} = require("../../src/web/eventMessage");

const event = (over = {}) => ({
    id: "eh-1", title: "Kara Donnerstag", description: "Treffpunkt Eingang", leaderId: "7", channelId: "c1",
    startTime: 2000000000, size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, signupDeadline: 0, message: null, ...over,
});
const signups = [
    { userId: "1", role: "tank", status: "signed" },
    { userId: "2", role: "healer", status: "late" },
    { userId: "3", role: "ranged", status: "signed" },
    { userId: "4", role: "melee", status: "tentative" },
    { userId: "5", role: "", status: "absence" },
];

function fakeDiscord({ fetchError } = {}) {
    const message = { id: "m1", edit: jest.fn() };
    const channel = {
        id: "c1",
        isTextBased: () => true,
        send: jest.fn(() => Promise.resolve({ id: "m-new" })),
        messages: { fetch: jest.fn(() => (fetchError ? Promise.reject(fetchError) : Promise.resolve(message))) },
    };
    discord.getClient.mockReturnValue({ channels: { fetch: jest.fn(() => Promise.resolve(channel)) } });
    return { channel, message };
}

describe("web/eventMessage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        listSignups.mockReturnValue(signups);
    });

    it("counts who comes per role and who said otherwise", () => {
        expect(rosterCounts(signups)).toEqual({ tank: 1, healer: 1, dps: 1, attending: 3, tentative: 1, bench: 0, absence: 1 });
    });

    it("builds an embed with the role counts against the plan and the signup button", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), signups);
        const embed = payload.embeds[0].toJSON();
        expect(embed.title).toBe("Kara Donnerstag");
        expect(embed.description).toContain("<t:2000000000:F>");
        expect(embed.description).toContain("<@7>");
        expect(embed.fields.slice(0, 3)).toEqual([
            { name: "🛡️ Tanks", value: "1 / 2", inline: true },
            { name: "💚 Heiler", value: "1 / 3", inline: true },
            { name: "⚔️ DD", value: "1 / 5", inline: true },
        ]);
        expect(embed.fields[3]).toMatchObject({ name: "Anmeldeschluss", value: "<t:1999990000:F>" });
        expect(embed.footer.text).toBe("3 / 10 angemeldet · 1 vorläufig · 1 abgemeldet");
        const button = payload.components[0].toJSON().components[0];
        expect(button).toMatchObject({ custom_id: "event-signup:eh-1", label: "Anmelden" });
        expect(signupButtonId("x")).toBe("event-signup:x");
    });

    it("posts the message and remembers where it sits", async () => {
        getEvent.mockReturnValue(event());
        const { channel } = fakeDiscord();
        await expect(postEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m-new" });
        expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }));
        expect(setEventMessage).toHaveBeenCalledWith("eh-1", { channelId: "c1", messageId: "m-new" });
    });

    it("fails clearly without a bot connection", async () => {
        getEvent.mockReturnValue(event());
        discord.getClient.mockReturnValue(null);
        await expect(postEventMessage("eh-1")).rejects.toThrow("Bot nicht verbunden.");
        getEvent.mockReturnValue(null);
        await expect(postEventMessage("eh-x")).rejects.toThrow("Event nicht gefunden.");
    });

    it("edits the existing message, and re-posts one that was deleted", async () => {
        getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1" } }));
        const { message, channel } = fakeDiscord();
        await expect(refreshEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m1", reposted: false });
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).not.toHaveBeenCalled();

        const gone = Object.assign(new Error("Unknown Message"), { code: 10008 });
        const second = fakeDiscord({ fetchError: gone });
        await expect(refreshEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m-new", reposted: true });
        expect(second.channel.send).toHaveBeenCalledTimes(1);

        fakeDiscord({ fetchError: new Error("Missing Access") });
        await expect(refreshEventMessage("eh-1")).rejects.toThrow("Missing Access");
        getEvent.mockReturnValue(null);
        await expect(refreshEventMessage("eh-x")).resolves.toBeNull();
    });

    it("edits the message once per burst of roster changes", async () => {
        jest.useFakeTimers();
        try {
            getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1" } }));
            const { message } = fakeDiscord();
            const stop = startEventMessageSync({ debounceMs: 1000 });
            expect(startEventMessageSync()).toBe(stop); // idempotent
            mockListeners.forEach((fn) => { fn("eh-1"); fn("eh-1"); });
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            await new Promise(jest.requireActual("timers").setImmediate);
            expect(message.edit).toHaveBeenCalledTimes(1);
            stop();
            expect(mockListeners).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
