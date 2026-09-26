// „Kommentar“ im Anmelde-Dialog (#258): Klick öffnet das Modal, Absenden
// speichert den Kommentar an der bestehenden Anmeldung.

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const command = require("../../../src/commands/signup/signupComment");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const ID = "signup-comment:eh-kara:nerathil:Mage-Arcane:";
const payloadOf = (i) => i.update.mock.calls[0][0];

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-signup-comment.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
});

const signedUp = (over = {}) => mocks.signups.set(`eh-kara/${ANNA}`, {
    userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", canAlso: [], comment: "alt", ...over,
});

describe("commands/signup/signupComment", () => {
    it("the click opens the modal prefilled with the current comment", async () => {
        signedUp();
        const i = mockInteraction({ customId: ID, userId: ANNA });
        await command.execute(i);
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe(ID);
        expect(modal.components[0].components[0]).toMatchObject({ custom_id: "comment", value: "alt", max_length: 300 });
    });

    it("the submitted modal saves the comment and keeps status and spec", async () => {
        signedUp();
        const i = mockInteraction({ customId: ID, userId: ANNA, modal: true, options: { comment: "  komme 20 min später " } });
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "signed", spec: "Mage-Arcane", comment: "komme 20 min später" });
        expect(payloadOf(i).embeds[0].description).toContain("✅ Comment saved.");
    });

    it("works after the deadline, since nothing but the comment changes", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: Math.floor(Date.now() / 1000) - 60 }));
        signedUp();
        const i = mockInteraction({ customId: ID, userId: ANNA, modal: true, options: { comment: "" } });
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`).comment).toBe("");
        expect(payloadOf(i).embeds[0].description).toContain("✅ Comment removed.");
    });

    it("asks to sign up first when there is no signup", async () => {
        const i = mockInteraction({ customId: ID, userId: ANNA, modal: true, options: { comment: "hi" } });
        await command.execute(i);
        expect(mocks.signups.size).toBe(0);
        expect(payloadOf(i).embeds[0].description).toContain("⚠️ Sign up first");
    });

    it("clears the message when the event is gone", async () => {
        const i = mockInteraction({ customId: "signup-comment:eh-gone:::", modal: true });
        await command.execute(i);
        expect(i.update).toHaveBeenCalledWith({ content: "This event no longer exists.", embeds: [], components: [] });
    });
});
