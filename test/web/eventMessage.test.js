// Die Anmelder-Nachricht im Event-Kanal (#254, neu gebaut in #287): Kopf, Rollen-Summen,
// Tank-Block, Klassen-Blöcke mit Nummern, weitere Status, Links, Grenzen, Dropdown.
jest.mock("../../src/web/eventStore", () => ({ getEvent: jest.fn(), setEventMessage: jest.fn(), listEvents: jest.fn(() => []) }));
const mockListeners = [];
jest.mock("../../src/web/signupStore", () => ({
    listSignups: jest.fn(() => []),
    onSignupsChanged: jest.fn((fn) => {
        mockListeners.push(fn);
        return () => mockListeners.splice(mockListeners.indexOf(fn), 1);
    }),
}));
jest.mock("../../src/web/discord", () => ({ getClient: jest.fn() }));
jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const { getEvent, setEventMessage, listEvents } = require("../../src/web/eventStore");
const { listSignups } = require("../../src/web/signupStore");
const discord = require("../../src/web/discord");
const appEmojis = require("../../src/web/appEmojis");
const {
    buildEventMessage, rosterCounts, signupButtonId, joinSelectId, messagePhase, signupNumbers, embedLength, blockValue,
    eventsToRedraw, sweepEventMessages, postEventMessage, refreshEventMessage, startEventMessageSync, LIMITS,
} = require("../../src/web/eventMessage");

const NOW = 1999000000 * 1000;
const event = (over = {}) => ({
    id: "eh-1", title: "Kara Donnerstag", description: "Treffpunkt Eingang", leaderId: "7", channelId: "c1",
    startTime: 2000000000, size: 10, composition: { tank: 2, healer: 3, melee: 0, ranged: 0 }, signupDeadline: 0, message: null, ...over,
});
const su = (userId, character, spec, role, status = "signed", at = Number(userId)) => ({ userId, character, spec, role, status, at });
const signups = [
    su("1", "Brokk", "Warrior-Protection", "tank"),
    su("2", "Ysolde", "Priest-Holy", "healer", "late"),
    su("3", "Nerathil", "Mage-Arcane", "ranged"),
    su("4", "Kael", "Rogue-Combat", "melee", "tentative"),
    su("5", "", "", "", "absence"),
    su("6", "Thalia", "Priest-Shadow", "ranged"),
    su("7", "Gemli", "Druid-Guardian", "tank"),
];
const emojis = Object.fromEntries(appEmojis.emojiCatalog().map((e, i) => [e.name, { id: String(1000 + i), name: e.name, animated: false }]));
const field = (payload, name) => payload.embeds[0].fields.find((f) => f.name.includes(name));

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
        appEmojis.resetAppEmojis();
        listSignups.mockReturnValue(signups);
    });

    it("counts who comes per role and who said otherwise", () => {
        expect(rosterCounts(signups)).toEqual({ tank: 2, healer: 1, dps: 2, attending: 5, tentative: 1, bench: 0, absence: 1 });
    });

    it("numbers the signups by when they were made, stable against the input order", () => {
        const shuffled = [signups[3], signups[0], signups[6], signups[1]];
        expect([...signupNumbers(shuffled)]).toEqual([["1", 1], ["2", 2], ["4", 3], ["7", 4]]);
        const tie = signupNumbers([{ userId: "b", at: 5 }, { userId: "a", at: 5 }]);
        expect(tie.get("a")).toBe(1);
    });

    it("builds the head, the role totals and the links", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), signups, { emojis, now: NOW });
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Kara Donnerstag");
        expect(embed.color).toBe(7);
        expect(embed.description).toBe("Treffpunkt Eingang");
        expect(embed.fields.slice(0, 6).map((f) => f.inline)).toEqual([true, true, true, true, true, true]);
        expect(field(payload, "Leitung").value).toBe("<@7>");
        expect(field(payload, "Angemeldet")).toMatchObject({ name: expect.stringMatching(/^<:eh_status_signed:\d+> Angemeldet$/), value: "**5** / 10" });
        expect(field(payload, "Anmeldeschluss").value).toBe("<t:1999990000:f>");
        expect(field(payload, "Datum").value).toBe("<t:2000000000:D>");
        expect(field(payload, "Uhrzeit").value).toBe("<t:2000000000:t>");
        expect(field(payload, "Start").value).toBe("<t:2000000000:R>");
        const totals = embed.fields[6].value;
        expect(totals).toMatch(/<:eh_role_tank:\d+> Tanks \*\*2\*\*\/2/);
        expect(totals).toMatch(/<:eh_role_healer:\d+> Heiler \*\*1\*\*\/3/);
        expect(totals).toMatch(/Nahkampf \*\*0\*\*(?!\/)/);
        expect(totals).toMatch(/Fernkampf \*\*2\*\*(?!\/)/);
        const links = embed.fields[embed.fields.length - 1].value;
        expect(links).toBe("[Web](https://eh.example/signups?event=eh-1)");
        expect(links).not.toContain("Setup");
    });

    it("shows melee/ranged targets as minimum or range", () => {
        const payload = buildEventMessage(event({ composition: { tank: 2, healer: 3, melee: 2, ranged: 1 }, compositionMax: { melee: 4 } }), [], { now: NOW });
        expect(payload.embeds[0].fields[6].value).toContain("Nahkampf **0**/2–4");
        expect(payload.embeds[0].fields[6].value).toContain("Fernkampf **0**/1+");
    });

    it("puts tanks in their own block first, then one block per class in fixed order", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        const blocks = payload.embeds[0].fields.slice(7).filter((f) => f.inline);
        expect(blocks.map((b) => b.name.replace(/<:[a-z_]+:\d+> /, ""))).toEqual(["Tank (2)", "Priester (1)", "Magier (1)"]);
        expect(blocks[0].value.split("\n")).toEqual([
            expect.stringMatching(/^<:eh_warrior_protection:\d+> `1` \*\*Brokk\*\*$/),
            expect.stringMatching(/^<:eh_druid_guardian:\d+> `7` \*\*Gemli\*\*$/),
        ]);
        expect(blocks[1].name).toMatch(/^<:eh_class_priest:\d+> Priester \(1\)$/);
        expect(blocks[1].value).toMatch(/<:eh_priest_shadow:\d+> `6` \*\*Thalia\*\*/);
    });

    it("lists only the first choice and marks alternates with a small +N (#293)", () => {
        const multi = { ...su("9", "Zibbo", "Priest-Holy", "healer"), characters: [
            { character: "Zibbo", spec: "Priest-Holy", role: "healer" },
            { character: "Zibbowar", spec: "Warrior-Protection", role: "tank" },
        ] };
        const payload = buildEventMessage(event(), [...signups, multi], { emojis, now: NOW });
        const json = JSON.stringify(payload);
        expect(json).toMatch(/`\d+` \*\*Zibbo\*\* \+1/);
        expect(json).not.toContain("Zibbowar");
        const plain = buildEventMessage(event(), [...signups, multi], { now: NOW });
        expect(JSON.stringify(plain)).toMatch(/`\d+` \*\*Zibbo\*\* · [^"+\\]+ \+1/);
    });

    it("lists late, tentative, bench and absence as lines with number and name", () => {
        const payload = buildEventMessage(event(), [...signups, su("8", "Bänki", "Mage-Frost", "ranged", "bench")], { emojis, now: NOW });
        const other = payload.embeds[0].fields.find((f) => !f.inline && f.value.includes("Spät"));
        const lines = other.value.split("\n");
        expect(lines[0]).toMatch(/^<:eh_status_late:\d+> Spät \(1\): `2` Ysolde$/);
        expect(lines[1]).toMatch(/Vielleicht \(1\): `4` Kael$/);
        expect(lines[2]).toMatch(/Bank \(1\): `8` Bänki$/);
        expect(lines[3]).toMatch(/Abgemeldet \(1\): `5` <@5>$/);
    });

    it("reads the same without application emojis — text icons and spec names", () => {
        const payload = buildEventMessage(event(), signups, { now: NOW });
        const json = JSON.stringify(payload);
        expect(json).not.toMatch(/<:eh_/);
        const blocks = payload.embeds[0].fields.filter((f) => f.inline).slice(6);
        expect(blocks[0]).toMatchObject({ name: "🛡️ Tank (2)", value: "`1` **Brokk** · Schutz\n`7` **Gemli** · Wilder Kampf (Bär)" });
        expect(blocks[1].name).toBe("Priester (1)");
        expect(payload.embeds[0].fields[6].value).toContain("🛡️ Tanks **2**/2");
        const options = payload.components[0].components[0].options;
        expect(options[0]).toMatchObject({ value: "signed", label: "Dabei", emoji: { name: "✅" } });
    });

    it("escapes markdown and mentions in character names", () => {
        const payload = buildEventMessage(event(), [su("1", "*Bold*_@everyone", "Mage-Arcane", "ranged")], { now: NOW });
        const block = payload.embeds[0].fields.find((f) => f.name.startsWith("Magier"));
        expect(block.value).toContain("\\*Bold\\*\\_@​everyone");
    });

    it("offers every status in the public select before the deadline", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        expect(payload.components).toHaveLength(1);
        const select = payload.components[0].components[0];
        expect(select).toMatchObject({ type: 3, custom_id: "event-join:eh-1", placeholder: "Anmelden …", min_values: 1, max_values: 1 });
        expect(select.options.map((o) => o.value)).toEqual(["signed", "tentative", "late", "bench", "absence"]);
        expect(select.options[0].emoji).toEqual({ id: expect.any(String), name: "eh_status_signed", animated: false });
        expect(joinSelectId("x")).toBe("event-join:x");
        expect(signupButtonId("x")).toBe("event-signup:x");
    });

    it("offers only late and absence after the deadline, and nothing once the raid started", () => {
        const late = buildEventMessage(event({ signupDeadline: 1998000000 }), signups, { now: NOW });
        expect(late.components[0].components[0].options.map((o) => o.value)).toEqual(["late", "absence"]);
        expect(late.embeds[0].description).toContain("Anmeldeschluss vorbei");
        const started = buildEventMessage(event({ startTime: 1998000000 }), signups, { now: NOW });
        expect(started.components).toEqual([]);
        expect(started.embeds[0].description).toContain("Der Raid hat begonnen");
    });

    it("shows a cancelled or closed event without components (#288)", () => {
        const cancelled = buildEventMessage(event({ status: "cancelled", cancelReason: "zu wenige Heiler" }), signups, { now: NOW });
        expect(cancelled.embeds[0].title).toBe("Abgesagt: Kara Donnerstag");
        expect(cancelled.embeds[0].description).toContain("Abgesagt** – zu wenige Heiler");
        expect(cancelled.embeds[0].color).not.toBe(7);
        expect(cancelled.components).toEqual([]);
        const closed = buildEventMessage(event({ status: "closed" }), signups, { now: NOW });
        expect(closed.embeds[0].description).toContain("Anmeldung geschlossen");
        expect(closed.components).toEqual([]);
        expect(messagePhase(event({ status: "closed" }), NOW)).toBe("closed");
        expect(messagePhase(event(), NOW)).toBe("open");
    });

    it("cuts a long block with +N weitere and keeps every field within Discord's limits", () => {
        expect(blockValue(["a", "b", "c"], 2)).toBe("a\nb\n+1 weitere");
        expect(blockValue(["a", "b"], 2)).toBe("a\nb");
        expect(blockValue([], 2)).toBe("​");
        const long = Array.from({ length: 30 }, (_, i) => "x".repeat(60) + i);
        const value = blockValue(long, 40);
        expect(value.length).toBeLessThanOrEqual(1024);
        expect(value).toMatch(/\+\d+ weitere$/);

        // 40 raiders, all warriors with long names, plus 40 absences: must still fit.
        const many = Array.from({ length: 80 }, (_, i) => su(String(100 + i), `Kriegerlangername${i}`, "Warrior-Fury", "melee", i < 40 ? "signed" : "absence", i));
        const payload = buildEventMessage(event({ size: 40, description: "d".repeat(1500), title: "T".repeat(300) }), many, { emojis, now: NOW });
        const embed = payload.embeds[0];
        expect(embed.title.length).toBeLessThanOrEqual(LIMITS.title);
        expect(embed.fields.length).toBeLessThanOrEqual(LIMITS.fields);
        for (const f of embed.fields) {
            expect(f.value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
            expect(f.value.length).toBeGreaterThan(0);
        }
        expect(embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
        const warriors = embed.fields.find((f) => f.name.includes("Krieger (40)"));
        expect(warriors.value).toMatch(/\+\d+ weitere$/);
    });

    it("shows and links the approved setup, never a draft", () => {
        const approved = { groups: [{ index: 1, slots: [{ character: "Brokk" }] }], bench: [{ character: "Kael" }] };
        const payload = buildEventMessage(event({ setup: { status: "approved", approved } }), signups, { now: NOW, icsUrl: "https://eh.example/ics/eh-1.ics" });
        const fields = payload.embeds[0].fields;
        expect(field(payload, "Setup").value).toBe("**Gr. 1** Brokk\n**Bank** Kael");
        const links = fields[fields.length - 1].value;
        expect(links).toBe("[Web](https://eh.example/signups?event=eh-1) | [Setup](https://eh.example/raids/detail?event=eh-1&tab=setup) | [Kalender](https://eh.example/ics/eh-1.ics)");

        const draft = buildEventMessage(event({ setup: { status: "draft", groups: approved.groups } }), signups, { now: NOW });
        expect(JSON.stringify(draft)).not.toContain("Setup");
    });

    it("posts the message with the application emojis and remembers where it sits", async () => {
        getEvent.mockReturnValue(event());
        const { channel } = fakeDiscord();
        const fetchEmojis = jest.fn(async () => [{ id: "55", name: "eh_status_signed" }, { id: "56", name: "other" }]);
        discord.getClient.mockReturnValue({ ...discord.getClient(), application: { emojis: { fetch: fetchEmojis } } });
        await expect(postEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m-new" });
        const sent = channel.send.mock.calls[0][0];
        expect(sent.components[0].components[0].options[0].emoji).toEqual({ id: "55", name: "eh_status_signed", animated: false });
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

    it("redraws a message once its deadline or start has passed", () => {
        const drawn = new Map();
        const nowSec = NOW / 1000;
        const msg = { channelId: "c1", messageId: "m1" };
        const list = [
            event({ id: "eh-open", message: msg }),
            event({ id: "eh-dl", message: msg, signupDeadline: nowSec - 3600 }),
            event({ id: "eh-old", message: msg, startTime: nowSec - 3 * 86400 }),
            event({ id: "eh-nomsg", signupDeadline: nowSec - 60 }),
        ];
        // After a restart: only what changed phase recently.
        expect(eventsToRedraw(list, drawn, NOW)).toEqual(["eh-dl"]);
        expect(drawn.get("eh-open")).toBe("open");
        expect(drawn.has("eh-nomsg")).toBe(false);
        // Nothing changed → nothing to do; the deadline of eh-open passes → redraw it.
        drawn.set("eh-dl", "deadline");
        expect(eventsToRedraw(list, drawn, NOW)).toEqual([]);
        list[0] = event({ id: "eh-open", message: msg, signupDeadline: nowSec - 1 });
        expect(eventsToRedraw(list, drawn, NOW)).toEqual(["eh-open"]);
    });

    it("sweeps: edits the messages whose phase changed", async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const e = event({ id: "eh-sw", message: { channelId: "c1", messageId: "m1" }, signupDeadline: nowSec - 60, startTime: nowSec + 3600 });
        listEvents.mockReturnValue([e]);
        getEvent.mockReturnValue(e);
        const { message } = fakeDiscord();
        await sweepEventMessages();
        expect(message.edit).toHaveBeenCalledTimes(1);
        await sweepEventMessages();
        expect(message.edit).toHaveBeenCalledTimes(1);
    });

    it("edits the message once per burst of roster changes", async () => {
        jest.useFakeTimers();
        try {
            getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1" } }));
            const { message } = fakeDiscord();
            const stop = startEventMessageSync({ debounceMs: 1000, sweepMs: 0 });
            expect(startEventMessageSync()).toBe(stop); // idempotent
            mockListeners.forEach((fn) => { fn("eh-1"); fn("eh-1"); });
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            await new Promise(jest.requireActual("timers").setImmediate);
            await new Promise(jest.requireActual("timers").setImmediate);
            expect(message.edit).toHaveBeenCalledTimes(1);
            stop();
            expect(mockListeners).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
