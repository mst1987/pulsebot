// Das öffentliche „Anmelden …“-Dropdown unter der Event-Nachricht (#287) und die
// Charakter-Auswahl, die nur der Raider sieht: Vorauswahl, Direkt-Anmeldung bei genau
// einer Spec, Abmelden, Weg ohne Profil, Anmeldeschluss, Raider-Rolle, Zugriff.
const { MessageFlags } = require("discord.js");
const os = require("os");
const path = require("path");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/web/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const appEmojis = require("../../../src/web/appEmojis");
const command = require("../../../src/commands/signup/eventJoin");
const { parseJoinId, joinId, characterOptions, defaultPick } = require("../../../src/utils/joinPicker");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";
const sec = () => Math.floor(Date.now() / 1000);
const replyOf = (i) => i.reply.mock.calls[0][0];
const updateOf = (i) => i.update.mock.calls[0][0];
const pick = (status, extra = {}) => mockInteraction({ customId: "event-join:eh-kara", userId: ANNA, values: [status], ...extra });
const selectOf = (payload) => payload.components[0].components[0];
const buttonsOf = (payload) => payload.components[payload.components.length - 1].components;

beforeAll(() => profiles.useFile(path.join(os.tmpdir(), `eh-cmd-event-join-${process.pid}.json`)));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    appEmojis.resetAppEmojis();
    mocks.events.set("eh-kara", mocks.ownEvent());
});

function twoCharacters() {
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
    profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }, { key: "Warrior-Fury", gear: "none" }] });
}

describe("commands/signup/eventJoin", () => {
    it("is routed by the select's customId prefix and open to every raider", () => {
        expect(command).toMatchObject({ name: "event-join", group: "signup", defaultAccess: "everyone" });
        expect(memberMayRun(command)).toBe(true);
        // An admin who locks it down gets it locked (the router guard decides, not the handler).
        expect(memberMayRun(command, { botCommandAccess: { "event-join": { mode: "admins" } } })).toBe(false);
    });

    it("reads and writes the picker's customIds within 100 characters", () => {
        const id = joinId("eh-kara", "late", "c", { character: "brokk", spec: "Warrior-Protection", canAlso: ["healer"] });
        expect(id).toBe("event-join:eh-kara:l:c:brokk:Warrior-Protection:h");
        expect(parseJoinId(id)).toEqual({ eventId: "eh-kara", status: "late", field: "c", state: { character: "brokk", spec: "Warrior-Protection", canAlso: ["healer"] } });
        expect(parseJoinId("event-join:eh-kara")).toMatchObject({ eventId: "eh-kara", field: "", state: null });
        expect(joinId("eh-kara", "signed", "c", { character: "x".repeat(90), spec: "Mage-Arcane", canAlso: [] })).toBe("event-join:eh-kara:s:c");
    });

    it("lists the own characters · specs without gear-less specs and preselects the main", async () => {
        twoCharacters();
        const fetch = jest.fn(async () => [{ id: "77", name: "eh_mage_arcane" }]);
        const i = pick("signed", { client: { application: { emojis: { fetch } } } });
        await command.execute(i);
        const payload = replyOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].description).toContain("Mit welchem Charakter?");
        const options = selectOf(payload).options;
        expect(options.map((o) => o.value)).toEqual(["nerathil|Mage-Arcane", "brokk|Warrior-Protection"]);
        expect(options[0]).toMatchObject({ label: "Nerathil · Arkan", description: "Magier · raidbereit · Main", default: true, emoji: { id: "77", name: "eh_mage_arcane" } });
        expect(options[1]).toMatchObject({ description: "Krieger · brauchbar · Tank", default: false });
        expect(options[1].emoji).toBeUndefined();
        expect(selectOf(payload).custom_id).toBe("event-join:eh-kara:s:c:nerathil:Mage-Arcane:t");
        const [ok, also, comment, profile] = buttonsOf(payload);
        expect(ok).toMatchObject({ label: "Anmelden", custom_id: "signup-status:eh-kara:s:nerathil:Mage-Arcane:t", disabled: false });
        expect(also).toMatchObject({ label: "Kann auch …", custom_id: "event-join:eh-kara:s:m:nerathil:Mage-Arcane:t" });
        expect(comment).toMatchObject({ label: "Kommentar", disabled: true });
        expect(profile).toMatchObject({ style: 5, url: "https://eh.example/profile" });
        expect(mocks.signups.size).toBe(0);
    });

    it("preselects the spec used last, and the current signup before that", async () => {
        twoCharacters();
        mocks.signups.set(`eh-old/${ANNA}`, { userId: ANNA, character: "Brokk", spec: "Warrior-Protection", status: "signed", at: 5 });
        const i = pick("tentative");
        await command.execute(i);
        const options = selectOf(replyOf(i)).options;
        expect(options[1]).toMatchObject({ default: true, description: "Krieger · brauchbar · Tank · zuletzt" });

        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", status: "signed", at: 1, canAlso: [] });
        expect(defaultPick(characterOptions(profiles.getProfile(ANNA)), {
            mine: mocks.signups.get(`eh-kara/${ANNA}`),
            last: { character: "Brokk", spec: "Warrior-Protection" },
        })).toMatchObject({ spec: "Mage-Arcane" });
    });

    it("signs up at once when exactly one character · spec fits and the status is Dabei", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }, { key: "Warrior-Arms", gear: "none" }] });
        const i = pick("signed");
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ character: "Brokk", spec: "Warrior-Protection", status: "signed" });
        const payload = replyOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].description).toContain("✅ Gespeichert: **Dabei** (Brokk · Schutz)");
        expect(buttonsOf(payload)[2]).toMatchObject({ label: "Kommentar", disabled: false });
    });

    it("does not sign up at once for another status", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] });
        const i = pick("bench");
        await command.execute(i);
        expect(mocks.signups.size).toBe(0);
        expect(buttonsOf(replyOf(i))[0]).toMatchObject({ label: "Speichern: Bank", custom_id: "signup-status:eh-kara:b:brokk:Warrior-Protection:" });
    });

    it("signs off at once, keeping character and comment", async () => {
        twoCharacters();
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed", canAlso: [], comment: "Pizza" });
        const i = pick("absence");
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "absence", character: "Brokk", comment: "Pizza" });
        expect(replyOf(i)).toEqual({ content: "✅ Abgemeldet.", flags: MessageFlags.Ephemeral });
    });

    it("opens the dialog of #258 without a profile character", async () => {
        const i = mockInteraction({ customId: "event-join:eh-kara", userId: NOBODY, values: ["signed"] });
        await command.execute(i);
        const payload = replyOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].description).toContain("Wähle Klasse und Spec und klicke dann „Dabei“");
        expect(payload.components[0].components[0].custom_id).toMatch(/^signup-pick:eh-kara:k:/);
        expect(mocks.signups.size).toBe(0);
    });

    it("refuses what the deadline no longer allows, but still takes Spät", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: sec() - 60 }));
        const refused = pick("signed");
        await command.execute(refused);
        expect(replyOf(refused).content).toContain("Anmeldeschluss ist vorbei");
        expect(replyOf(refused).flags).toBe(MessageFlags.Ephemeral);

        const late = pick("late");
        await command.execute(late);
        expect(replyOf(late).embeds[0].description).toContain("**Spät**");
        expect(selectOf(replyOf(late)).options).toHaveLength(2);
    });

    it("refuses everything once the raid has started", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ startTime: sec() - 60, signupDeadline: 0 }));
        const i = pick("absence");
        await command.execute(i);
        expect(replyOf(i).content).toContain("Der Raid hat schon begonnen");
        expect(mocks.signups.size).toBe(0);
    });

    it("answers with the raider-role rule before showing anything", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat1" }));
        mocks.access.config = { categoryRoles: { cat1: ["role-raider"] } };
        mocks.access.roleIds = ["something-else"];
        const i = pick("signed");
        await command.execute(i);
        expect(replyOf(i)).toEqual({ content: "Für diesen Raid brauchst du eine Raider-Rolle.", flags: MessageFlags.Ephemeral });

        mocks.access.roleIds = ["role-raider"];
        const ok = pick("signed");
        await command.execute(ok);
        expect(replyOf(ok).embeds[0].description).toContain("Mit welchem Charakter?");
    });

    it("says so for a gone event or an unknown status", async () => {
        const gone = mockInteraction({ customId: "event-join:eh-gone", userId: ANNA, values: ["signed"] });
        await command.execute(gone);
        expect(replyOf(gone).content).toBe("Dieses Event gibt es nicht mehr.");
        const bogus = pick("maybe");
        await command.execute(bogus);
        expect(replyOf(bogus).content).toBe("Unbekannter Status.");
    });

    it("redraws the picker with a new pick and the profile's kann auch", async () => {
        twoCharacters();
        const i = mockInteraction({ customId: "event-join:eh-kara:s:c:nerathil:Mage-Arcane:", userId: ANNA, values: ["brokk|Warrior-Protection"] });
        await command.execute(i);
        const payload = updateOf(i);
        expect(i.reply).not.toHaveBeenCalled();
        expect(selectOf(payload).options[1].default).toBe(true);
        expect(buttonsOf(payload)[0].custom_id).toMatch(/^signup-status:eh-kara:s:brokk:Warrior-Protection:/);
        expect(mocks.signups.size).toBe(0);

        const foreign = mockInteraction({ customId: "event-join:eh-kara:s:c:nerathil:Mage-Arcane:", userId: ANNA, values: ["someone|Priest-Holy"] });
        await command.execute(foreign);
        expect(selectOf(updateOf(foreign)).options[0].default).toBe(true);
    });

    it("opens the full signup dialog for Kann auch …", async () => {
        twoCharacters();
        const i = mockInteraction({ customId: "event-join:eh-kara:s:m:brokk:Warrior-Protection:h", userId: ANNA });
        await command.execute(i);
        const payload = updateOf(i);
        const also = payload.components.map((r) => r.components[0]).find((c) => String(c.custom_id).startsWith("signup-pick:eh-kara:a:"));
        expect(also.options.find((o) => o.value === "healer").default).toBe(true);
    });

    it("clears the picker when its event is gone", async () => {
        const i = mockInteraction({ customId: "event-join:eh-gone:s:c:::", userId: ANNA, values: ["x|y"] });
        await command.execute(i);
        expect(updateOf(i)).toEqual({ content: "Dieses Event gibt es nicht mehr.", embeds: [], components: [] });
    });
});
