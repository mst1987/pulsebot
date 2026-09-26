// Die Auswahlen im Anmelde-Dialog (#258) speichern nichts, sie zeichnen den
// Dialog mit der neuen Wahl neu. Dazu: der Zugang aller Dialog-Schritte hängt am
// „Anmelden“-Button (Router-Guard).

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/eventMessage", () => ({ SIGNUP_BUTTON_PREFIX: "event-signup" }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/web/discord", () => ({ getGuild: jest.fn(), fetchGuildMembersCached: jest.fn(), getClient: jest.fn() }));
jest.mock("../../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "") }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const settings = require("../../../src/stores/settingsStore");
const { guardInteraction } = require("../../../src/web/botAccess");
const command = require("../../../src/commands/signup/signupPick");
const statusCommand = require("../../../src/commands/signup/signupStatus");
const commentCommand = require("../../../src/commands/signup/signupComment");
const eventSignup = require("../../../src/commands/signup/eventSignup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";
const payloadOf = (i) => i.update.mock.calls[0][0];
const byPrefix = (payload, prefix) => payload.components.flatMap((r) => r.components).filter((c) => String(c.custom_id || "").startsWith(prefix));

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-signup-pick.json")));
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

describe("commands/signup/signupPick", () => {
    it("picking character · spec redraws the dialog with it, saving nothing", async () => {
        const i = mockInteraction({ customId: "signup-pick:eh-kara:s:nerathil:Mage-Arcane:", values: ["brokk|Warrior-Fury"], userId: ANNA });
        await command.execute(i);
        const payload = payloadOf(i);
        expect(byPrefix(payload, "signup-status:eh-kara:s")[0].custom_id).toBe("signup-status:eh-kara:s:brokk:Warrior-Fury:t");
        expect(byPrefix(payload, "signup-pick:eh-kara:s")[0].options.find((o) => o.default).value).toBe("brokk|Warrior-Fury");
        expect(mocks.changed).not.toHaveBeenCalled();
    });

    it("picking \"kann auch\" keeps the spec and stores the roles in the customIds", async () => {
        const i = mockInteraction({ customId: "signup-pick:eh-kara:a:nerathil:Mage-Arcane:", values: ["healer", "tank"], userId: ANNA });
        await command.execute(i);
        expect(byPrefix(payloadOf(i), "signup-status:eh-kara:b")[0].custom_id).toBe("signup-status:eh-kara:b:nerathil:Mage-Arcane:th");
    });

    it("without a profile, a class pick shows its specs and preselects the first", async () => {
        const i = mockInteraction({ customId: "signup-pick:eh-kara:k:::", values: ["Druid"], userId: NOBODY });
        await command.execute(i);
        const payload = payloadOf(i);
        const [spec] = byPrefix(payload, "signup-pick:eh-kara:s");
        expect(spec.options.map((o) => o.value)).toContain("|Druid-Guardian");
        expect(spec.options.find((o) => o.default).value).toBe("|Druid-Balance");
    });

    it("ignores a character that is not the member's", async () => {
        const i = mockInteraction({ customId: "signup-pick:eh-kara:s:nerathil:Mage-Arcane:", values: ["fremd|Rogue-Combat"], userId: ANNA });
        await command.execute(i);
        expect(byPrefix(payloadOf(i), "signup-status:eh-kara:s")[0].custom_id).toMatch(/^signup-status:eh-kara:s:nerathil:Mage-Arcane:/);
    });

    it("clears the message when the event is gone", async () => {
        const i = mockInteraction({ customId: "signup-pick:eh-gone:a:::", values: [] });
        await command.execute(i);
        expect(i.update).toHaveBeenCalledWith({ content: "This event no longer exists.", embeds: [], components: [] });
    });
});

describe("access of the dialog steps", () => {
    const commands = new Map([eventSignup, command, statusCommand, commentCommand].map((c) => [c.name, c]));

    it("every step inherits the button's access", () => {
        for (const c of [command, statusCommand, commentCommand]) expect(c.accessOf).toBe("event-signup");
    });

    it("the router guard lets every member through by default", async () => {
        for (const [c, customId, modal] of [[command, "signup-pick:eh-kara:a:::", false], [statusCommand, "signup-status:eh-kara:s:::", true], [commentCommand, "signup-comment:eh-kara:::", false]]) {
            expect(await guardInteraction(mockInteraction({ customId, modal }), c, commands)).toBe(true);
        }
    });

    it("the router guard refuses every step when the orga restricts the signup to a role", async () => {
        settings.getConfig.mockReturnValue({ botCommandAccess: { "event-signup": { mode: "roles", roleIds: ["300000000000000001"] } } });
        for (const [c, customId] of [[command, "signup-pick:eh-kara:a:::"], [statusCommand, "signup-status:eh-kara:s:::"], [commentCommand, "signup-comment:eh-kara:::"]]) {
            const i = mockInteraction({ customId });
            expect(await guardInteraction(i, c, commands)).toBe(false);
            expect(i.reply).toHaveBeenCalled();
        }
        settings.getConfig.mockReturnValue({});
    });
});
