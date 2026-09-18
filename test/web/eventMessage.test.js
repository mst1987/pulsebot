// Die Anmelder-Nachricht im Event-Kanal (#254, neu gebaut in #287): Kopf, Rollen-Summen,
// Tank-Block, Klassen-Blöcke mit Nummern, weitere Status, Links, Grenzen, Dropdown; Aussehen wie Raid-Helper (#303).
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
    buildEventMessage, rosterCounts, signupButtonId, joinSelectId, buttonId, rosterEntries, messagePhase, signupNumbers, embedLength, blockValue,
    sweepEventMessages, postEventMessage, refreshEventMessage, startEventMessageSync, redrawEventMessage, LIMITS,
    pickSelectId, payloadHash, messageComponents,
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

    const emojiless = (text) => String(text).replace(/:\d+>/g, ">");
    const ZWS = "​";

    it("builds the head as icon + value, leader · count · deadline over date · time · countdown", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), signups, { emojis, now: NOW });
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Kara Donnerstag");
        expect(embed.color).toBe(7);
        expect(embed.description).toBe("Treffpunkt Eingang");
        // no labels: an empty name gives the air above each row, the icon says what it is
        expect(embed.fields.slice(0, 6).map((f) => [f.name, emojiless(f.value), f.inline])).toEqual([
            [ZWS, "<:eh_ui_leader> <@7>", true],
            [ZWS, "<:eh_ui_signups> **5** / 10", true],
            [ZWS, "<:eh_ui_deadline> <t:1999990000:f>", true],
            [ZWS, "<:eh_ui_date> <t:2000000000:D>", true],
            [ZWS, "<:eh_ui_time> <t:2000000000:t>", true],
            [ZWS, "<:eh_ui_start> <t:2000000000:R>", true],
        ]);
        // #305: the third row — the end (start + duration) and, when there is one, the voice channel
        expect(embed.fields.slice(6, 9).map((f) => [f.name, emojiless(f.value), f.inline])).toEqual([
            [ZWS, "<:eh_ui_end> <t:2000010800:t>", true],
            [ZWS, ZWS, true],
            [ZWS, ZWS, true],
        ]);
        const links = embed.fields[embed.fields.length - 1].value;
        // #308: the public event page first, the menu beside it, and the event's
        // own calendar file (no icsUrl was passed).
        expect(links).toBe("[Event](https://eh.example/e/eh-1)  ·  [Anmeldung](https://eh.example/signups?event=eh-1)  ·  [Kalender](https://eh.example/r/cal/eh-1.ics)");
        expect(links).not.toContain("Setup");
    });

    it("keeps the head's rows without a deadline: an empty column instead", () => {
        const embed = buildEventMessage(event(), signups, { emojis, now: NOW }).embeds[0];
        expect(embed.fields[2]).toEqual({ name: ZWS, value: ZWS, inline: true });
        expect(emojiless(embed.fields[3].value)).toBe("<:eh_ui_date> <t:2000000000:D>");
    });

    it("shows the raid's end from its duration and the voice channel as its own head field (#305)", () => {
        const embed = buildEventMessage(event({ durationMinutes: 240, voiceChannelId: "v9" }), signups, { emojis, now: NOW }).embeds[0];
        expect(emojiless(embed.fields[6].value)).toBe("<:eh_ui_end> <t:2000014400:t>");
        expect(emojiless(embed.fields[7].value)).toBe("<:eh_ui_voice> <#v9>");
        // without the application emojis the labels stand in the field name
        const plain = buildEventMessage(event({ voiceChannelId: "v9" }), signups, { now: NOW }).embeds[0];
        expect([plain.fields[6].name, plain.fields[7].name]).toEqual(["Ende", "Sprachkanal"]);
        expect(plain.fields[7].value).toBe("<#v9>");
    });

    it("sets the role totals apart as columns with flat role icons, the healers below, then an empty line", () => {
        const embed = buildEventMessage(event(), signups, { emojis, now: NOW }).embeds[0];
        expect(embed.fields.slice(9, 14).map((f) => [f.name, emojiless(f.value), f.inline])).toEqual([
            [ZWS, "<:eh_ui_tank> Tanks **2**/2", true],
            [ZWS, "<:eh_ui_ranged> Fernkampf **2**", true],
            [ZWS, "<:eh_ui_melee> Nahkampf **0**", true],
            [ZWS, "<:eh_ui_healer> Heiler **1**/3", true],
            [ZWS, ZWS, false],
        ]);
        // the colourful WoW role icons are no longer used in the message
        expect(JSON.stringify(embed)).not.toContain("eh_role_");
    });

    it("shows melee/ranged targets as minimum or range", () => {
        const payload = buildEventMessage(event({ composition: { tank: 2, healer: 3, melee: 2, ranged: 1 }, compositionMax: { melee: 4 } }), [], { now: NOW });
        const values = payload.embeds[0].fields.slice(9, 13).map((f) => f.value);
        expect(values).toContain("Nahkampf **0**/2–4");
        expect(values).toContain("Fernkampf **0**/1+");
    });

    it("puts tanks in their own block first, then one block per class in fixed order, with an empty line under each", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        const blocks = payload.embeds[0].fields.slice(14).filter((f) => f.inline);
        expect(blocks.map((b) => emojiless(b.name))).toEqual(["<:eh_ui_tank> __Tanks__ (2)", "<:eh_class_priest> __Priester__ (1)", "<:eh_class_mage> __Magier__ (1)"]);
        expect(blocks[0].value.split("\n")).toEqual([
            expect.stringMatching(/^<:eh_warrior_protection:\d+> `1` \*\*Brokk\*\*$/),
            expect.stringMatching(/^<:eh_druid_guardian:\d+> `7` \*\*Gemli\*\*$/),
            ZWS,
        ]);
        expect(blocks[1].value).toMatch(/<:eh_priest_shadow:\d+> `6` \*\*Thalia\*\*/);
    });

    it("lists every character of a signup in the block of its own status, under one number — the count stays per person", () => {
        const multi = { ...su("9", "Zibbo", "Priest-Holy", "healer", "late"), characters: [
            { character: "Zibbo", spec: "Priest-Holy", role: "healer", status: "late" },
            { character: "Zibbowar", spec: "Warrior-Protection", role: "tank", status: "signed" },
            { character: "Zibbomage", spec: "Mage-Fire", role: "ranged" },
        ] };
        const payload = buildEventMessage(event(), [...signups, multi], { emojis, now: NOW });
        const fields = payload.embeds[0].fields;
        const tank = fields.find((f) => f.inline && f.name.includes("__Tanks__"));
        expect(tank.name).toMatch(/__Tanks__ \(3\)$/);
        expect(tank.value).toMatch(/`8` \*\*Zibbowar\*\*/);
        // a character without its own status has the signup's (late)
        const other = fields.find((f) => !f.inline && f.value.includes("Spät"));
        expect(other.value.split("\n")[0]).toMatch(/Spät \(3\): `2` Ysolde, `8` Zibbo, `8` Zibbomage$/);
        expect(JSON.stringify(payload)).not.toContain("+1");
        // one seat per person: Zibbo is late, so 5 + 1 attend, the tank count stays per person
        expect(emojiless(fields[1].value)).toBe("<:eh_ui_signups> **6** / 10");
        expect(fields[12].value).toMatch(/Heiler \*\*2\*\*\/3/);
        expect(rosterEntries([multi]).map((e) => [e.character, e.status, e.index])).toEqual([
            ["Zibbo", "late", 0], ["Zibbowar", "signed", 1], ["Zibbomage", "late", 2],
        ]);
    });

    it("lists late, tentative, bench and absence as lines with icon, count and number boxes", () => {
        const payload = buildEventMessage(event(), [...signups, su("8", "Bänki", "Mage-Frost", "ranged", "bench")], { emojis, now: NOW });
        const other = payload.embeds[0].fields.find((f) => !f.inline && f.value.includes("Spät"));
        expect(other.name).toBe(ZWS);
        expect(other.value.split("\n").map(emojiless)).toEqual([
            "<:eh_ui_late> Spät (1): `2` Ysolde",
            "<:eh_ui_tentative> Vielleicht (1): `4` Kael",
            "<:eh_ui_bench> Bank (1): `8` Bänki",
            "<:eh_ui_absence> Abgemeldet (1): `5` <@5>",
        ]);
    });

    it("reads each character's own status: a first character on Bank is in the Bank line, never under Abgemeldet", () => {
        // the case of the screenshot in #303: signed off before, then Bank
        const devire = { userId: "11", status: "bench", character: "Devire", spec: "Mage-Arcane", role: "ranged", at: 11, comment: "Arbeit",
            characters: [{ character: "Devire", spec: "Mage-Arcane", role: "ranged", status: "bench" }] };
        const lines = (list) => buildEventMessage(event(), list, { now: NOW }).embeds[0].fields.find((f) => !f.inline && f.name === ZWS && /Bank|Abgemeldet/.test(f.value));
        expect(lines([devire]).value).toBe("Bank (1): `1` Devire");
        // the first character on Bank, the second still signed: both where their own status puts them
        const two = { ...devire, characters: [devire.characters[0], { character: "Devheal", spec: "Priest-Holy", role: "healer", status: "signed" }] };
        const payload = buildEventMessage(event(), [two], { now: NOW });
        expect(payload.embeds[0].fields.find((f) => f.name.startsWith("__Priester__")).value).toContain("`1` **Devheal**");
        expect(lines([two]).value).toBe("Bank (1): `1` Devire");
        // an absence is one line per person, whatever its characters stored
        expect(lines([{ ...devire, status: "absence", characters: [{ character: "Devire", spec: "Mage-Arcane" }] }]).value).toBe("Abgemeldet (1): `1` Devire");
    });

    it("reads the same without application emojis — labels in the head, spec names, no colourful unicode", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), [...signups, su("8", "Bänki", "Mage-Frost", "ranged", "bench")], { now: NOW });
        const json = JSON.stringify(payload);
        expect(json).not.toMatch(/<:eh_/);
        expect(json).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
        const embed = payload.embeds[0];
        expect(embed.fields.slice(0, 6).map((f) => [f.name, f.value])).toEqual([
            ["Leitung", "<@7>"], ["Angemeldet", "**5** / 10"], ["Anmeldeschluss", "<t:1999990000:f>"],
            ["Datum", "<t:2000000000:D>"], ["Uhrzeit", "<t:2000000000:t>"], ["Start", "<t:2000000000:R>"],
        ]);
        expect(embed.fields[6]).toEqual({ name: "Ende", value: "<t:2000010800:t>", inline: true });
        expect(embed.fields[9].value).toBe("Tanks **2**/2");
        const blocks = embed.fields.slice(14).filter((f) => f.inline);
        expect(blocks[0]).toMatchObject({ name: "__Tanks__ (2)", value: `\`1\` **Brokk** · Schutz\n\`7\` **Gemli** · Wilder Kampf (Bär)\n${ZWS}` });
        expect(blocks[1].name).toBe("__Priester__ (1)");
        expect(embed.fields.find((f) => !f.inline && f.value.includes("Spät")).value.split("\n")[0]).toBe("Spät (1): `2` Ysolde");
        const components = payload.components.flatMap((r) => r.components);
        expect(components.every((b) => b.emoji === undefined)).toBe(true);
        expect(components[0].options.every((o) => o.emoji === undefined)).toBe(true);
    });

    it("escapes markdown and mentions in character names", () => {
        const payload = buildEventMessage(event(), [su("1", "*Bold*_@everyone", "Mage-Arcane", "ranged")], { now: NOW });
        const block = payload.embeds[0].fields.find((f) => f.name.startsWith("__Magier__"));
        expect(block.value).toContain("\\*Bold\\*\\_@​everyone");
    });

    it("offers the signup select (Meine Charaktere … and the classes) and one row of status buttons before the deadline", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        expect(payload.components).toHaveLength(2);
        const [[select], buttons] = payload.components.map((r) => r.components);
        expect(select).toMatchObject({ type: 3, custom_id: "event-pick:eh-1", min_values: 1, max_values: 1 });
        expect(select.options[0]).toMatchObject({ label: "Meine Charaktere …", value: "mine", emoji: { name: "eh_ui_signups" } });
        expect(select.options.slice(1).map((o) => o.value)).toEqual(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]);
        expect(select.options[1].emoji.name).toBe("eh_class_warrior");
        expect(select.options.length).toBeLessThanOrEqual(25);
        // the public select is the same for everybody: no own characters in it
        expect(select.options.some((o) => o.value.includes("|"))).toBe(false);
        expect(buttons.map((b) => [b.label, b.custom_id, b.style])).toEqual([
            ["Spät", "event-btn:eh-1:late", 2],
            ["Vielleicht", "event-btn:eh-1:tentative", 2],
            ["Bank", "event-btn:eh-1:bench", 2],
            ["Absagen", "event-btn:eh-1:absence", 4],
        ]);
        expect(buttons[2].emoji).toEqual({ id: expect.any(String), name: "eh_ui_bench", animated: false });
        expect(buttonId("x", "late")).toBe("event-btn:x:late");
        expect(pickSelectId("x")).toBe("event-pick:x");
        expect(joinSelectId("x")).toBe("event-join:x");
        expect(signupButtonId("x")).toBe("event-signup:x");
    });

    it("lists the classes of the event's game version", () => {
        const classic = buildEventMessage(event({ versionId: "classic" }), [], { now: NOW });
        const values = classic.components[0].components[0].options.map((o) => o.value);
        expect(values[0]).toBe("mine");
        expect(values.length).toBeGreaterThan(5);
        expect(messageComponents(event(), { now: NOW })).toEqual(buildEventMessage(event(), [], { now: NOW }).components);
    });

    it("offers only Spät and Absagen after the deadline, and nothing once the raid started", () => {
        const late = buildEventMessage(event({ signupDeadline: 1998000000 }), signups, { now: NOW });
        expect(late.components).toHaveLength(1);
        expect(late.components[0].components.map((b) => b.custom_id)).toEqual(["event-btn:eh-1:late", "event-btn:eh-1:absence"]);
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

    it("reads the store's shape of Event verwalten: the reason in cancel, a closed signup still takes sign-offs (#288)", () => {
        const cancelled = buildEventMessage(event({ status: "cancelled", cancel: { reason: "Zu wenig Heiler" } }), signups, { now: NOW });
        expect(cancelled.embeds[0].description).toContain("Abgesagt** – Zu wenig Heiler");
        expect(cancelled.components).toEqual([]);
        const closed = buildEventMessage(event({ status: "active", signupsClosed: true }), signups, { now: NOW });
        expect(messagePhase(event({ signupsClosed: true }), NOW)).toBe("closed");
        expect(closed.embeds[0].description).toContain("Anmeldung geschlossen** – Abmelden geht weiter.");
        expect(closed.components).toEqual([{ type: 1, components: [expect.objectContaining({ label: "Absagen", custom_id: "event-btn:eh-1:absence" })] }]);
        // a raid that started is "started", closed or not
        expect(messagePhase(event({ signupsClosed: true, startTime: 1998000000 }), NOW)).toBe("started");
    });

    it("cuts a long block with +N weitere and keeps every field within Discord's limits", () => {
        expect(blockValue(["a", "b", "c"], 2)).toBe("a\nb\n+1 weitere");
        expect(blockValue(["a", "b"], 2)).toBe("a\nb");
        expect(blockValue([], 2)).toBe(ZWS);
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
            expect(f.name.length).toBeGreaterThan(0);
        }
        expect(embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
        const warriors = embed.fields.find((f) => f.name.includes("__Krieger__ (40)"));
        expect(warriors.value).toMatch(/\+\d+ weitere\n​$/);
    });

    it("fits 40 signups over every class, a setup and all links into 25 fields — the spacers go first", () => {
        const specs = [
            ["Warrior-Protection", "tank"], ["Warrior-Fury", "melee"], ["Paladin-Holy", "healer"], ["Hunter-BeastMastery", "ranged"],
            ["Rogue-Combat", "melee"], ["Priest-Shadow", "ranged"], ["Shaman-Restoration", "healer"], ["Mage-Fire", "ranged"],
            ["Warlock-Destruction", "ranged"], ["Druid-Balance", "ranged"],
        ];
        const statuses = ["signed", "signed", "signed", "signed", "late", "tentative", "bench", "absence"];
        const many = Array.from({ length: 48 }, (_, i) => su(String(300 + i), `Raider${i}`, specs[i % specs.length][0], specs[i % specs.length][1], statuses[i % statuses.length], i));
        const approved = { groups: [{ index: 1, slots: [{ character: "Raider0" }] }], bench: [] };
        const payload = buildEventMessage(event({ size: 40, signupDeadline: 1999990000, setup: { status: "approved", approved } }), many, { emojis, now: NOW, icsUrl: "https://eh.example/ics" });
        const embed = payload.embeds[0];
        expect(embed.fields.length).toBeLessThanOrEqual(LIMITS.fields);
        expect(embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
        const names = embed.fields.map((f) => emojiless(f.name));
        // every class block, the status lines, the setup and the links are all there
        for (const cls of ["Krieger", "Paladin", "Jäger", "Schurke", "Priester", "Schamane", "Magier", "Hexenmeister", "Druide"]) {
            expect(names.some((n) => n.includes(`__${cls}__`))).toBe(true);
        }
        expect(names.some((n) => n.includes("__Tanks__"))).toBe(true);
        expect(embed.fields.some((f) => f.value.includes("Abgemeldet ("))).toBe(true);
        expect(names.some((n) => n.includes("Setup"))).toBe(true);
        expect(embed.fields[embed.fields.length - 1].value).toContain("[Kalender]");
        expect(embed.fields.every((f) => Object.keys(f).sort().join() === "inline,name,value")).toBe(true);
    });

    it("shows and links the approved setup, never a draft", () => {
        const approved = { groups: [{ index: 1, slots: [{ character: "Brokk" }] }], bench: [{ character: "Kael" }] };
        const payload = buildEventMessage(event({ setup: { status: "approved", approved } }), signups, { now: NOW, icsUrl: "https://eh.example/ics/eh-1.ics" });
        const fields = payload.embeds[0].fields;
        expect(field(payload, "Setup").value).toBe("**Gr. 1** Brokk\n**Bank** Kael");
        const links = fields[fields.length - 1].value;
        expect(links).toBe("[Event](https://eh.example/e/eh-1)  ·  [Anmeldung](https://eh.example/signups?event=eh-1)  ·  [Setup](https://eh.example/raids/detail?event=eh-1&tab=setup)  ·  [Kalender](https://eh.example/ics/eh-1.ics)");

        const draft = buildEventMessage(event({ setup: { status: "draft", groups: approved.groups } }), signups, { now: NOW });
        expect(JSON.stringify(draft)).not.toContain("Setup");
    });

    it("posts the message with the application emojis and remembers where it sits and what it shows", async () => {
        getEvent.mockReturnValue(event());
        const { channel } = fakeDiscord();
        const fetchEmojis = jest.fn(async () => [{ id: "55", name: "eh_ui_bench" }, { id: "56", name: "other" }]);
        discord.getClient.mockReturnValue({ ...discord.getClient(), application: { emojis: { fetch: fetchEmojis } } });
        await expect(postEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m-new" });
        const sent = channel.send.mock.calls[0][0];
        expect(sent.components[1].components[2].emoji).toEqual({ id: "55", name: "eh_ui_bench", animated: false });
        expect(setEventMessage).toHaveBeenCalledWith("eh-1", { channelId: "c1", messageId: "m-new", hash: payloadHash(sent) });
    });

    it("fails clearly without a bot connection", async () => {
        getEvent.mockReturnValue(event());
        discord.getClient.mockReturnValue(null);
        await expect(postEventMessage("eh-1")).rejects.toThrow("Bot nicht verbunden.");
        getEvent.mockReturnValue(null);
        await expect(postEventMessage("eh-x")).rejects.toThrow("Event nicht gefunden.");
    });

    it("edits the existing message, leaves one alone that shows exactly this, and re-posts one that was deleted", async () => {
        getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1" } }));
        const { message, channel } = fakeDiscord();
        await expect(refreshEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m1", reposted: false });
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(channel.send).not.toHaveBeenCalled();
        const hash = payloadHash(message.edit.mock.calls[0][0]);
        expect(setEventMessage).toHaveBeenCalledWith("eh-1", { channelId: "c1", messageId: "m1", hash });

        getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1", hash } }));
        await expect(refreshEventMessage("eh-1")).resolves.toMatchObject({ unchanged: true });
        expect(message.edit).toHaveBeenCalledTimes(1);

        getEvent.mockReturnValue(event({ message: { channelId: "c1", messageId: "m1", hash: "old" } }));
        const gone = Object.assign(new Error("Unknown Message"), { code: 10008 });
        const second = fakeDiscord({ fetchError: gone });
        await expect(refreshEventMessage("eh-1")).resolves.toEqual({ channelId: "c1", messageId: "m-new", reposted: true });
        expect(second.channel.send).toHaveBeenCalledTimes(1);

        fakeDiscord({ fetchError: new Error("Missing Access") });
        await expect(refreshEventMessage("eh-1")).rejects.toThrow("Missing Access");
        getEvent.mockReturnValue(null);
        await expect(refreshEventMessage("eh-x")).resolves.toBeNull();
    });

    it("sweeps: edits a message whose payload changed since it was drawn — a phase that passed, or a lost redraw", async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const base = event({ id: "eh-sw", signupDeadline: nowSec + 3600, startTime: nowSec + 7200 });
        const drawn = payloadHash(buildEventMessage(base, signups, { now: Date.now() }));
        const current = { ...base, message: { channelId: "c1", messageId: "m1", hash: drawn } };
        listEvents.mockReturnValue([current, event({ id: "eh-nomsg" })]);
        getEvent.mockImplementation(() => current);
        const { message } = fakeDiscord();
        // nothing changed: no edit
        await sweepEventMessages();
        expect(message.edit).not.toHaveBeenCalled();
        // a roster change whose redraw was lost (the bot restarted within the debounce)
        listSignups.mockReturnValue([...signups, su("8", "Devire", "Mage-Arcane", "ranged", "bench")]);
        await sweepEventMessages();
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(message.edit.mock.calls[0][0].embeds[0].fields.some((f) => f.value.includes("Bank (1): `8` Devire"))).toBe(true);
        // the deadline passed: the buttons change
        current.message.hash = payloadHash(message.edit.mock.calls[0][0]);
        await sweepEventMessages();
        expect(message.edit).toHaveBeenCalledTimes(1);
        current.signupDeadline = nowSec - 60;
        await sweepEventMessages();
        expect(message.edit).toHaveBeenCalledTimes(2);
    });

    it("never lets two redraws of one event overlap: the later payload lands last", async () => {
        let current = event({ message: { channelId: "c1", messageId: "m1" } });
        getEvent.mockImplementation(() => current);
        const { message } = fakeDiscord();
        const order = [];
        let release;
        message.edit.mockImplementationOnce((p) => new Promise((resolve) => {
            release = () => {
                order.push(p.embeds[0].title);
                resolve();
            };
        }));
        message.edit.mockImplementation(async (p) => order.push(p.embeds[0].title));
        const first = redrawEventMessage("eh-1");
        await new Promise(jest.requireActual("timers").setImmediate);
        current = event({ title: "Neu", message: { channelId: "c1", messageId: "m1" } });
        const second = redrawEventMessage("eh-1");
        await new Promise(jest.requireActual("timers").setImmediate);
        expect(order).toEqual([]);
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(["Kara Donnerstag", "Neu"]);
    });

    it("redraws at once on the first roster change, then once per burst after the quiet window", async () => {
        jest.useFakeTimers();
        const flush = async () => {
            for (let i = 0; i < 5; i++) await new Promise(jest.requireActual("timers").setImmediate);
        };
        try {
            let n = 0;
            getEvent.mockImplementation(() => event({ title: `Stand ${n}`, message: { channelId: "c1", messageId: "m1" } }));
            const { message } = fakeDiscord();
            const stop = startEventMessageSync({ debounceMs: 1000, sweepMs: 0 });
            expect(startEventMessageSync()).toBe(stop); // idempotent
            mockListeners.forEach((fn) => fn("eh-1"));
            jest.advanceTimersByTime(0);
            await flush();
            expect(message.edit).toHaveBeenCalledTimes(1);
            // two more changes inside the window: one redraw at its end, with the newest state
            n = 2;
            mockListeners.forEach((fn) => { fn("eh-1"); fn("eh-1"); });
            jest.advanceTimersByTime(500);
            await flush();
            expect(message.edit).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(600);
            await flush();
            expect(message.edit).toHaveBeenCalledTimes(2);
            expect(message.edit.mock.calls[1][0].embeds[0].title).toBe("Stand 2");
            stop();
            expect(mockListeners).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
