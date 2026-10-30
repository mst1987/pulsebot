// /availability und das Panel der Ab-/Anwesenheiten im Discord: Knöpfe → Modal →
// Raid-Auswahl → Speichern (mit DM), „Meine Einträge“ mit Löschen, abgelaufene
// Auswahl, Fehler auf Englisch.
const { MessageFlags } = require("discord.js");
const { answerOf } = require("../../helpers/signupMocks");
const { cardText } = require("../../helpers/cardText");

jest.mock("../../../src/stores/events/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/events/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settings/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => ({
    ...require("../../helpers/signupMocks").discord(),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "dm" })),
    // the DM fallback of /availability asks which servers the raider is on
    guildMembership: jest.fn(async () => true),
    // server names for "My entries" (from the bot's cache, no request)
    getGuild: jest.fn((id) => (id === "g1" ? { name: "Pulse", iconURL: () => "" } : null)),
    // the guild bank's orga post
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: "m-bank", url: "" })),
}));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const discord = require("../../../src/services/discord/discord");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const store = require("../../../src/stores/events/availabilityStore");
const sessionStore = require("../../../src/stores/events/availabilitySessionStore");
const bankStore = require("../../../src/stores/loot/guildBankStore");
const availability = require("../../../src/services/signups/availability");
const organizer = require("../../../src/services/signups/organizer");
const command = require("../../../src/commands/signup/availability");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const DAY = 86400;
const sec = () => Math.floor(Date.now() / 1000);
const dayPlus = (n) => availability.dayOf(sec() + n * DAY);

beforeAll(() => {
    profiles.useFile(tempStoreFile("eh-cmd-availability-profiles.json"));
    store.useFile(tempStoreFile("eh-cmd-availability.json"));
    sessionStore.useFile(tempStoreFile("eh-cmd-availability-sessions.json"));
    bankStore.useFile(tempStoreFile("eh-cmd-guild-bank.json"));
});
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
    store.useFile(null);
    bankStore.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.access.config = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } } };
    for (const e of store.listEntries()) store.removeEntry(e.id);
    discord.sendDirectMessage.mockClear();
    for (const [id, days, cat] of [["eh-a", 2, "cat1"], ["eh-b", 3, "cat1"], ["eh-c", 3, "cat2"]]) {
        mocks.events.set(id, mocks.ownEvent({ id, title: `Raid ${id}`, categoryId: cat, startTime: sec() + days * DAY, signupDeadline: sec() + days * DAY - 3600 }));
    }
});

const withCharacters = () => {
    profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
    profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }] });
};
const click = (customId, extra = {}) => mockInteraction({ customId, userId: ANNA, ...extra });
const submit = (customId, fields) => mockInteraction({ customId, userId: ANNA, modal: true, options: fields });
const select = (customId, values) => mockInteraction({ customId, userId: ANNA, values });
const replyPayload = (i) => i.reply.mock.calls[0][0];
const componentIds = (payload) => payload.components.flatMap((row) => row.components.map((c) => c.data.custom_id).filter(Boolean));
const tokenOf = (payload) => componentIds(payload).find((id) => /^availability:[a-f0-9]{8}:save$/.test(id)).split(":")[1];
const raidSelect = (payload) => payload.components.map((r) => r.components[0]).find((c) => /:r$/.test(c.data.custom_id || ""));

describe("/availability", () => {
    it("ist ein Befehl für alle mit gleichnamigen Knöpfen", () => {
        expect(command).toMatchObject({ name: "availability", group: "signup", defaultAccess: "everyone" });
        expect(command.data.name).toBe("availability");
    });

    it("zeigt die eigenen Einträge und die drei Knöpfe, nur für den Raider", async () => {
        const i = mockInteraction({ userId: ANNA, commandName: "availability" });
        await command.execute(i);
        const payload = replyPayload(i);
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(answerOf(payload).description).toContain("No absence or attendance entered.");
        expect(componentIds(payload)).toEqual(["availability:a:", "availability:p:", "availability:l:"]);
    });
});

describe("Abwesenheit", () => {
    it("Knopf → Modal der Kategorie → Auswahl der Raids → Speichern meldet ab und schickt die DM", async () => {
        const btn = click("availability:a:cat1");
        await command.execute(btn);
        expect(btn.showModal.mock.calls[0][0].data.custom_id).toBe("availability:ma:cat1");

        const modal = submit("availability:ma:cat1", { from: dayPlus(0), to: dayPlus(5), reason: "Urlaub" });
        await command.execute(modal);
        const picker = replyPayload(modal);
        expect(picker.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(answerOf(picker).description).toContain("Reason: Urlaub");
        expect(answerOf(picker).description).toContain("Pick the raids to sign off from (2 of 2).");
        // only the panel's category, every raid picked at first
        expect(raidSelect(picker).options.map((o) => [o.data.value, o.data.default])).toEqual([["eh-a", true], ["eh-b", true]]);

        const token = tokenOf(picker);
        const pick = select(`availability:${token}:r`, ["eh-b"]);
        await command.execute(pick);
        expect(answerOf(pick.update.mock.calls[0][0]).description).toContain("(1 of 2)");

        const save = click(`availability:${token}:save`);
        await command.execute(save);
        expect(save.deferUpdate).toHaveBeenCalled();
        const done = answerOf(save.editReply.mock.calls[0][0]);
        expect(done.title).toBe("Absence saved");
        expect(done.description).toContain("**Signed off from:**");
        expect(mocks.signups.get(`eh-b/${ANNA}`)).toMatchObject({ status: "absence", comment: "Urlaub" });
        expect(mocks.signups.get(`eh-a/${ANNA}`)).toBeUndefined();
        expect(mocks.signups.get(`eh-c/${ANNA}`)).toBeUndefined();
        expect(store.listEntries({ userId: ANNA })[0]).toMatchObject({ scope: [{ guildId: "g1", categoryIds: ["cat1"] }], skip: ["eh-a"], via: "panel" });
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);

        // the session is over
        const again = click(`availability:${token}:save`);
        await command.execute(again);
        expect(answerOf(again.update.mock.calls[0][0]).description).toMatch(/expired/);
    });

    it("lehnt ein unlesbares Datum auf Englisch ab", async () => {
        const modal = submit("availability:ma:", { from: "irgendwann", to: "" });
        await command.execute(modal);
        // what was typed, how to write it, and one click back into the modal
        expect(answerOf(replyPayload(modal)).description).toBe("⚠️ I could not read **irgendwann** as a date. Write it like **24.10.**, **24.10.2026**, **24 Oct** or a whole period like **24.10.-31.10.**");
        expect(answerOf(replyPayload(modal)).components.map((c) => c.custom_id || (c.data && c.data.custom_id))).toEqual(["availability:a:"]);
        expect(store.listEntries()).toEqual([]);
    });

    it("„Cancel“ speichert nichts", async () => {
        const modal = submit("availability:ma:", { from: dayPlus(1), to: "" });
        await command.execute(modal);
        const cancel = click(`availability:${tokenOf(replyPayload(modal))}:x`);
        await command.execute(cancel);
        expect(answerOf(cancel.update.mock.calls[0][0]).description).toContain("nothing was saved");
        expect(store.listEntries()).toEqual([]);
    });
});

describe("Geltungsbereich je Server", () => {
    const TWO = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" }, g2: { botLanguage: "en" } }, discordServers: { servers: [{ guildId: "g1", label: "Pulse" }, { guildId: "g2", label: "PuGs" }] } };
    const absent = () => submit("availability:ma:", { from: dayPlus(0), to: dayPlus(5), reason: "Urlaub" });
    const saveFrom = async (modal) => {
        await command.execute(modal);
        const save = click(`availability:${tokenOf(replyPayload(modal))}:save`);
        await command.execute(save);
        return store.listEntries({ userId: ANNA })[0];
    };
    afterEach(() => discord.guildMembership.mockReset().mockImplementation(async () => true));

    it("/availability ohne Kategorie gilt auf dem Server, auf dem der Befehl lief", async () => {
        mocks.access.config = TWO;
        const modal = mockInteraction({ customId: "availability:ma:", userId: ANNA, modal: true, options: { from: dayPlus(0), to: dayPlus(5) }, guild: { id: "g2" } });
        const entry = await saveFrom(modal);
        expect(entry.scope).toEqual([{ guildId: "g2", categoryIds: [] }]);
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });

    it("im DM: jeder Server mit Mitgliedschaft (unbekannt bleibt drin), sonst der erste Server", async () => {
        mocks.access.config = TWO;
        discord.guildMembership.mockImplementation(async (g) => (g === "g1" ? false : null));
        const dm = mockInteraction({ customId: "availability:ma:", userId: ANNA, modal: true, options: { from: dayPlus(0), to: dayPlus(5) }, guild: null });
        dm.guild = null;
        expect((await saveFrom(dm)).scope).toEqual([{ guildId: "g2", categoryIds: [] }]);

        store.removeEntry(store.listEntries({ userId: ANNA })[0].id);
        discord.guildMembership.mockImplementation(async () => false);
        const none = mockInteraction({ customId: "availability:ma:", userId: ANNA, modal: true, options: { from: dayPlus(0), to: dayPlus(5) } });
        none.guild = null;
        expect((await saveFrom(none)).scope).toEqual([{ guildId: "g1", categoryIds: [] }]);
    });

    it("ein Server außerhalb der Serverliste zählt wie ein DM", async () => {
        // mockInteraction's guild-1 is not configured
        const entry = await saveFrom(absent());
        expect(entry.scope).toEqual([{ guildId: "g1", categoryIds: [] }]);
        expect(discord.guildMembership).toHaveBeenCalledWith("g1", ANNA);
    });
});

describe("Anwesenheit", () => {
    it("ohne Charakter verweist der Knopf aufs Profil", async () => {
        const btn = click("availability:p:");
        await command.execute(btn);
        expect(btn.showModal).not.toHaveBeenCalled();
        expect(answerOf(replyPayload(btn)).description).toMatch(/no character/);
    });

    it("schlägt den ersten Charakter vor, lässt ihn wechseln und meldet als Dabei an", async () => {
        withCharacters();
        const btn = click("availability:p:");
        await command.execute(btn);
        expect(btn.showModal.mock.calls[0][0].data.custom_id).toBe("availability:mp:");

        const modal = submit("availability:mp:", { from: dayPlus(0), to: dayPlus(5) });
        await command.execute(modal);
        const picker = replyPayload(modal);
        expect(answerOf(picker).description).toContain("Character: **Zibbo** · Holy");
        expect(raidSelect(picker).options.map((o) => o.data.value)).toEqual(["eh-a", "eh-b", "eh-c"]);
        const token = tokenOf(picker);

        const swap = select(`availability:${token}:c`, ["zibbowar|Warrior-Protection"]);
        await command.execute(swap);
        expect(answerOf(swap.update.mock.calls[0][0]).description).toContain("Character: **Zibbowar** · Protection");

        const save = click(`availability:${token}:save`);
        await command.execute(save);
        expect(answerOf(save.editReply.mock.calls[0][0]).title).toBe("Attendance saved");
        expect(mocks.signups.get(`eh-a/${ANNA}`)).toMatchObject({ status: "signed", character: "Zibbowar", spec: "Warrior-Protection" });
    });
});

describe("Deutsch als Standard", () => {
    it("antwortet ohne eigene Wahl in der Server-Sprache Deutsch", async () => {
        mocks.access.config = {};
        const modal = submit("availability:ma:", { from: "irgendwann", to: "" });
        await command.execute(modal);
        expect(answerOf(replyPayload(modal)).description).toBe("⚠️ **irgendwann** kann ich nicht als Datum lesen. Schreib es z. B. als **24.10.**, **24.10.2026**, **24. Okt** oder gleich als Zeitraum **24.10.-31.10.**");
        const btn = click("availability:a:");
        await command.execute(btn);
        expect(btn.showModal.mock.calls[0][0].data.title).toBe("Abwesenheit eintragen");
    });
});

describe("Meine Einträge", () => {
    it("listet die Einträge und löscht einen über die Auswahl", async () => {
        const { entry } = await availability.createEntry(ANNA, { kind: "absence", from: dayPlus(10), to: dayPlus(12), comment: "Kur", scope: [{ guildId: "g1", categoryIds: [] }] }, { dm: false });
        const list = click("availability:l:cat1");
        await command.execute(list);
        const payload = replyPayload(list);
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(answerOf(payload).description).toMatch(/Away.*Kur/);

        const del = select("availability:del:cat1", [entry.id]);
        await command.execute(del);
        expect(answerOf(del.update.mock.calls[0][0]).description).toContain("Entry deleted.");
        expect(store.listEntries()).toEqual([]);
    });

    it("nennt Server und Kategorien des Eintrags und alle Charaktere einer Anwesenheit", async () => {
        withCharacters();
        mocks.access.config = { ...mocks.access.config, discordServers: { servers: [{ guildId: "g1", label: "Pulse" }] } };
        await availability.createEntry(ANNA, {
            kind: "presence", from: dayPlus(10), to: dayPlus(12), scope: [{ guildId: "g1", categoryIds: [] }],
            characters: [{ character: "zibbo", spec: "Priest-Holy" }, { character: "zibbowar", spec: "Warrior-Protection" }],
        }, { dm: false });
        const list = click("availability:l:");
        await command.execute(list);
        const text = answerOf(replyPayload(list)).description;
        expect(text).toContain("Pulse");
        expect(text).toMatch(/Zibbo · Holy.*Zibbowar · Protection/);
    });

    it("aus der eigenen (ephemeren) Liste heraus wird die Nachricht ersetzt", async () => {
        const list = click("availability:l:", { message: { flags: { has: (f) => f === MessageFlags.Ephemeral } } });
        await command.execute(list);
        expect(list.update).toHaveBeenCalled();
        expect(list.reply).not.toHaveBeenCalled();
    });
});

describe("Raider-Organizer: Mein Raid und Auswertung", () => {
    const embedOf = (payload) => payload.embeds[0].data || payload.embeds[0];
    const buttonsOf = (payload) => payload.components.flatMap((r) => r.toJSON().components);

    it("Mein Raid nennt den nächsten Raid der Kategorie und die eigene Anmeldung, nur für den Raider", async () => {
        mocks.signups.set(`eh-a/${ANNA}`, { userId: ANNA, status: "tentative", character: "Zibbo", spec: "Priest-Holy" });
        const i = click("availability:r:cat1");
        await command.execute(i);
        const payload = replyPayload(i);
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(embedOf(payload).title).toBe("Raid eh-a");
        expect(embedOf(payload).description).toContain("You are tentatively signed up as **Zibbo** · Holy.");
        expect(i.showModal).not.toHaveBeenCalled();
    });

    it("Mein Raid sagt, wenn der Raider nicht angemeldet ist, und wählt den früheren Raid der Kategorie", async () => {
        const i = click("availability:r:cat1");
        await command.execute(i);
        expect(embedOf(replyPayload(i)).title).toBe("Raid eh-a");
        expect(embedOf(replyPayload(i)).description).toContain("You are not signed up yet.");
        const other = click("availability:r:cat2");
        await command.execute(other);
        expect(embedOf(replyPayload(other)).title).toBe("Raid eh-c");
    });

    it("Mein Raid ohne Raid in der Kategorie sagt es und trägt keine Knöpfe", async () => {
        const i = click("availability:r:cat9");
        await command.execute(i);
        const payload = replyPayload(i);
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(embedOf(payload)).toMatchObject({ title: "Next raid", description: "No raid planned yet." });
        expect(payload.components).toEqual([]);
    });

    it("Mein Raid spricht Deutsch, wenn der Server Deutsch spricht", async () => {
        mocks.access.config = {};
        const i = click("availability:r:cat1");
        await command.execute(i);
        expect(embedOf(replyPayload(i)).description).toContain("Du bist noch nicht angemeldet.");
    });

    it("Auswertung zeigt die neueste Auswertung mit eigenem Charakter und die Knöpfe", async () => {
        const spy = jest.spyOn(organizer, "latestReportFor").mockReturnValue({ id: "abc123", title: "Kara Clear", generatedAt: 1900000000000, character: "Zibbo", idx: 4 });
        try {
            const i = click("availability:o:cat1");
            await command.execute(i);
            // acknowledged at once (the walk can outlast Discord's three seconds), answered after
            expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
            expect(i.reply).not.toHaveBeenCalled();
            expect(i.deferReply.mock.invocationCallOrder[0]).toBeLessThan(spy.mock.invocationCallOrder[0]);
            const payload = i.editReply.mock.calls[0][0];
            expect(spy).toHaveBeenCalledWith(ANNA);
            expect(embedOf(payload).title).toBe("Your evaluation");
            expect(embedOf(payload).description).toBe("**Kara Clear** · <t:1900000000:D>\nYour character: **Zibbo**");
            expect(buttonsOf(payload).map((b) => [b.label, b.url])).toEqual([
                ["Open evaluation", "https://eh.example/r/abc123/p/4"],
                ["My profile", "https://eh.example/profile"],
            ]);
        } finally {
            spy.mockRestore();
        }
    });

    it("Auswertung ohne Treffer verweist aufs Profil", async () => {
        const spy = jest.spyOn(organizer, "latestReportFor").mockReturnValue(null);
        try {
            const i = click("availability:o:cat1");
            await command.execute(i);
            const payload = i.editReply.mock.calls[0][0];
            expect(embedOf(payload).description).toContain("No evaluation with one of your characters yet.");
            expect(buttonsOf(payload).map((b) => b.label)).toEqual(["My profile"]);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("Gildenbank", () => {
    // #924: the guild bank channel of the server clicked on (mockInteraction's guild-1)
    const BANK = { guildId: "guild-1", botLanguage: "en", serverSettings: { "guild-1": { botLanguage: "en", guildBankChannelId: "900000" } } };
    beforeEach(() => {
        for (const r of bankStore.listRequests()) bankStore.removeRequest(r.id);
        discord.postPayload.mockClear();
    });

    it("Knopf ohne eingerichteten Kanal sagt es, statt das Modal zu öffnen", async () => {
        const i = click("availability:b:cat1");
        await command.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(replyPayload(i).flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(answerOf(replyPayload(i)).description).toBe("The guild bank is not set up right now.");
    });

    it("Knopf → Modal in der Sprache des Raiders → Absenden postet an die Orga und bestätigt", async () => {
        mocks.access.config = BANK;
        const btn = click("availability:b:cat1");
        await command.execute(btn);
        const modal = btn.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("availability:mb:cat1");
        expect(modal.title).toBe("Guild bank request");

        const sent = submit("availability:mb:cat1", { item: "Super Mana Potion", amount: "12", purpose: "BT" });
        await command.execute(sent);
        expect(sent.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const answer = answerOf(sent.editReply.mock.calls[0][0]);
        expect(answer.title).toBe("✅ Request sent – the orga will get back to you by DM.");
        expect(answer.description).toBe("**12× Super Mana Potion**\nFor: BT");
        expect(discord.postPayload.mock.calls[0][0]).toBe("900000");
        expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("## 12× Super Mana Potion\n<@200000000000000001>");
        expect(bankStore.listRequests()).toEqual([expect.objectContaining({ userId: ANNA, categoryId: "cat1", amount: 12, messageId: "m-bank" })]);
    });

    it("Fehler kommen auf Englisch zurück: Menge, Grenze von fünf offenen Anfragen", async () => {
        mocks.access.config = BANK;
        const bad = submit("availability:mb:cat1", { item: "Flask", amount: "viele" });
        await command.execute(bad);
        expect(answerOf(bad.editReply.mock.calls[0][0]).description).toBe("⚠️ The amount must be a whole number from 1 to 9999.");

        for (let n = 0; n < 5; n++) await command.execute(submit("availability:mb:cat1", { item: "Flask", amount: "1" }));
        const sixth = submit("availability:mb:cat1", { item: "Flask", amount: "1" });
        await command.execute(sixth);
        expect(answerOf(sixth.editReply.mock.calls[0][0]).description).toBe("⚠️ At most 5 open requests – wait until the orga has handled one.");
        expect(discord.postPayload).toHaveBeenCalledTimes(5);
    });

    it("auf Deutsch für einen deutschen Raider", async () => {
        mocks.access.config = { ...BANK, botLanguage: "de", serverSettings: { "guild-1": { ...BANK.serverSettings["guild-1"], botLanguage: "de" } } };
        const sent = submit("availability:mb:cat1", { item: "Flask", amount: "2" });
        await command.execute(sent);
        expect(answerOf(sent.editReply.mock.calls[0][0]).title).toBe("✅ Anfrage gesendet – die Orga meldet sich per DM.");
        mocks.access.config = { guildId: "g1", botLanguage: "de", serverSettings: { g1: { botLanguage: "de" } } };
        const stale = submit("availability:mb:cat1", { item: "Flask", amount: "2" });
        await command.execute(stale);
        expect(answerOf(stale.editReply.mock.calls[0][0]).description).toBe("⚠️ Die Gildenbank ist gerade nicht eingerichtet.");
    });
});

describe("switched-off sections (#969)", () => {
    afterEach(() => store.setFeatures("cat1", Object.fromEntries(store.FEATURE_KEYS.map((k) => [k, true]))));
    const OFF = "This feature is switched off in this raid hub.";

    it("answers every button of a switched-off section ephemerally and opens nothing", async () => {
        store.setFeatures("cat1", { attendance: false, nextRaid: false, evaluation: false, guildBank: false });
        for (const id of ["availability:a:cat1", "availability:p:cat1", "availability:l:cat1", "availability:r:cat1", "availability:o:cat1", "availability:b:cat1"]) {
            const i = click(id);
            await command.execute(i);
            expect(i.showModal).not.toHaveBeenCalled();
            const payload = replyPayload(i);
            expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
            expect(answerOf(payload).text).toContain(OFF);
        }
    });

    it("leaves the other sections working", async () => {
        store.setFeatures("cat1", { evaluation: false });
        const i = click("availability:a:cat1");
        await command.execute(i);
        expect(i.showModal).toHaveBeenCalled();
        const other = click("availability:a:cat2");
        await command.execute(other);
        expect(other.showModal).toHaveBeenCalled();
    });

    it("refuses the follow-up steps of an open modal or pick card once their section is off", async () => {
        withCharacters();
        store.setFeatures("cat1", { attendance: false, guildBank: false });
        const steps = [
            submit("availability:ma:cat1", { from: dayPlus(0), to: dayPlus(5), reason: "Urlaub" }),
            submit("availability:mp:cat1", { from: dayPlus(0), to: dayPlus(5) }),
            select("availability:bp:cat1:0", ["22829"]),
            submit("availability:mb:cat1", { item: "Flask", amount: "2" }),
            submit("availability:mbi:cat1:22829", { amount: "2" }),
        ];
        for (const i of steps) {
            await command.execute(i);
            expect(i.showModal).not.toHaveBeenCalled();
            expect(i.deferReply).not.toHaveBeenCalled();
            const payload = replyPayload(i);
            expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
            expect(answerOf(payload).text).toContain(OFF);
        }
        expect(store.listEntries({ userId: ANNA })).toEqual([]);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("stops an open raid picker once attendance is off, but lets it be cancelled", async () => {
        withCharacters();
        for (const step of [(token) => select(`availability:${token}:r`, ["eh-b"]), (token) => click(`availability:${token}:save`)]) {
            store.setFeatures("cat1", { attendance: true });
            const modal = submit("availability:ma:cat1", { from: dayPlus(0), to: dayPlus(5), reason: "Urlaub" });
            await command.execute(modal);
            const token = tokenOf(replyPayload(modal));
            store.setFeatures("cat1", { attendance: false });
            const i = step(token);
            await command.execute(i);
            expect(answerOf(i.update.mock.calls[0][0]).text).toContain(OFF);
            expect(i.deferUpdate).not.toHaveBeenCalled();
            // the session is over: a second click finds nothing to save
            const again = click(`availability:${token}:save`);
            await command.execute(again);
            expect(answerOf(again.update.mock.calls[0][0]).text).toContain("expired");
        }
        expect(store.listEntries({ userId: ANNA })).toEqual([]);
        expect(mocks.signups.get(`eh-a/${ANNA}`)).toBeUndefined();

        const second = submit("availability:ma:", { from: dayPlus(0), to: dayPlus(5) });
        await command.execute(second);
        const cancel = click(`availability:${tokenOf(replyPayload(second))}:x`);
        await command.execute(cancel);
        expect(answerOf(cancel.update.mock.calls[0][0]).text).toContain("Cancelled");
    });

    it("keeps \"My entries\" working inside an ephemeral answer", async () => {
        store.setFeatures("cat1", { attendance: false });
        const i = click("availability:l:cat1", { message: { flags: { has: (f) => f === MessageFlags.Ephemeral } } });
        await command.execute(i);
        const calls = [...i.reply.mock.calls, ...i.update.mock.calls].map((c) => answerOf(c[0]).text).join("\n");
        expect(calls).not.toContain(OFF);
    });
});
