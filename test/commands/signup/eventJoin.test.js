// Das öffentliche „Anmelden …“-Dropdown unter der Event-Nachricht (#287) und die
// Charakter-Auswahl, die nur der Raider sieht: Vorauswahl, Direkt-Anmeldung bei genau
// einer Spec, Abmelden, Weg ohne Profil, Anmeldeschluss, Raider-Rolle, Zugriff.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const appEmojis = require("../../../src/services/discord/appEmojis");
const command = require("../../../src/commands/signup/eventJoin");
const { parseJoinId, joinId, characterOptions, defaultPick } = require("../../../src/utils/signup/joinPicker");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";
const sec = () => Math.floor(Date.now() / 1000);
const replyOf = (i) => i.reply.mock.calls[0][0];
const updateOf = (i) => i.update.mock.calls[0][0];
const pick = (status, extra = {}) => mockInteraction({ customId: "event-join:eh-kara", userId: ANNA, values: [status], ...extra });
const selectOf = (payload) => payload.components[0].components[0];
const buttonsOf = (payload) => payload.components[payload.components.length - 1].components;

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-event-join.json")));
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
        expect(payload.embeds[0].description).toContain("Which character?");
        const options = selectOf(payload).options;
        expect(options.map((o) => o.value)).toEqual(["nerathil|Mage-Arcane", "brokk|Warrior-Protection"]);
        expect(options[0]).toMatchObject({ label: "Nerathil · Arcane", description: "Mage · raid ready · Main", default: true, emoji: { id: "77", name: "eh_mage_arcane" } });
        expect(options[1]).toMatchObject({ description: "Warrior · usable · Tank", default: false });
        expect(options[1].emoji).toBeUndefined();
        // "kann auch" belongs to the character: Brokk tanks, the mage Nerathil does not
        expect(selectOf(payload).custom_id).toBe("event-join:eh-kara:s:c:nerathil:Mage-Arcane:");
        const [ok, also, comment, multi, profile] = buttonsOf(payload);
        expect(ok).toMatchObject({ label: "Sign up", custom_id: "signup-status:eh-kara:s:nerathil:Mage-Arcane:", disabled: false });
        expect(also).toMatchObject({ label: "Can also …", custom_id: "event-join:eh-kara:s:m:nerathil:Mage-Arcane:" });
        expect(comment).toMatchObject({ label: "Comment", disabled: true });
        // two characters: first choice + "kann auch mit" in one modal (#293)
        expect(multi).toMatchObject({ label: "Several characters …", custom_id: "signup-multi:e:eh-kara:s" });
        expect(profile).toMatchObject({ style: 5, url: "https://eh.example/profile" });
        expect(mocks.signups.size).toBe(0);
    });

    it("preselects the spec used last, and the current signup before that", async () => {
        twoCharacters();
        mocks.signups.set(`eh-old/${ANNA}`, { userId: ANNA, character: "Brokk", spec: "Warrior-Protection", status: "signed", at: 5 });
        const i = pick("tentative");
        await command.execute(i);
        const options = selectOf(replyOf(i)).options;
        expect(options[1]).toMatchObject({ default: true, description: "Warrior · usable · Tank · last used" });

        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", status: "signed", at: 1, canAlso: [] });
        expect(defaultPick(characterOptions(profiles.getProfile(ANNA)), {
            mine: mocks.signups.get(`eh-kara/${ANNA}`),
            last: { character: "Brokk", spec: "Warrior-Protection" },
        })).toMatchObject({ spec: "Mage-Arcane" });
    });

    it("preselects the spec imported from Raid-Helper by spec alone, the main first (#291)", () => {
        profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }, { key: "Mage-Fire", gear: "usable" }] });
        profiles.addCharacter(ANNA, { name: "Twink", className: "Mage", specs: [{ key: "Mage-Fire", gear: "ready" }] });
        const options = characterOptions(profiles.getProfile(ANNA));
        // Raid-Helper only knew "Anna" as name — no profile character, the spec decides
        expect(defaultPick(options, { last: { character: "Anna", spec: "Mage-Fire", imported: true } })).toMatchObject({ character: "nerathil", spec: "Mage-Fire" });
        // a spec nobody in the profile plays falls through to the main's best spec
        expect(defaultPick(options, { last: { character: "Anna", spec: "Priest-Shadow", imported: true } })).toMatchObject({ spec: "Mage-Frost" });
        // an own last signup is never matched by spec alone
        expect(defaultPick(options, { last: { character: "Anna", spec: "Mage-Fire" } })).toMatchObject({ spec: "Mage-Frost" });
    });

    it("signs up at once when exactly one character · spec fits and the status is Dabei", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }, { key: "Warrior-Arms", gear: "none" }] });
        const i = pick("signed");
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ character: "Brokk", spec: "Warrior-Protection", status: "signed" });
        const payload = replyOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].description).toContain("✅ Saved: **Signed up** (Brokk · Protection)");
        expect(buttonsOf(payload)[2]).toMatchObject({ label: "Comment", disabled: false });
    });

    it("does not sign up at once for another status", async () => {
        profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection"] });
        const i = pick("bench");
        await command.execute(i);
        expect(mocks.signups.size).toBe(0);
        expect(buttonsOf(replyOf(i))[0]).toMatchObject({ label: "Save: Bench", custom_id: "signup-status:eh-kara:b:brokk:Warrior-Protection:" });
    });

    it("signs off at once, keeping character and comment", async () => {
        twoCharacters();
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed", canAlso: [], comment: "Pizza" });
        const i = pick("absence");
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "absence", character: "Brokk", comment: "Pizza" });
        expect(replyOf(i)).toEqual({ content: "✅ Signed off.", flags: MessageFlags.Ephemeral });
    });

    it("opens the dialog of #258 without a profile character", async () => {
        const i = mockInteraction({ customId: "event-join:eh-kara", userId: NOBODY, values: ["signed"] });
        await command.execute(i);
        const payload = replyOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].description).toContain("Pick class and spec, then click “Sign up”");
        expect(payload.components[0].components[0].custom_id).toMatch(/^signup-pick:eh-kara:k:/);
        expect(mocks.signups.size).toBe(0);
    });

    it("refuses what the deadline no longer allows, but still takes Spät", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: sec() - 60 }));
        const refused = pick("signed");
        await command.execute(refused);
        expect(replyOf(refused).content).toContain("signup deadline has passed");
        expect(replyOf(refused).flags).toBe(MessageFlags.Ephemeral);

        const late = pick("late");
        await command.execute(late);
        expect(replyOf(late).embeds[0].description).toContain("**Late**");
        expect(selectOf(replyOf(late)).options).toHaveLength(2);
    });

    it("refuses everything once the raid has started", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ startTime: sec() - 60, signupDeadline: 0 }));
        const i = pick("absence");
        await command.execute(i);
        expect(replyOf(i).content).toContain("The raid has already started");
        expect(mocks.signups.size).toBe(0);
    });

    it("answers with the raider-role rule before showing anything", async () => {
        twoCharacters();
        mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat1" }));
        mocks.access.config = { categoryRoles: { cat1: ["role-raider"] } };
        mocks.access.roleIds = ["something-else"];
        const i = pick("signed");
        await command.execute(i);
        expect(replyOf(i)).toEqual({ content: "You need a raider role for this raid.", flags: MessageFlags.Ephemeral });

        mocks.access.roleIds = ["role-raider"];
        const ok = pick("signed");
        await command.execute(ok);
        expect(replyOf(ok).embeds[0].description).toContain("Which character?");
    });

    it("says so for a gone event or an unknown status", async () => {
        const gone = mockInteraction({ customId: "event-join:eh-gone", userId: ANNA, values: ["signed"] });
        await command.execute(gone);
        expect(replyOf(gone).content).toBe("This event no longer exists.");
        const bogus = pick("maybe");
        await command.execute(bogus);
        expect(replyOf(bogus).content).toBe("Unknown status.");
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
        expect(updateOf(i)).toEqual({ content: "This event no longer exists.", embeds: [], components: [] });
    });
});
