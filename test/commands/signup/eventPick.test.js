// Die öffentliche Anmelde-Auswahl unter der Event-Nachricht (#303): „Meine Charaktere …“
// öffnet die eigenen Charaktere (Mehrfachauswahl, Klassen darunter), eine Klasse führt zu
// Spec und Namen. Die Auswahl setzt sich für das Mitglied zurück, die Antwort ist ephemer.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/web/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/signup/eventPick");
const buttons = require("../../../src/commands/signup/eventButton");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const sec = () => Math.floor(Date.now() / 1000);
const followOf = (i) => i.followUp.mock.calls[0][0];
const selectOf = (payload, row = 0) => payload.components[row].components[0];
const stored = () => mocks.signups.get(`eh-kara/${ANNA}`);

/** A pick in the public select: update() acknowledges like discord.js does (replied = true). */
function pick(value, eventId = "eh-kara") {
    const i = mockInteraction({ customId: `event-pick:${eventId}`, userId: ANNA, values: [value] });
    i.update.mockImplementation(async () => {
        i.replied = true;
    });
    return i;
}

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-event-pick.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
});

describe("commands/signup/eventPick", () => {
    it("is routed by its prefix and inherits the signup buttons' access", () => {
        expect(command).toMatchObject({ name: "event-pick", accessOf: "event-btn" });
        expect(buttons.name).toBe("event-btn");
    });

    it("Meine Charaktere: resets the public select, then offers the own characters (up to 3) with the classes below", async () => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }, { key: "Priest-Shadow", gear: "usable" }] });
        profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }] });
        const i = pick("mine");
        await command.execute(i);
        // the message's components are drawn anew (the embed is left alone), so the pick does not stick
        const reset = i.update.mock.calls[0][0];
        expect(Object.keys(reset)).toEqual(["components"]);
        expect(reset.components[0].components[0].custom_id).toBe("event-pick:eh-kara");
        expect(i.reply).not.toHaveBeenCalled();

        const payload = followOf(i);
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(selectOf(payload)).toMatchObject({ custom_id: "event-btn:eh-kara:pick:s", max_values: 3 });
        expect(selectOf(payload).options.map((o) => o.value)).toEqual(["zibbo|Priest-Holy", "zibbo|Priest-Shadow", "zibbowar|Warrior-Protection"]);
        expect(selectOf(payload, 1).custom_id).toBe("event-btn:eh-kara:cls:s");

        // the multi-select saves through the button flow, in listed order
        const multi = mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["zibbowar|Warrior-Protection", "zibbo|Priest-Holy"] });
        multi.component = selectOf(payload);
        await buttons.execute(multi);
        expect(stored().characters.map((c) => [c.character, c.spec, c.status])).toEqual([
            ["Zibbo", "Priest-Holy", "signed"], ["Zibbowar", "Warrior-Protection", "signed"],
        ]);
    });

    it("Meine Charaktere with exactly one character signs up at once", async () => {
        profiles.addCharacter(ANNA, { name: "Devire", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
        const i = pick("mine");
        await command.execute(i);
        expect(followOf(i).content).toBe("Saved for **Karazhan**:\n`1.` Devire · Arcane – **Signed up**");
        expect(stored()).toMatchObject({ status: "signed", character: "Devire" });
    });

    it("Meine Charaktere without a profile character goes the class way", async () => {
        const i = pick("mine");
        await command.execute(i);
        expect(followOf(i).embeds[0].description).toContain("No character in your profile yet");
        expect(selectOf(followOf(i)).custom_id).toBe("event-btn:eh-kara:cls:s");
    });

    it("a class leads to the spec select and on to the name modal", async () => {
        const i = pick("Priest");
        await command.execute(i);
        const specs = followOf(i);
        expect(specs.embeds[0].description).toContain("**Priest** – which spec?");
        expect(selectOf(specs).custom_id).toBe("event-btn:eh-kara:spec:s");

        const spec = mockInteraction({ customId: "event-btn:eh-kara:spec:s", userId: ANNA, values: ["Priest-Holy"] });
        await buttons.execute(spec);
        expect(spec.showModal.mock.calls[0][0].toJSON().custom_id).toBe("event-btn:eh-kara:name:s:Priest-Holy");

        const name = mockInteraction({ customId: "event-btn:eh-kara:name:s:Priest-Holy", userId: ANNA, modal: true, options: { character: "Heilzibbo" } });
        await buttons.execute(name);
        expect(stored()).toMatchObject({ status: "signed", character: "Heilzibbo", spec: "Priest-Holy" });

        const unknown = pick("Tinker");
        await command.execute(unknown);
        expect(followOf(unknown).content).toBe("Unknown class.");
    });

    it("refuses after the deadline and for the raider role, still ephemeral", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: sec() - 60 }));
        const late = pick("mine");
        await command.execute(late);
        expect(followOf(late)).toEqual({ content: "The signup deadline has passed – only “Late” or Absence now.", flags: MessageFlags.Ephemeral });
        // the reset draws the phase's components: no select any more
        expect(late.update.mock.calls[0][0].components.flatMap((r) => r.components).map((c) => c.custom_id)).toEqual(["event-btn:eh-kara:late", "event-btn:eh-kara:absence"]);

        mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat-1" }));
        mocks.access.config = { categoryRoles: { "cat-1": ["role-raider"] } };
        mocks.access.roleIds = ["other"];
        const cls = pick("Mage");
        await command.execute(cls);
        expect(followOf(cls).content).toBe("You need a raider role for this raid.");
    });

    it("answers with a reply when the select cannot be reset, and for a gone event", async () => {
        profiles.addCharacter(ANNA, { name: "Devire", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const i = mockInteraction({ customId: "event-pick:eh-kara", userId: ANNA, values: ["mine"] });
            i.update.mockRejectedValue(new Error("Unknown interaction"));
            await command.execute(i);
            expect(i.reply.mock.calls[0][0].content).toContain("Devire · Arcane");
        } finally {
            warn.mockRestore();
        }
        const gone = mockInteraction({ customId: "event-pick:eh-weg", userId: ANNA, values: ["mine"] });
        await command.execute(gone);
        expect(gone.reply.mock.calls[0][0]).toEqual({ content: "This event no longer exists.", flags: MessageFlags.Ephemeral });
    });
});
