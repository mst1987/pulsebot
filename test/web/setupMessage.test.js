// Das freigegebene Setup im Event-Kanal und per DM (#290): Aufbau, Grenzen, Emoji-Fallback,
// Bearbeiten statt neu posten, nie ein Entwurf, DMs nur mit Schalter und einmal pro Platz,
// abgesagte Events.
const mockEvents = new Map();
const clone = (x) => JSON.parse(JSON.stringify(x));
jest.mock("../../src/web/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = patch ? { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return JSON.parse(JSON.stringify(e));
    }),
}));
let mockConfig = {};
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../src/web/discord", () => ({ getClient: jest.fn(), sendDirectMessage: jest.fn() }));
jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));
jest.mock("../../src/web/setupEditor", () => ({
    approvedSetupOf: (e) => (e && e.setup && e.setup.approved && Array.isArray(e.setup.approved.groups) ? e.setup.approved : null),
}));

const discord = require("../../src/web/discord");
const eventStore = require("../../src/web/eventStore");
const appEmojis = require("../../src/web/appEmojis");
const sm = require("../../src/web/setupMessage");

const emojis = Object.fromEntries(appEmojis.emojiCatalog().map((e, i) => [e.name, { id: String(1000 + i), name: e.name, animated: false }]));
const p = (userId, character, spec, role) => ({ userId, character, classId: spec.split("-")[0], spec, role });

function approved(version = 2) {
    return {
        version,
        approvedAt: 1700000000000,
        approvedBy: "orga",
        groups: [
            { index: 1, slots: [p("1", "Brokk", "Warrior-Protection", "tank"), p("2", "Zibbo", "Priest-Holy", "healer")] },
            { index: 2, slots: [p("3", "Nerathil", "Mage-Arcane", "ranged"), p("4", "Kael", "Rogue-Combat", "melee")] },
            { index: 3, slots: [] },
        ],
        bench: [p("5", "Thalia", "Priest-Shadow", "ranged")],
    };
}

function seed(over = {}) {
    const a = approved();
    const event = {
        id: "eh-1", guildId: "g1", categoryId: "cat1", channelId: "c1", channelName: "kara-do", title: "Kara Donnerstag",
        startTime: 2000000000, size: 10, status: "active", fairness: true,
        setup: {
            status: "approved", version: 2, options: { fairness: true },
            groups: a.groups, bench: [{ ...a.bench[0], reasons: ["Raid voll (10/10)", "Wunsch erfüllt: mit Kael"] }],
            approved: a,
        },
        setupPost: null,
        ...over,
    };
    mockEvents.set(event.id, event);
    return event;
}

function fakeChannel({ fetchError } = {}) {
    const message = { id: "m1", edit: jest.fn(() => Promise.resolve()) };
    const channel = {
        id: "c1",
        isTextBased: () => true,
        send: jest.fn(() => Promise.resolve({ id: "m-new" })),
        messages: { fetch: jest.fn(() => (fetchError ? Promise.reject(fetchError) : Promise.resolve(message))) },
    };
    discord.getClient.mockReturnValue({ channels: { fetch: jest.fn(() => Promise.resolve(channel)) } });
    return { channel, message };
}

beforeEach(() => {
    mockEvents.clear();
    mockConfig = {};
    jest.clearAllMocks();
    appEmojis.resetAppEmojis();
    sm._resetForTests();
});

describe("buildSetupMessage", () => {
    it("draws the groups as inline blocks with spec icons, the bench in one line, the role totals", () => {
        const event = seed();
        const msg = sm.buildSetupMessage(event, event.setup.approved, { emojis });
        const embed = msg.embeds[0];
        expect(embed.title).toBe("Setup · Kara Donnerstag");
        expect(embed.description).toContain("<t:2000000000:F>");
        // the flat role icons of the signup message, not the WoW ones (#320)
        expect(embed.description).toContain(`<:eh_ui_tank:${emojis.eh_ui_tank.id}> 1`);
        expect(embed.description).not.toContain("eh_role_");
        const g1 = embed.fields.find((f) => f.name === "Gruppe 1");
        expect(g1.inline).toBe(true);
        expect(g1.value).toBe(`<:eh_priest_holy:${emojis.eh_priest_holy.id}> **Zibbo**`.replace(/^/, `<:eh_warrior_protection:${emojis.eh_warrior_protection.id}> **Brokk**\n`));
        // an empty group is not drawn
        expect(embed.fields.some((f) => f.name === "Gruppe 3")).toBe(false);
        const bench = embed.fields.find((f) => f.name.includes("Bank"));
        expect(bench.name).toContain("(1)");
        expect(bench.inline).toBe(false);
        expect(bench.value).toContain("Thalia");
        expect(embed.fields.at(-1).value).toContain("https://eh.example/signups?event=eh-1");
        expect(embed.footer.text).toContain("Stand 2");
        // one button for the orga: "Invite callen" (inviteCallBot.js)
        expect(msg.components).toEqual([{
            type: 1,
            components: [{ type: 2, style: 2, custom_id: "invite-call:p:eh-1", label: "Invite callen", emoji: { name: "📣" } }],
        }]);
    });

    it("reads the same without app emojis (text fallbacks)", () => {
        const event = seed();
        const embed = sm.buildSetupMessage(event, event.setup.approved, { emojis: {} }).embeds[0];
        expect(embed.fields.find((f) => f.name === "Gruppe 1").value).toBe("**Brokk** · Schutz\n**Zibbo** · Heilig");
        expect(embed.description).toContain("Tank 1");
        expect(embed.fields.find((f) => f.name.includes("Bank")).name).toMatch(/^Bank \(\d+\)$/);
    });

    it("trägt dieselbe Farbe wie die Anmelde-Nachricht, aber kein Bild (#307)", () => {
        // eigene Farbe
        const own = seed({ color: "#ff8800", instanceIds: ["ssc"], image: { mode: "banner", url: "https://cdn.example/a.png" } });
        const embed = sm.buildSetupMessage(own, own.setup.approved, { emojis }).embeds[0];
        expect(embed.color).toBe(0xff8800);
        expect(embed.image).toBeUndefined();
        expect(embed.thumbnail).toBeUndefined();
        // ohne eigene: die der führenden Instanz — genau wie die Anmelde-Nachricht
        mockEvents.clear();
        const fromRules = seed({ instanceIds: ["ssc", "tk"] });
        expect(sm.buildSetupMessage(fromRules, fromRules.setup.approved, { emojis }).embeds[0].color).toBe(0x1f8ba5);
        // ohne alles: die Akzentfarbe des Mocks
        mockEvents.clear();
        const plain = seed();
        expect(sm.buildSetupMessage(plain, plain.setup.approved, { emojis }).embeds[0].color).toBe(7);
    });

    it("never builds anything without an approved lineup", () => {
        const event = seed();
        expect(sm.buildSetupMessage(event, null, { emojis })).toBeNull();
    });

    it("escapes names, so a character cannot ping or format", () => {
        const event = seed();
        const a = approved();
        a.groups[0].slots[0].character = "@everyone*x*";
        const value = sm.buildSetupMessage(event, a).embeds[0].fields[0].value;
        expect(value).toContain("@​everyone\\*x\\*");
    });

    it("stays within Discord's limits for a 40-man raid with a long bench", () => {
        const event = seed({ size: 40 });
        const long = "Averyveryverylongname";
        const a = { version: 1, groups: [], bench: [] };
        let id = 1;
        for (let g = 1; g <= 8; g++) {
            a.groups.push({ index: g, slots: Array.from({ length: 5 }, () => p(String(id++), long, "Druid-Restoration", "healer")) });
        }
        for (let i = 0; i < 60; i++) a.bench.push(p(String(id++), long, "Shaman-Restoration", "healer"));
        const embed = sm.buildSetupMessage(event, a, { emojis }).embeds[0];
        expect(sm.embedLength(embed)).toBeLessThanOrEqual(sm.LIMITS.total);
        expect(embed.fields.length).toBeLessThanOrEqual(25);
        for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
        expect(embed.fields.find((f) => f.name.includes("Bank")).value).toMatch(/\+\d+ weitere$/);
    });

    it("marks a cancelled event instead of showing the groups", () => {
        const event = seed({ status: "cancelled", cancel: { reason: "Zu wenige Heiler" } });
        const embed = sm.buildSetupMessage(event, event.setup.approved, { emojis }).embeds[0];
        expect(embed.title).toBe("Abgesagt: Setup · Kara Donnerstag");
        expect(embed.description).toContain("Zu wenige Heiler");
        expect(embed.fields).toBeUndefined();
        // nobody is invited to a cancelled raid: no button
        expect(sm.buildSetupMessage(event, event.setup.approved, { emojis }).components).toEqual([]);
    });
});

describe("postOrEditSetupMessage", () => {
    it("posts the first time and remembers where", async () => {
        seed();
        const { channel } = fakeChannel();
        expect(await sm.postOrEditSetupMessage("eh-1", { userId: "orga", now: 5 })).toEqual({ action: "posted" });
        expect(channel.send).toHaveBeenCalledTimes(1);
        expect(mockEvents.get("eh-1").setupPost).toMatchObject({ channelId: "c1", messageId: "m-new", version: 2, postedAt: 5, postedBy: "orga" });
    });

    it("edits the message on a later approval instead of posting again", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "m1", version: 1, postedAt: 1 } });
        const { channel, message } = fakeChannel();
        expect(await sm.postOrEditSetupMessage("eh-1", { now: 9 })).toEqual({ action: "edited" });
        expect(channel.send).not.toHaveBeenCalled();
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(mockEvents.get("eh-1").setupPost).toMatchObject({ messageId: "m1", version: 2, editedAt: 9, postedAt: 1 });
    });

    it("posts anew when the message was deleted in Discord", async () => {
        seed({ setupPost: { channelId: "c1", messageId: "gone", version: 1 } });
        const { channel } = fakeChannel({ fetchError: Object.assign(new Error("Unknown Message"), { code: 10008 }) });
        expect(await sm.postOrEditSetupMessage("eh-1")).toEqual({ action: "posted" });
        expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it("refuses a draft — nothing reaches the channel", async () => {
        const event = seed();
        mockEvents.set("eh-1", { ...event, setup: { ...event.setup, status: "draft", approved: null } });
        const { channel } = fakeChannel();
        expect((await sm.postOrEditSetupMessage("eh-1")).code).toBe("no_approved_setup");
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("shows the approved lineup, not a draft changed after it", async () => {
        const event = seed();
        const draftGroups = [{ index: 1, slots: [p("9", "Draftling", "Mage-Fire", "ranged")] }];
        mockEvents.set("eh-1", { ...event, setup: { ...event.setup, status: "draft", changedSinceApproval: true, version: 3, groups: draftGroups } });
        const { channel } = fakeChannel();
        await sm.postOrEditSetupMessage("eh-1");
        const text = JSON.stringify(channel.send.mock.calls[0][0]);
        expect(text).toContain("Brokk");
        expect(text).not.toContain("Draftling");
    });

    it("does not post for a cancelled event, but marks a posted message", async () => {
        seed({ status: "cancelled", cancel: { reason: "Server down" } });
        const { channel, message } = fakeChannel();
        expect((await sm.postOrEditSetupMessage("eh-1")).code).toBe("cancelled");
        expect(channel.send).not.toHaveBeenCalled();

        mockEvents.get("eh-1").setupPost = { channelId: "c1", messageId: "m1", version: 2 };
        expect(await sm.refreshSetupMessage("eh-1")).toBeNull();
        expect(message.edit.mock.calls[0][0].embeds[0].title).toMatch(/^Abgesagt/);
    });

    it("stores a Discord error instead of throwing", async () => {
        seed();
        discord.getClient.mockReturnValue(null);
        const result = await sm.postOrEditSetupMessage("eh-1", { now: 3 });
        expect(result.code).toBe("discord");
        expect(mockEvents.get("eh-1").setupPost).toMatchObject({ error: "Bot nicht verbunden.", errorAt: 3 });
    });

    it("refreshSetupMessage never posts a first message", async () => {
        seed();
        const { channel } = fakeChannel();
        expect(await sm.refreshSetupMessage("eh-1")).toBeNull();
        expect(channel.send).not.toHaveBeenCalled();
    });
});

describe("DMs", () => {
    it("builds the placed and the bench text", () => {
        const event = seed();
        const placed = sm.buildSetupDm(event, { ...p("2", "Zibbo", "Priest-Holy", "healer"), group: 2 }, { messageUrl: "https://discord.com/channels/g1/c1/m1" });
        expect(placed.content).toContain("Du bist in **Gruppe 2** als **Heiler** (Zibbo · Heilig).");
        expect(placed.content).toContain("[Zum Setup](https://discord.com/channels/g1/c1/m1)");
        const bench = sm.buildSetupDm(event, { ...p("5", "Thalia", "Priest-Shadow", "ranged"), bench: true }, { fairness: true, reasons: ["Raid voll (10/10)"] });
        expect(bench.content).toContain("Diesmal **Bank** (Thalia · Schatten) – nächstes Mal hast du Vorrang.");
        expect(bench.content).toContain("Grund: Raid voll (10/10)");
        const noFair = sm.buildSetupDm(event, { ...p("5", "Thalia", "Priest-Shadow", "ranged"), bench: true }, { fairness: false });
        expect(noFair.content).not.toContain("Vorrang");
    });

    it("takes bench reasons only from the approved version and never names wish partners", () => {
        const event = seed();
        expect(sm.benchReasons(event, "5")).toEqual(["Raid voll (10/10)"]);
        expect(sm.benchReasons({ ...event, setup: { ...event.setup, version: 3 } }, "5")).toEqual([]);
    });

    it("sends nothing while the category switch is off", async () => {
        seed();
        expect(await sm.sendSetupDms("eh-1", { delayMs: 0 })).toEqual({ skipped: "off" });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("sends nothing for a draft or a cancelled event", async () => {
        mockConfig = { categorySetupDms: { cat1: true } };
        const event = seed();
        mockEvents.set("eh-1", { ...event, setup: { ...event.setup, status: "draft", approved: null } });
        expect(await sm.sendSetupDms("eh-1", { config: mockConfig, delayMs: 0 })).toEqual({ skipped: "no_approved_setup" });
        seed({ status: "cancelled" });
        expect(await sm.sendSetupDms("eh-1", { config: mockConfig, delayMs: 0 })).toEqual({ skipped: "cancelled" });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("tells every raider once per placement and records failures", async () => {
        mockConfig = { categorySetupDms: { cat1: true } };
        seed({ setupPost: { channelId: "c1", messageId: "m1" } });
        discord.sendDirectMessage.mockImplementation(async (userId) => (userId === "4" ? { ok: false, error: "Cannot send messages to this user" } : { ok: true }));
        const first = await sm.sendSetupDms("eh-1", { config: mockConfig, delayMs: 0 });
        expect(first.sent).toBe(4);
        expect(first.failed).toEqual([{ userId: "4", character: "Kael", error: "Cannot send messages to this user" }]);
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(5);
        const stored = mockEvents.get("eh-1").setupPost;
        expect(stored.dms).toMatchObject({ status: "done", sent: 4, total: 5, version: 2 });
        expect(Object.keys(stored.told).sort()).toEqual(["1", "2", "3", "5"]);

        // A second run: only the failed one is tried again.
        discord.sendDirectMessage.mockClear();
        discord.sendDirectMessage.mockResolvedValue({ ok: true });
        const second = await sm.sendSetupDms("eh-1", { config: mockConfig, delayMs: 0 });
        expect(second).toMatchObject({ sent: 1, unchanged: 4 });
        expect(discord.sendDirectMessage.mock.calls.map((c) => c[0])).toEqual(["4"]);

        // A new approval that moves one raider: only that one hears about it.
        discord.sendDirectMessage.mockClear();
        const event = mockEvents.get("eh-1");
        const next = clone(event.setup.approved);
        next.version = 3;
        next.groups[1].index = 2;
        next.groups[0].slots.push(next.groups[1].slots.pop()); // Kael → Gruppe 1
        event.setup = { ...event.setup, version: 3, approved: next };
        await sm.sendSetupDms("eh-1", { config: mockConfig, delayMs: 0 });
        expect(discord.sendDirectMessage.mock.calls.map((c) => c[0])).toEqual(["4"]);
        expect(discord.sendDirectMessage.mock.calls[0][1].content).toContain("Gruppe 1");
    });

    it("publishSetup posts first and starts the DMs only with the switch", async () => {
        seed();
        fakeChannel();
        discord.sendDirectMessage.mockResolvedValue({ ok: true });
        const off = await sm.publishSetup("eh-1", { config: {}, delayMs: 0 });
        expect(off.post).toEqual({ action: "posted" });
        expect(off.dms).toBeNull();

        const on = await sm.publishSetup("eh-1", { config: { categorySetupDms: { cat1: true } }, delayMs: 0 });
        expect(on.post).toEqual({ action: "edited" });
        expect(await on.dms).toMatchObject({ sent: 5 });
        // the DMs link the posted message
        expect(discord.sendDirectMessage.mock.calls[0][1].content).toContain("https://discord.com/channels/g1/c1/m-new");
    });
});

describe("publishView", () => {
    it("says before the approval what will happen", () => {
        const event = seed();
        mockEvents.set("eh-1", { ...event, setup: { ...event.setup, status: "draft", approved: null } });
        const view = sm.publishView(mockEvents.get("eh-1"), { config: { categorySetupDms: {} }, channelName: "kara-do" });
        expect(view).toMatchObject({ channelName: "kara-do", dmsEnabled: false, recipients: 5, pendingDms: 5, posted: null, dms: null });
    });

    it("says after it what did, failures included", () => {
        seed({
            setupPost: {
                channelId: "c1", messageId: "m1", version: 1, postedAt: 10,
                told: { 1: "g1/Warrior-Protection/tank" },
                dms: { status: "done", version: 1, at: 11, total: 5, sent: 4, failed: [{ userId: "4", character: "Kael", error: "closed" }] },
            },
        });
        const view = sm.publishView(mockEvents.get("eh-1"), { config: { categorySetupDms: { cat1: true } } });
        expect(view.dmsEnabled).toBe(true);
        expect(view.posted).toMatchObject({ messageUrl: "https://discord.com/channels/g1/c1/m1", postedAt: 10, version: 1 });
        expect(view.outdated).toBe(true);
        expect(view.pendingDms).toBe(4);
        expect(view.dms.failed).toEqual([{ userId: "4", character: "Kael", error: "closed" }]);
    });
});

describe("eventStore.setEventSetupPost", () => {
    it("is used for every write (the store merges)", async () => {
        seed();
        fakeChannel();
        await sm.postOrEditSetupMessage("eh-1");
        expect(eventStore.setEventSetupPost).toHaveBeenCalledWith("eh-1", expect.objectContaining({ messageId: "m-new" }));
    });
});
