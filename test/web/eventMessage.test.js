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

    it("speaks English to the raiders: roles, classes, statuses, buttons, select; dates only as Discord timestamps", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), signups, { now: NOW });
        const text = JSON.stringify(payload);
        for (const word of ["Healers", "Ranged", "Melee", "Priest", "Late", "Tentative", "Absence", "Leader", "Deadline", "Sign up – pick a character or class …", "Warrior", "Druid"]) {
            expect(text).toContain(word);
        }
        for (const german of ["Heiler", "Fernkampf", "Nahkampf", "Priester", "Spät", "Vielleicht", "Abgemeldet", "Absagen", "Leitung", "Anmeldeschluss", "Krieger", "Druide", "Uhr"]) {
            expect(text).not.toContain(german);
        }
        // every date in the embed is a Discord timestamp, never written out
        const embedText = JSON.stringify(payload.embeds[0]);
        expect(embedText).toMatch(/<t:2000000000:D>/);
        expect(embedText).not.toMatch(/\d{1,2}\.\d{1,2}\.(\d{2,4})?/);
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

    it("builds the head as three columns of icon + value, the rows directly under each other", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), signups, { emojis, now: NOW });
        const embed = payload.embeds[0];
        // the title as letter tiles opens the description (an embed title cannot show emojis)
        expect(embed.title).toBeUndefined();
        expect(embed.color).toBe(7);
        expect(emojiless(embed.description).split("\n")).toEqual([
            `${"KARA".split("").map((c) => `<:eh_ta_${c.toLowerCase()}>`).join("")}   ${"DONNERSTAG".split("").map((c) => `<:eh_ta_${c.toLowerCase()}>`).join("")}`,
            "",
            "Treffpunkt Eingang",
        ]);
        // one field per column, its rows as lines — no empty field name between them
        expect(embed.fields.slice(0, 3).map((f) => [f.name, emojiless(f.value).split("\n"), f.inline])).toEqual([
            [ZWS, ["<:eh_ui_leader> <@7>", "<:eh_ui_date> <t:2000000000:D>"], true],
            [ZWS, ["<:eh_ui_signups> **5** / 10", "<:eh_ui_time> <t:2000000000:t>"], true],
            [ZWS, ["<:eh_ui_deadline> <t:1999990000:f>", "<:eh_ui_start> <t:2000000000:R>"], true],
        ]);
        // no end time: a duration nobody set would only show the default
        expect(JSON.stringify(embed)).not.toMatch(/eh_ui_end|Ende/);
        const links = embed.fields[embed.fields.length - 1].value;
        // #308: the public event page first, the menu beside it, and the event's
        // own calendar file (no icsUrl was passed).
        expect(links).toBe("[Event](https://eh.example/e/eh-1)  ·  [Sign up](https://eh.example/signups?event=eh-1)  ·  [Calendar](https://eh.example/r/cal/eh-1.ics)");
        expect(links).not.toContain("Setup");
    });

    it("keeps the countdown beside date and time without a deadline: an empty first line", () => {
        const embed = buildEventMessage(event(), signups, { emojis, now: NOW }).embeds[0];
        expect(emojiless(embed.fields[2].value).split("\n")).toEqual([ZWS, "<:eh_ui_start> <t:2000000000:R>"]);
    });

    it("puts the voice channel under the date, only when there is one (#305) — and never an end time", () => {
        const embed = buildEventMessage(event({ durationMinutes: 240, voiceChannelId: "v9" }), signups, { emojis, now: NOW }).embeds[0];
        expect(emojiless(embed.fields[0].value).split("\n")[2]).toBe("<:eh_ui_voice> <#v9>");
        expect(JSON.stringify(embed)).not.toContain("2000014400");
        // without the application emojis the label leads the line
        const plain = buildEventMessage(event({ voiceChannelId: "v9" }), signups, { now: NOW }).embeds[0];
        expect(plain.fields[0].value.split("\n")[2]).toBe("Voice channel: <#v9>");
    });

    it("sets the role totals apart as columns with the style's role icons, the healers directly below the tanks, then an empty line", () => {
        const embed = buildEventMessage(event(), signups, { emojis, now: NOW }).embeds[0];
        expect(embed.fields.slice(3, 7).map((f) => [f.name, emojiless(f.value), f.inline])).toEqual([
            [ZWS, "<:eh_ra_tank> Tanks **2**/2\n<:eh_ra_healer> Healers **1**/3", true],
            [ZWS, "<:eh_ra_ranged> Ranged **2**", true],
            // melee is two crossed swords
            [ZWS, "<:eh_ra_swords> Melee **0**", true],
            [ZWS, ZWS, false],
        ]);
        // the colourful WoW role icons are no longer used in the message
        expect(JSON.stringify(embed)).not.toContain("eh_role_");
        // "plain" draws the flat grey ones
        const plain = buildEventMessage(event({ emojiStyle: "plain" }), signups, { emojis, now: NOW }).embeds[0];
        expect(emojiless(plain.fields[3].value)).toBe("<:eh_ui_tank> Tanks **2**/2\n<:eh_ui_healer> Healers **1**/3");
    });

    it("draws title tiles and role icons in the event's emoji style", () => {
        const gold = buildEventMessage(event({ title: "Hyjal+BT", emojiStyle: "gold" }), signups, { emojis, now: NOW }).embeds[0];
        expect(emojiless(gold.description).split("\n")[0])
            .toBe("<:eh_tg_h><:eh_tg_y><:eh_tg_j><:eh_tg_a><:eh_tg_l><:eh_tg_plus><:eh_tg_b><:eh_tg_t>");
        expect(emojiless(gold.fields[3].value)).toMatch(/^<:eh_rg_tank> Tanks/);
        const parchment = buildEventMessage(event({ emojiStyle: "parchment" }), signups, { emojis, now: NOW }).embeds[0];
        expect(parchment.description).toContain("eh_tp_k");
        expect(parchment.fields[4].value).toContain("eh_rp_ranged");
    });

    it("keeps the plain title where the tiles cannot stand in", () => {
        const title = (over, map = emojis) => {
            const embed = buildEventMessage(event(over), signups, { emojis: map, now: NOW }).embeds[0];
            return embed.title || null;
        };
        // "plain", a character without a tile, a title longer than 32 characters
        expect(title({ emojiStyle: "plain" })).toBe("Kara Donnerstag");
        expect(title({ title: "Kara (10er)" })).toBe("Kara (10er)");
        expect(title({ title: "A".repeat(33) })).toBe("A".repeat(33));
        // the tiles not uploaded yet: the plain title, and the flat role icons stand in
        const flatOnly = Object.fromEntries(Object.entries(emojis).filter(([name]) => !/^eh_[tr][agp]_/.test(name)));
        expect(title({}, flatOnly)).toBe("Kara Donnerstag");
        const embed = buildEventMessage(event(), signups, { emojis: flatOnly, now: NOW }).embeds[0];
        expect(embed.fields[3].value).toContain("eh_ui_tank");
        // a cancelled event says so in plain text
        expect(title({ status: "cancelled" })).toBe("Cancelled: Kara Donnerstag");
        // umlauts become two tiles, lower case is upper case
        expect(emojiless(buildEventMessage(event({ title: "Höhle" }), signups, { emojis, now: NOW }).embeds[0].description).split("\n")[0])
            .toBe("<:eh_ta_h><:eh_ta_o><:eh_ta_e><:eh_ta_h><:eh_ta_l><:eh_ta_e>");
    });

    it("shows melee/ranged targets as minimum or range", () => {
        const payload = buildEventMessage(event({ composition: { tank: 2, healer: 3, melee: 2, ranged: 1 }, compositionMax: { melee: 4 } }), [], { now: NOW });
        const values = payload.embeds[0].fields.slice(3, 6).map((f) => f.value);
        expect(values).toContain("Melee **0**/2–4");
        expect(values).toContain("Ranged **0**/1+");
    });

    it("puts tanks in their own block first, then one block per class in fixed order, with an empty line under each", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        const blocks = payload.embeds[0].fields.slice(7).filter((f) => f.inline && f.name !== ZWS);
        // the Tanks block wears the Protection Warrior's icon
        expect(blocks.map((b) => emojiless(b.name))).toEqual(["<:eh_warrior_protection> __Tanks__ (2)", "<:eh_class_priest> __Priest__ (1)", "<:eh_class_mage> __Mage__ (1)"]);
        expect(blocks[0].value.split("\n")).toEqual([
            expect.stringMatching(/^<:eh_warrior_protection:\d+> `1` \*\*Brokk\*\*$/),
            expect.stringMatching(/^<:eh_druid_guardian:\d+> `7` \*\*Gemli\*\*$/),
            ZWS,
        ]);
        expect(blocks[1].value).toMatch(/<:eh_priest_shadow:\d+> `6` \*\*Thalia\*\*/);
    });

    it("fills the last row of blocks up to two columns, so it stays aligned with the rows above (#351)", () => {
        const blocksOf = (list) => {
            const fields = buildEventMessage(event(), list, { emojis, now: NOW }).embeds[0].fields;
            return fields.slice(fields.findIndex((f) => f.name.includes("__Tanks__"))).filter((f) => f.inline);
        };
        // Tanks · Priest · Mage: an odd block count, one empty column added
        const three = blocksOf(signups);
        expect(three.length).toBe(4);
        expect(three[3]).toEqual({ name: ZWS, value: ZWS, inline: true });
        // plus Rogue: four blocks, a full second row already
        const four = blocksOf([...signups, su("8", "Dvra", "Rogue-Combat", "melee")]);
        expect(four.length).toBe(4);
        expect(four.every((f) => f.name !== ZWS)).toBe(true);
        // plus Warlock as well: five blocks, one empty column at the end again
        const five = blocksOf([...signups, su("8", "Dvra", "Rogue-Combat", "melee"), su("9", "Hypnos", "Warlock-Destruction", "ranged")]);
        expect(five.length).toBe(6);
        expect(five[5]).toEqual({ name: ZWS, value: ZWS, inline: true });
    });

    it("lists every character of a signup in the block of its own status, under one number — only the first one counts", () => {
        const multi = { ...su("9", "Zibbo", "Priest-Holy", "healer", "late"), characters: [
            { character: "Zibbo", spec: "Priest-Holy", role: "healer", status: "late" },
            { character: "Zibbowar", spec: "Warrior-Protection", role: "tank", status: "signed" },
            { character: "Zibbomage", spec: "Mage-Fire", role: "ranged" },
        ] };
        const payload = buildEventMessage(event(), [...signups, multi], { emojis, now: NOW });
        const fields = payload.embeds[0].fields;
        const tank = fields.find((f) => f.inline && f.name.includes("__Tanks__"));
        // Zibbowar is a further character: listed, not bold, below the first characters, not counted
        expect(tank.name).toMatch(/__Tanks__ \(2\)$/);
        expect(tank.value.split("\n").slice(0, 3)).toEqual([
            expect.stringMatching(/`1` \*\*Brokk\*\*$/),
            expect.stringMatching(/`7` \*\*Gemli\*\*$/),
            expect.stringMatching(/`8` Zibbowar$/),
        ]);
        // a character without its own status has the signup's (late); one raider counts once
        const other = fields.find((f) => !f.inline && f.value.includes("Late"));
        expect(other.value.split("\n")[0]).toMatch(/Late \(2\): `2` Ysolde, `8` Zibbo \/ Zibbomage$/);
        expect(JSON.stringify(payload)).not.toContain("+1");
        // one seat per person: Zibbo is late, so 5 + 1 attend, the tank count stays per person
        expect(emojiless(fields[1].value).split("\n")[0]).toBe("<:eh_ui_signups> **6** / 10");
        expect(fields[3].value).toMatch(/Healers \*\*2\*\*\/3/);
        expect(rosterEntries([multi]).map((e) => [e.character, e.status, e.index])).toEqual([
            ["Zibbo", "late", 0], ["Zibbowar", "signed", 1], ["Zibbomage", "late", 2],
        ]);
    });

    it("lists late, tentative, bench and absence as lines with icon, count and number boxes", () => {
        const payload = buildEventMessage(event(), [...signups, su("8", "Bänki", "Mage-Frost", "ranged", "bench")], { emojis, now: NOW });
        const other = payload.embeds[0].fields.find((f) => !f.inline && f.value.includes("Late"));
        expect(other.name).toBe(ZWS);
        expect(other.value.split("\n").map(emojiless)).toEqual([
            "<:eh_ui_late> Late (1): `2` Ysolde",
            "<:eh_ui_tentative> Tentative (1): `4` Kael",
            "<:eh_ui_bench> Bench (1): `8` Bänki",
            "<:eh_ui_absence> Absence (1): `5` <@5>",
        ]);
    });

    it("reads each character's own status: a first character on Bank is in the Bank line, never under Abgemeldet", () => {
        // the case of the screenshot in #303: signed off before, then Bank
        const devire = { userId: "11", status: "bench", character: "Devire", spec: "Mage-Arcane", role: "ranged", at: 11, comment: "Arbeit",
            characters: [{ character: "Devire", spec: "Mage-Arcane", role: "ranged", status: "bench" }] };
        const lines = (list) => buildEventMessage(event(), list, { now: NOW }).embeds[0].fields.find((f) => !f.inline && f.name === ZWS && /Bench|Absence/.test(f.value));
        expect(lines([devire]).value).toBe("Bench (1): `1` Devire");
        // the first character on Bank, the second still signed: both where their own status puts them
        const two = { ...devire, characters: [devire.characters[0], { character: "Devheal", spec: "Priest-Holy", role: "healer", status: "signed" }] };
        const payload = buildEventMessage(event(), [two], { now: NOW });
        // Devheal is the second character: shown, but not bold and not counted
        const priest = payload.embeds[0].fields.find((f) => f.name.startsWith("__Priest__"));
        expect(priest.value).toContain("`1` Devheal");
        expect(priest.value).not.toContain("**Devheal**");
        expect(priest.name).toBe("__Priest__ (0)");
        expect(lines([two]).value).toBe("Bench (1): `1` Devire");
        // an absence is one line per person, whatever its characters stored
        expect(lines([{ ...devire, status: "absence", characters: [{ character: "Devire", spec: "Mage-Arcane" }] }]).value).toBe("Absence (1): `1` Devire");
    });

    it("reads the same without application emojis — labels in the head, spec names, no colourful unicode", () => {
        const payload = buildEventMessage(event({ signupDeadline: 1999990000 }), [...signups, su("8", "Bänki", "Mage-Frost", "ranged", "bench")], { now: NOW });
        const json = JSON.stringify(payload);
        expect(json).not.toMatch(/<:eh_/);
        expect(json).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
        const embed = payload.embeds[0];
        expect(embed.fields.slice(0, 3).map((f) => f.value)).toEqual([
            "Leader: <@7>\nDate: <t:2000000000:D>",
            "Signed up: **5** / 10\nTime: <t:2000000000:t>",
            "Deadline: <t:1999990000:f>\nStart: <t:2000000000:R>",
        ]);
        expect(embed.fields[3].value).toBe("Tanks **2**/2\nHealers **1**/3");
        const blocks = embed.fields.slice(7).filter((f) => f.inline);
        expect(blocks[0]).toMatchObject({ name: "__Tanks__ (2)", value: `\`1\` **Brokk** · Protection\n\`7\` **Gemli** · Feral (Bear)\n${ZWS}` });
        expect(blocks[1].name).toBe("__Priest__ (1)");
        expect(embed.fields.find((f) => !f.inline && f.value.includes("Late")).value.split("\n")[0]).toBe("Late (1): `2` Ysolde");
        const components = payload.components.flatMap((r) => r.components);
        expect(components.every((b) => b.emoji === undefined)).toBe(true);
        expect(components[0].options.every((o) => o.emoji === undefined)).toBe(true);
    });

    it("escapes markdown and mentions in character names", () => {
        const payload = buildEventMessage(event(), [su("1", "*Bold*_@everyone", "Mage-Arcane", "ranged")], { now: NOW });
        const block = payload.embeds[0].fields.find((f) => f.name.startsWith("__Mage__"));
        expect(block.value).toContain("\\*Bold\\*\\_@​everyone");
    });

    it("offers the signup select (Meine Charaktere … and the classes) and one row of status buttons before the deadline", () => {
        const payload = buildEventMessage(event(), signups, { emojis, now: NOW });
        expect(payload.components).toHaveLength(2);
        const [[select], buttons] = payload.components.map((r) => r.components);
        expect(select).toMatchObject({ type: 3, custom_id: "event-pick:eh-1", min_values: 1, max_values: 1 });
        expect(select.options[0]).toMatchObject({ label: "My characters …", value: "mine", emoji: { name: "eh_ui_signups" } });
        expect(select.options.slice(1).map((o) => o.value)).toEqual(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]);
        expect(select.options[1].emoji.name).toBe("eh_class_warrior");
        expect(select.options.length).toBeLessThanOrEqual(25);
        // the public select is the same for everybody: no own characters in it
        expect(select.options.some((o) => o.value.includes("|"))).toBe(false);
        expect(buttons.map((b) => [b.label, b.custom_id, b.style])).toEqual([
            ["Late", "event-btn:eh-1:late", 2],
            ["Tentative", "event-btn:eh-1:tentative", 2],
            ["Bench", "event-btn:eh-1:bench", 2],
            ["Absence", "event-btn:eh-1:absence", 4],
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
        expect(late.embeds[0].description).toContain("signup deadline has passed");
        const started = buildEventMessage(event({ startTime: 1998000000 }), signups, { now: NOW });
        expect(started.components).toEqual([]);
        expect(started.embeds[0].description).toContain("The raid has started");
    });

    describe("Farbe und Bild (#307)", () => {
        it("nimmt ohne eigene Werte nur die Farbe der führenden Instanz, kein automatisches Boss-Icon (#353)", () => {
            const embed = buildEventMessage(event({ instanceIds: ["ssc", "tk"] }), signups, { emojis, now: NOW }).embeds[0];
            expect(embed.color).toBe(0x1f8ba5);
            expect(embed.thumbnail).toBeUndefined();
            expect(embed.image).toBeUndefined();
        });

        it("nimmt die eigene Farbe und das eigene Bild, Banner unten statt oben", () => {
            const embed = buildEventMessage(
                event({ instanceIds: ["ssc"], color: "#ff8800", image: { mode: "banner", url: "https://cdn.example/raid.png" } }),
                signups, { emojis, now: NOW },
            ).embeds[0];
            expect(embed.color).toBe(0xff8800);
            expect(embed.image).toEqual({ url: "https://cdn.example/raid.png" });
            expect(embed.thumbnail).toBeUndefined();
        });

        it("setzt mit raidArt das Raid-Bild der führenden Instanz unter die Nachricht, ohne Boss-Icon daneben", () => {
            const embed = buildEventMessage(event({ instanceIds: ["hyjal", "bt", "gruul"] }), signups, { emojis, now: NOW, raidArt: true }).embeds[0];
            expect(embed.image).toEqual({ url: "https://render.worldofwarcraft.com/eu/zones/the-battle-for-mount-hyjal-small.jpg" });
            expect(embed.thumbnail).toBeUndefined();
            // an own banner stays in its place; without raidArt nothing changes
            const own = buildEventMessage(event({ instanceIds: ["bt"], image: { mode: "banner", url: "https://cdn.example/raid.png" } }), signups, { emojis, now: NOW, raidArt: true }).embeds[0];
            expect(own.image).toEqual({ url: "https://cdn.example/raid.png" });
            expect(buildEventMessage(event({ instanceIds: ["bt"] }), signups, { emojis, now: NOW }).embeds[0].image).toBeUndefined();
            // a cancelled event loses it like every picture
            expect(buildEventMessage(event({ instanceIds: ["bt"], status: "cancelled" }), signups, { emojis, now: NOW, raidArt: true }).embeds[0].image).toBeUndefined();
        });

        it("vergrößert die Buchstaben-Kacheln des Titels mit einer Überschrift", () => {
            const first = (titleSize) => buildEventMessage(event(), signups, { emojis, now: NOW, titleSize }).embeds[0].description.split("\n")[0];
            expect(first("large")).toMatch(/^## <:eh_ta_k:/);
            expect(first("huge")).toMatch(/^# <:eh_ta_k:/);
            expect(first("normal")).toMatch(/^<:eh_ta_k:/);
            expect(first(undefined)).toMatch(/^<:eh_ta_k:/);
        });

        it("ohne Instanz und ohne eigene Farbe bleibt es bei der Akzentfarbe, ohne Bild", () => {
            const embed = buildEventMessage(event(), signups, { emojis, now: NOW }).embeds[0];
            expect(embed.color).toBe(7);
            expect(embed.thumbnail).toBeUndefined();
            expect(embed.image).toBeUndefined();
        });

        it("eine kaputte Bild-Adresse verhindert die Nachricht nicht", () => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
            const payload = buildEventMessage(event({ image: { mode: "banner", url: "http://kaputt/x.png" } }), signups, { emojis, now: NOW });
            expect(payload.embeds[0].image).toBeUndefined();
            expect(payload.embeds[0].fields.length).toBeGreaterThan(0);
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it("ein abgesagtes Event behält den roten Balken und verliert das Bild", () => {
            const embed = buildEventMessage(
                event({ status: "cancelled", cancel: { reason: "zu wenige Heiler" }, instanceIds: ["ssc"], color: "#ff8800" }),
                signups, { emojis, now: NOW },
            ).embeds[0];
            expect(embed.color).not.toBe(0xff8800);
            expect(embed.thumbnail).toBeUndefined();
            expect(embed.image).toBeUndefined();
        });

        it("das Bild zählt nicht gegen die 6000 Zeichen, der Hash ändert sich damit aber", () => {
            const plain = buildEventMessage(event({ instanceIds: [] }), signups, { emojis, now: NOW });
            const pretty = buildEventMessage(event({ instanceIds: ["ssc"] }), signups, { emojis, now: NOW });
            expect(embedLength(pretty.embeds[0])).toBe(embedLength(plain.embeds[0]));
            expect(payloadHash(pretty)).not.toBe(payloadHash(plain));
        });
    });

    it("shows a cancelled or closed event without components (#288)", () => {
        const cancelled = buildEventMessage(event({ status: "cancelled", cancelReason: "zu wenige Heiler" }), signups, { now: NOW });
        expect(cancelled.embeds[0].title).toBe("Cancelled: Kara Donnerstag");
        expect(cancelled.embeds[0].description).toContain("Cancelled** – zu wenige Heiler");
        expect(cancelled.embeds[0].color).not.toBe(7);
        expect(cancelled.components).toEqual([]);
        const closed = buildEventMessage(event({ status: "closed" }), signups, { now: NOW });
        expect(closed.embeds[0].description).toContain("Signups closed");
        expect(closed.components).toEqual([]);
        expect(messagePhase(event({ status: "closed" }), NOW)).toBe("closed");
        expect(messagePhase(event(), NOW)).toBe("open");
    });

    it("reads the store's shape of Event verwalten: the reason in cancel, a closed signup still takes sign-offs (#288)", () => {
        const cancelled = buildEventMessage(event({ status: "cancelled", cancel: { reason: "Zu wenig Heiler" } }), signups, { now: NOW });
        expect(cancelled.embeds[0].description).toContain("Cancelled** – Zu wenig Heiler");
        expect(cancelled.components).toEqual([]);
        const closed = buildEventMessage(event({ status: "active", signupsClosed: true }), signups, { now: NOW });
        expect(messagePhase(event({ signupsClosed: true }), NOW)).toBe("closed");
        expect(closed.embeds[0].description).toContain("Signups closed** – you can still sign off.");
        expect(closed.components).toEqual([{ type: 1, components: [expect.objectContaining({ label: "Absence", custom_id: "event-btn:eh-1:absence" })] }]);
        // a raid that started is "started", closed or not
        expect(messagePhase(event({ signupsClosed: true, startTime: 1998000000 }), NOW)).toBe("started");
    });

    it("cuts a long block with +N weitere and keeps every field within Discord's limits", () => {
        expect(blockValue(["a", "b", "c"], 2)).toBe("a\nb\n+1 more");
        expect(blockValue(["a", "b"], 2)).toBe("a\nb");
        expect(blockValue([], 2)).toBe(ZWS);
        const long = Array.from({ length: 30 }, (_, i) => "x".repeat(60) + i);
        const value = blockValue(long, 40);
        expect(value.length).toBeLessThanOrEqual(1024);
        expect(value).toMatch(/\+\d+ more$/);

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
        const warriors = embed.fields.find((f) => f.name.includes("__Warrior__ (40)"));
        expect(warriors.value).toMatch(/\+\d+ more\n​$/);
    });

    it("fits 40 signups over every class and all links (setup included) into 25 fields — the spacers go first", () => {
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
        // every class block, the status lines and the links (incl. the Setup link) are all there
        for (const cls of ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"]) {
            expect(names.some((n) => n.includes(`__${cls}__`))).toBe(true);
        }
        expect(names.some((n) => n.includes("__Tanks__"))).toBe(true);
        expect(embed.fields.some((f) => f.value.includes("Absence ("))).toBe(true);
        expect(embed.fields[embed.fields.length - 1].value).toContain("[Setup]");
        expect(embed.fields[embed.fields.length - 1].value).toContain("[Calendar]");
        expect(embed.fields.every((f) => Object.keys(f).sort().join() === "inline,name,value")).toBe(true);
    });

    it("links the approved setup instead of repeating its groups — that's the setup message's own job (#352)", () => {
        const approved = { groups: [{ index: 1, slots: [{ character: "Brokk" }] }], bench: [{ character: "Kael" }] };
        const payload = buildEventMessage(event({ setup: { status: "approved", approved } }), signups, { now: NOW, icsUrl: "https://eh.example/ics/eh-1.ics" });
        const fields = payload.embeds[0].fields;
        expect(fields.some((f) => emojiless(f.name) === "Setup")).toBe(false);
        const links = fields[fields.length - 1].value;
        expect(links).toBe("[Event](https://eh.example/e/eh-1)  ·  [Sign up](https://eh.example/signups?event=eh-1)  ·  [Setup](https://eh.example/raids/detail?event=eh-1&tab=setup)  ·  [Calendar](https://eh.example/ics/eh-1.ics)");

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
        expect(message.edit.mock.calls[0][0].embeds[0].fields.some((f) => f.value.includes("Bench (1): `8` Devire"))).toBe(true);
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
