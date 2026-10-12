// Mehrere Raids auf einmal (#743): TBC und Forever teilen den Server, eine Anmeldung mischt sie nie -
// bei Raids zweier Versionen fragt der Bot zuerst die Version.
const { answerOf } = require("../../helpers/signupMocks");

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/services/talk/talkOverview", () => ({ SELECT_ID: "talk-signup", ALL_BUTTON_ID: "talk-signup-all", MULTI_BUTTON_ID: "talk-signup-multi" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const multi = require("../../../src/utils/signup/multiSignup");
const all = require("../../../src/commands/signup/talkSignupAll");
const pickRaids = require("../../../src/commands/signup/talkSignupMulti");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardButtons } = require("../../helpers/card");

const ANNA = "200000000000000001";
const DAY = 86400;
const sec = () => Math.floor(Date.now() / 1000);

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-signup-multi-versions.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.access.config = { botLanguage: "en" };
    mocks.events.clear();
    profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
});

function raid(id, versionId, day = 1) {
    mocks.events.set(id, mocks.ownEvent({ id, title: id, versionId, startTime: sec() + day * DAY + 3600, signupDeadline: sec() + day * DAY }));
}

describe("signableRaids / signableVersions", () => {
    it("offer the raids of one version and name the versions present", () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        expect(multi.signableVersions()).toEqual(["tbc", "forever"]);
        expect(multi.signableRaids({ versionId: "forever" }).map((e) => e.id)).toEqual(["eh-f1"]);
        expect(multi.signableRaids().map((e) => e.id)).toEqual(["eh-t1", "eh-f1"]);
    });

    it("leave out a hidden version", () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        mocks.access.config = { botLanguage: "en", hideOtherVersions: true, mainVersion: "tbc" };
        expect(multi.signableVersions()).toEqual(["tbc"]);
        expect(multi.signableRaids().map((e) => e.id)).toEqual(["eh-t1"]);
    });
});

describe("talk overview buttons with two versions", () => {
    it("ask which version first - for both buttons", async () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        for (const [command, id] of [[all, "talk-signup-all"], [pickRaids, "talk-signup-multi"]]) {
            const i = mockInteraction({ customId: id, userId: ANNA });
            await command.execute(i);
            expect(i.showModal).not.toHaveBeenCalled();
            const payload = i.reply.mock.calls[0][0];
            expect(answerOf(payload).text).toContain("Which game version");
            expect(cardButtons(payload).map((b) => [b.label, b.custom_id])).toEqual([["TBC", `${id}:v:tbc`], ["Forever", `${id}:v:forever`]]);
        }
    });

    it("\"all\" with the version in the customId offers only that version's raids", async () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        raid("eh-f2", "forever", 3);
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: [{ key: "Priest-Shadow", gear: "ready" }], versionId: "forever" });
        const i = mockInteraction({ customId: "talk-signup-all:v:forever", userId: ANNA });
        await all.execute(i);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.title).toBe("Sign up for all 2 raids");
        // only the Forever character - nobody signs up with a TBC character for a Forever raid (#741)
        const text = JSON.stringify(modal);
        expect(text).toContain("Devi Res");
        expect(text).not.toContain("Zibbo");
    });

    it("\"all\" for Forever without a Forever character opens no modal and says what is missing", async () => {
        raid("eh-f1", "forever", 2);
        const i = mockInteraction({ customId: "talk-signup-all:v:forever", userId: ANNA });
        await all.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(answerOf(i.reply.mock.calls[0][0]).text).toContain("characters with a spec");
    });

    it("the per-raid modal offers each raid only its own version's characters, never a stand-in", () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        const events = ["eh-t1", "eh-f1"].map((id) => mocks.events.get(id));
        const profile = profiles.getProfile(ANNA);
        const session = { userId: ANNA, mode: "multi", selected: ["eh-t1", "eh-f1"] };
        const modal = multi.buildCharacterModal("tok", session, 0, events, profile, { lang: "en" });
        // the TBC raid gets Zibbo, the Forever raid no select at all (no Forever character = skipped)
        expect(modal.components).toHaveLength(1);
        expect(JSON.stringify(modal.components[0])).toContain("Zibbo");
        expect(modal.components[0].component.custom_id).toBe("r0");
    });

    it("\"several\" with the version in the customId lists only that version's raids", async () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        const i = mockInteraction({ customId: "talk-signup-multi:v:tbc", userId: ANNA });
        await pickRaids.execute(i);
        const text = JSON.stringify(i.reply.mock.calls[0][0]);
        expect(text).toContain("eh-t1");
        expect(text).not.toContain("eh-f1");
    });

    it("do not ask while only one version has raids", async () => {
        raid("eh-f1", "forever");
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: [{ key: "Priest-Shadow", gear: "ready" }], versionId: "forever" });
        const i = mockInteraction({ customId: "talk-signup-all", userId: ANNA });
        await all.execute(i);
        expect(i.showModal).toHaveBeenCalled();
    });
});
