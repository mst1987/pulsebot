// Mehrere Raids auf einmal (#743): TBC und Forever teilen den Server, eine Anmeldung mischt sie nie -
// bei Raids zweier Versionen fragt der Bot zuerst die Version.
const { answerOf } = require("../../helpers/signupMocks");

jest.mock("../../../src/stores/events/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/events/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settings/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/services/talk/talkOverview", () => ({ SELECT_ID: "talk-signup", MULTI_BUTTON_ID: "talk-signup-multi" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const multi = require("../../../src/utils/signup/multiSignup");
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
    mocks.access.config = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } } };
    mocks.events.clear();
    profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
});

function raid(id, versionId, day = 1) {
    mocks.events.set(id, mocks.ownEvent({ id, guildId: "g1", title: id, versionId, startTime: sec() + day * DAY + 3600, signupDeadline: sec() + day * DAY }));
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
        mocks.access.config = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } }, hideOtherVersions: true, mainVersion: "tbc" };
        expect(multi.signableVersions()).toEqual(["tbc"]);
        expect(multi.signableRaids().map((e) => e.id)).toEqual(["eh-t1"]);
    });
});

describe("talk overview buttons with two versions", () => {
    it("ask which version first", async () => {
        raid("eh-t1", "tbc");
        raid("eh-f1", "forever", 2);
        const id = "talk-signup-multi";
        const i = mockInteraction({ customId: id, userId: ANNA });
        await pickRaids.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        const payload = i.reply.mock.calls[0][0];
        expect(answerOf(payload).text).toContain("Which game version");
        expect(cardButtons(payload).map((b) => [b.label, b.custom_id])).toEqual([["TBC", `${id}:v:tbc`], ["Forever", `${id}:v:forever`]]);
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

    describe("the list's source server in the button (#904)", () => {
        const GUILD = "100000000000000001";
        const PUG = "100000000000000002";
        const PARTNER = "100000000000000003";
        const onServer = (id, guildId, versionId = "tbc", day = 1) => {
            raid(id, versionId, day);
            mocks.events.get(id).guildId = guildId;
        };
        const click = async (customId, guildId = PARTNER) => {
            const i = mockInteraction({ customId, userId: ANNA });
            i.guildId = guildId;
            await pickRaids.execute(i);
            return i.reply.mock.calls[0][0];
        };
        beforeEach(() => {
            mocks.access.config = {
                discordServers: {
                    servers: [{ guildId: GUILD }, { guildId: PUG }, { guildId: PARTNER }],
                    links: [{ from: PUG, to: PARTNER, channelId: "100000000000000009", versions: [] }],
                },
                // #924: the language is per server; the clicks come from every one of them
                botLanguage: "en",
                serverSettings: { [GUILD]: { botLanguage: "en" }, [PUG]: { botLanguage: "en" }, [PARTNER]: { botLanguage: "en" } },
            };
            onServer("eh-gilde", GUILD);
            onServer("eh-pug", PUG, "tbc", 2);
        });

        it("offers only the PuG raids on the partner's PuG list", async () => {
            const text = JSON.stringify(await click(`talk-signup-multi:${PUG}`));
            expect(text).toContain("eh-pug");
            expect(text).not.toContain("eh-gilde");
        });

        it("an old button without a source keeps offering the first server's raids", async () => {
            const text = JSON.stringify(await click("talk-signup-multi"));
            expect(text).toContain("eh-gilde");
            expect(text).not.toContain("eh-pug");
        });

        it("a source that is not linked to the clicked server falls back to the first server", async () => {
            const text = JSON.stringify(await click(`talk-signup-multi:${PUG}`, "100000000000000077"));
            expect(text).toContain("eh-gilde");
            expect(text).not.toContain("eh-pug");
        });

        it("keeps to the link's versions and keeps the source in the version question", async () => {
            onServer("eh-pugf", PUG, "forever", 3);
            const payload = await click(`talk-signup-multi:${PUG}`);
            expect(answerOf(payload).text).toContain("Which game version");
            expect(cardButtons(payload).map((b) => b.custom_id))
                .toEqual([`talk-signup-multi:${PUG}:v:tbc`, `talk-signup-multi:${PUG}:v:forever`]);
            const forever = JSON.stringify(await click(`talk-signup-multi:${PUG}:v:forever`));
            expect(forever).toContain("eh-pugf");
            expect(forever).not.toContain("eh-gilde");
            expect(forever).not.toMatch(/eh-pug[^f]/);

            mocks.access.config.discordServers.links[0].versions = ["forever"];
            const linked = JSON.stringify(await click(`talk-signup-multi:${PUG}`));
            expect(linked).not.toContain("Which game version");
            expect(linked).toContain("eh-pugf");
            expect(linked).not.toMatch(/eh-pug[^f]/);
        });

        it("parses every customId form", () => {
            expect(pickRaids.parseButtonId("talk-signup-multi")).toEqual({ from: "", version: "" });
            expect(pickRaids.parseButtonId("talk-signup-multi:v:tbc")).toEqual({ from: "", version: "tbc" });
            expect(pickRaids.parseButtonId(`talk-signup-multi:${PUG}`)).toEqual({ from: PUG, version: "" });
            expect(pickRaids.parseButtonId(`talk-signup-multi:${PUG}:v:forever`)).toEqual({ from: PUG, version: "forever" });
        });
    });

    it("do not ask while only one version has raids", async () => {
        raid("eh-f1", "forever");
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: [{ key: "Priest-Shadow", gear: "ready" }], versionId: "forever" });
        const i = mockInteraction({ customId: "talk-signup-multi", userId: ANNA });
        await pickRaids.execute(i);
        const text = JSON.stringify(i.reply.mock.calls[0][0]);
        expect(text).not.toContain("Which game version");
        expect(text).toContain("eh-f1");
    });
});
