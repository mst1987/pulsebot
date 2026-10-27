// Die Status-Buttons im Anmelde-Dialog (#258): speichern über den signupService
// (echte Regeln auf Test-Stores), Bestätigung in derselben Nachricht, Deadline,
// Abmelden ohne Charakter und der Weg ohne Profil über das Namens-Modal.

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
const { answerOf } = require("../../helpers/signupMocks");
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const command = require("../../../src/commands/signup/signupStatus");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardButtons } = require("../../helpers/card");

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
    mocks.access.config = { guildId: "g1", serverSettings: { g1: { botLanguage: "en" } } };
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
        expect(cardButtons(modal)[0]).toMatchObject({ custom_id: "character", value: "Ysolde" });
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
            mocks.access.config = { guildId: "g1", serverSettings: { g1: { botLanguage: "en" } }, categoryRoles: { "cat-kara": ["role-kara"] } };
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
        expect(answerOf(i.update.mock.calls[0][0])).toMatchObject({ content: "", title: "", description: "This event no longer exists.", components: [], embedCount: 1 });
    });
});

describe("<server> beitreten after „Gespeichert“ (#904)", () => {
    const discord = require("../../../src/services/discord/discord");
    const RAID_SERVER = "300000000000000001";
    const PARTNER = "300000000000000002";
    let members;

    beforeEach(() => {
        mocks.events.set("eh-kara", mocks.ownEvent({ guildId: RAID_SERVER }));
        members = { cache: new Map(), fetch: jest.fn(async () => { throw Object.assign(new Error("Unknown Member"), { code: 10007 }); }) };
        discord.getGuild = jest.fn((id) => (id === RAID_SERVER ? { id, name: "Pulse PuGs", members } : null));
        // #924: the answer goes in the language of the server clicked on
        mocks.access.config = { ...mocks.access.config, serverSettings: { g1: { botLanguage: "en" }, [RAID_SERVER]: { botLanguage: "en" }, [PARTNER]: { botLanguage: "en" } } };
    });
    afterEach(() => { delete discord.getGuild; });

    function clickFrom(guildId, status = "s") {
        const i = mockInteraction({ customId: `signup-status:eh-kara:${status}:nerathil:Mage-Arcane:`, userId: ANNA });
        i.guildId = guildId;
        return i;
    }

    it("answers first, then adds the line for a member not on the raid's server", async () => {
        const i = clickFrom(PARTNER);
        await command.execute(i);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "signed" });
        expect(i.update.mock.invocationCallOrder[0]).toBeLessThan(members.fetch.mock.invocationCallOrder[0]);
        const edited = i.editReply.mock.calls[0][0];
        expect(edited.embeds[0].description).toContain("✅ Saved: **Signed up**");
        expect(edited.embeds[0].description).toContain("ℹ️ Join the server **Pulse PuGs**, otherwise you will not get pings and info.");
        // no invite yet (#905): no link button
        expect(JSON.stringify(edited.components)).not.toContain("Join Pulse PuGs");
    });

    it("leaves the answer alone for a member, for an unreadable membership, on the raid's own server and after signing off", async () => {
        members.cache.set(ANNA, {});
        const member = clickFrom(PARTNER);
        await command.execute(member);
        expect(member.editReply).not.toHaveBeenCalled();

        members.cache.clear();
        members.fetch.mockImplementation(async () => { throw Object.assign(new Error("Missing Access"), { code: 50001 }); });
        const unreadable = clickFrom(PARTNER, "t");
        await command.execute(unreadable);
        expect(unreadable.editReply).not.toHaveBeenCalled();

        members.fetch.mockClear();
        const home = clickFrom(RAID_SERVER, "l");
        await command.execute(home);
        expect(home.editReply).not.toHaveBeenCalled();
        expect(members.fetch).not.toHaveBeenCalled();

        const off = clickFrom(PARTNER, "a");
        await command.execute(off);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "absence" });
        expect(off.editReply).not.toHaveBeenCalled();
    });

    it("an older click's hint never redraws over a newer click on the same message", async () => {
        let release;
        members.fetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
            release = () => reject(Object.assign(new Error("Unknown Member"), { code: 10007 }));
        }));
        const older = clickFrom(PARTNER, "s");
        older.message = { id: "dialog-1" };
        const pending = command.execute(older);
        await new Promise((r) => setImmediate(r));
        const newer = clickFrom(PARTNER, "t");
        newer.message = { id: "dialog-1" };
        await command.execute(newer);
        expect(newer.editReply).toHaveBeenCalledTimes(1);
        release();
        await pending;
        expect(older.editReply).not.toHaveBeenCalled();
    });

    it("a sign-off after „Dabei“ on the same message counts as the newer click too", async () => {
        let release;
        members.fetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
            release = () => reject(Object.assign(new Error("Unknown Member"), { code: 10007 }));
        }));
        const signed = clickFrom(PARTNER, "s");
        signed.message = { id: "dialog-2" };
        const pending = command.execute(signed);
        await new Promise((r) => setImmediate(r));
        const off = clickFrom(PARTNER, "a");
        off.message = { id: "dialog-2" };
        await command.execute(off);
        expect(mocks.signups.get(`eh-kara/${ANNA}`)).toMatchObject({ status: "absence" });
        release();
        await pending;
        expect(signed.editReply).not.toHaveBeenCalled();
        expect(off.editReply).not.toHaveBeenCalled();
    });

    it("a failing edit (dialog gone) is only logged", async () => {
        const i = clickFrom(PARTNER);
        i.editReply = jest.fn(async () => { throw new Error("Unknown Message"); });
        await expect(command.execute(i)).resolves.toBeUndefined();
        expect(i.editReply).toHaveBeenCalledTimes(1);
    });
});
