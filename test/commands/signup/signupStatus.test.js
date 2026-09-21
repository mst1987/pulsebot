// Die Status-Buttons im Anmelde-Dialog (#258): speichern über den signupService
// (echte Regeln auf Test-Stores), Bestätigung in derselben Nachricht, Deadline,
// Abmelden ohne Charakter und der Weg ohne Profil über das Namens-Modal.

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/web/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/signup/signupStatus");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";
const payloadOf = (i) => i.update.mock.calls[0][0];

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-signup-status.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
    profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: ["Warrior-Protection", "Warrior-Fury"] });
});

describe("commands/signup/signupStatus", () => {
    it("signs up with the picks from the customId and confirms in the same message", async () => {
        const i = mockInteraction({ customId: "signup-status:eh-kara:s:brokk:Warrior-Protection:h", userId: ANNA });
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({
            character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed", canAlso: ["healer"],
        });
        expect(mocks.changed).toHaveBeenCalledWith("eh-kara");
        const payload = payloadOf(i);
        expect(payload.embeds[0].description).toContain("✅ Saved: **Signed up** (Brokk · Protection)");
        expect(payload.embeds[0].description).toContain("Tank 1/2");
        expect(i.reply).not.toHaveBeenCalled();
    });

    it("changes the status and keeps an existing comment", async () => {
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", canAlso: [], comment: "Pizza" });
        const i = mockInteraction({ customId: "signup-status:eh-kara:t:nerathil:Mage-Arcane:", userId: ANNA });
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "tentative", comment: "Pizza" });
        expect(payloadOf(i).embeds[0].description).toContain("✅ Saved: **Tentative**");
    });

    it("refuses a new signup after the deadline with the service's reason", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: Math.floor(Date.now() / 1000) - 60 }));
        const i = mockInteraction({ customId: "signup-status:eh-kara:s:nerathil:Mage-Arcane:", userId: ANNA });
        await command.execute(i);
        expect(mocks.signups.size).toBe(0);
        expect(payloadOf(i).embeds[0].description).toContain("⚠️ The signup deadline has passed");

        const late = mockInteraction({ customId: "signup-status:eh-kara:l:nerathil:Mage-Arcane:", userId: ANNA });
        await command.execute(late);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "late" });
    });

    it("refuses once the raid has started", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ startTime: Math.floor(Date.now() / 1000) - 60, signupDeadline: 0 }));
        const i = mockInteraction({ customId: "signup-status:eh-kara:a:::", userId: ANNA });
        await command.execute(i);
        expect(payloadOf(i).embeds[0].description).toContain("⚠️ The raid has already started");
    });

    it("signs off without a profile character", async () => {
        const i = mockInteraction({ customId: "signup-status:eh-kara:a:::", userId: NOBODY });
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${NOBODY}`)).toMatchObject({ status: "absence", spec: "" });
        expect(payloadOf(i).embeds[0].description).toContain("✅ Signed off.");
    });

    it("without a profile asks for the character name, then adds it and signs up", async () => {
        const click = mockInteraction({ customId: "signup-status:eh-kara:s::Priest-Holy:", userId: NOBODY });
        click.member = { displayName: "Ysolde" };
        await command.execute(click);
        expect(click.showModal).toHaveBeenCalledTimes(1);
        const modal = click.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("signup-status:eh-kara:s::Priest-Holy:");
        expect(modal.components[0].components[0]).toMatchObject({ custom_id: "character", value: "Ysolde" });
        expect(mocks.signups.size).toBe(0);

        const submit = mockInteraction({ customId: "signup-status:eh-kara:s::Priest-Holy:", userId: NOBODY, modal: true, options: { character: "Ysolde" } });
        await command.execute(submit);
        expect(profiles.getProfile(NOBODY).characters).toEqual([expect.objectContaining({ name: "Ysolde", className: "Priest", specs: [{ key: "Priest-Holy", gear: "usable" }] })]);
        expect(mocks.signups.get(`eh-kara/${NOBODY}`)).toMatchObject({ character: "Ysolde", spec: "Priest-Holy", status: "signed" });
        expect(payloadOf(submit).embeds[0].description).toContain("✅ Saved: **Signed up** (Ysolde · Holy)");
    });

    it("without a profile after the deadline gives the reason instead of the name modal", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: Math.floor(Date.now() / 1000) - 60 }));
        const i = mockInteraction({ customId: "signup-status:eh-kara:s::Priest-Holy:", userId: NOBODY });
        await command.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(payloadOf(i).embeds[0].description).toContain("⚠️ The signup deadline has passed");
    });

    it("asks for a spec first when none is picked", async () => {
        const i = mockInteraction({ customId: "signup-status:eh-kara:s:::", userId: NOBODY });
        await command.execute(i);
        expect(payloadOf(i).embeds[0].description).toContain("⚠️ Please pick character and spec first.");
    });

    describe("raider role of the category", () => {
        beforeEach(() => {
            mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat-kara" }));
            mocks.access.config = { categoryRoles: { "cat-kara": ["role-kara"] } };
            mocks.access.roleIds = ["role-other"];
        });

        it("refuses the save with a short message in the same dialog", async () => {
            const i = mockInteraction({ customId: "signup-status:eh-kara:s:nerathil:Mage-Arcane:", userId: ANNA });
            await command.execute(i);
            expect(mocks.signups.size).toBe(0);
            expect(payloadOf(i).embeds[0].description).toContain("⚠️ You need a raider role for this raid.");
        });

        it("says so before asking a member without profile for a character name", async () => {
            const i = mockInteraction({ customId: "signup-status:eh-kara:s::Priest-Holy:", userId: NOBODY });
            await command.execute(i);
            expect(i.showModal).not.toHaveBeenCalled();
            expect(payloadOf(i).embeds[0].description).toContain("⚠️ You need a raider role for this raid.");
        });

        it("still lets an existing signup be withdrawn", async () => {
            mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", canAlso: [] });
            const i = mockInteraction({ customId: "signup-status:eh-kara:a:nerathil:Mage-Arcane:", userId: ANNA });
            await command.execute(i);
            expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "absence" });
        });

        it("lets a holder of the role sign up", async () => {
            mocks.access.roleIds = ["role-kara"];
            const i = mockInteraction({ customId: "signup-status:eh-kara:s:nerathil:Mage-Arcane:", userId: ANNA });
            await command.execute(i);
            expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "signed" });
        });
    });

    it("clears the message when the event is gone", async () => {
        const i = mockInteraction({ customId: "signup-status:eh-gone:s:::" });
        await command.execute(i);
        expect(i.update).toHaveBeenCalledWith({ content: "This event no longer exists.", embeds: [], components: [] });
    });
});
