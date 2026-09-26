// Der Anmelde-Dialog in Discord (#258): Aufbau der Nachricht, Zustand in den
// customIds, Längenbegrenzung.

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const dialog = require("../../../src/utils/signup/signupDialog");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-dialog.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }, "Mage-Fire"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Nerasol", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
});

const flat = (payload) => payload.components.flatMap((row) => row.components);
const byPrefix = (payload, prefix) => flat(payload).filter((c) => String(c.custom_id || "").startsWith(prefix));

describe("state in customIds", () => {
    it("round-trips character, spec and roles", () => {
        const state = { character: "nerathil", spec: "Mage-Fire", canAlso: ["healer", "tank"] };
        const id = dialog.statusId("eh-kara", "late", state);
        expect(id).toBe("signup-status:eh-kara:l:nerathil:Mage-Fire:th");
        expect(dialog.parseStatusId(id)).toEqual({ eventId: "eh-kara", status: "late", state: { character: "nerathil", spec: "Mage-Fire", canAlso: ["tank", "healer"] } });
        expect(dialog.parsePickId(dialog.pickId("eh-kara", "a", state))).toMatchObject({ field: "a", state: { spec: "Mage-Fire" } });
        expect(dialog.parseCommentId(dialog.commentId("eh-kara", state)).eventId).toBe("eh-kara");
    });

    it("stays within Discord's 100 characters for the longest names and drops a state that would not fit", () => {
        const longest = { character: "x".repeat(24), spec: "Hunter-BeastMastery", canAlso: ["tank", "healer", "melee", "ranged"] };
        const eventId = "eh-mf00abcd123456";
        for (const id of [dialog.statusId(eventId, "tentative", longest), dialog.pickId(eventId, "s", longest), dialog.commentId(eventId, longest)]) {
            expect(id.length).toBeLessThanOrEqual(100);
            expect(id).toContain(longest.character);
        }
        const tooLong = dialog.statusId(eventId, "signed", { ...longest, character: "y".repeat(90) });
        expect(tooLong).toBe(`signup-status:${eventId}:s`);
        expect(dialog.parseStatusId(tooLong).state).toBeNull();
    });
});

describe("buildSignupDialog", () => {
    it("shows the raid head with role counts and picks the main's first spec", () => {
        mocks.signups.set("eh-kara/1", { userId: "1", status: "signed", role: "tank", spec: "Warrior-Protection" });
        const payload = dialog.buildSignupDialog(mocks.events.get("eh-kara"), ANNA);
        expect(payload.embeds[0].title).toBe("Karazhan");
        expect(payload.embeds[0].description).toContain("Tank 1/2 · Healer 0/3 · DPS 0/5");
        expect(payload.components.length).toBeLessThanOrEqual(5);
        const [charSelect] = byPrefix(payload, "signup-pick:eh-kara:s");
        expect(charSelect.options.map((o) => o.label)).toEqual(["Nerathil · Arcane", "Nerathil · Fire", "Nerasol · Holy"]);
        expect(charSelect.options[0]).toMatchObject({ default: true, description: "Main · gear raid ready" });
        const statuses = byPrefix(payload, "signup-status:");
        expect(statuses.map((b) => b.label)).toEqual(["Sign up", "Tentative", "Late", "Bench", "Absence"]);
        expect(statuses.every((b) => !b.disabled)).toBe(true);
        // Mage-Arcane is ranged; the priest's healing belongs to the priest, not to the mage.
        const [also] = byPrefix(payload, "signup-pick:eh-kara:a");
        expect(also.options.map((o) => o.value)).toEqual(["tank", "healer", "melee"]);
        expect(also.options.some((o) => o.default)).toBe(false);
        expect(byPrefix(payload, "signup-comment:")[0].disabled).toBe(true);
        expect(flat(payload).find((c) => c.label === "Open on the web").url).toBe("https://eh.example/signups?event=eh-kara");
    });

    it("prefills the current signup and names the status", () => {
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerasol", spec: "Priest-Holy", role: "healer", status: "late", canAlso: [], comment: "später" });
        const payload = dialog.buildSignupDialog(mocks.events.get("eh-kara"), ANNA);
        expect(payload.embeds[0].description).toContain("Your status: **Late** · Nerasol · Holy · „später“");
        const [charSelect] = byPrefix(payload, "signup-pick:eh-kara:s");
        expect(charSelect.options.find((o) => o.default).value).toBe("nerasol|Priest-Holy");
        expect(byPrefix(payload, "signup-comment:")[0].disabled).toBe(false);
    });

    it("offers class and spec from the rule set without a profile, plus the link to the profile", () => {
        const event = mocks.events.get("eh-kara");
        let payload = dialog.buildSignupDialog(event, NOBODY);
        expect(payload.embeds[0].description).toContain("[create a profile](https://eh.example/profile)");
        const [classSelect] = byPrefix(payload, "signup-pick:eh-kara:k");
        expect(classSelect.options).toHaveLength(9);
        expect(byPrefix(payload, "signup-pick:eh-kara:s")).toHaveLength(0);
        expect(byPrefix(payload, "signup-status:").filter((b) => !b.disabled).map((b) => b.label)).toEqual(["Absence"]);
        expect(flat(payload).some((c) => c.label === "Create profile")).toBe(true);

        payload = dialog.buildSignupDialog(event, NOBODY, { state: { character: "", spec: "Paladin-Holy", canAlso: [] } });
        const [specSelect] = byPrefix(payload, "signup-pick:eh-kara:s");
        expect(specSelect.options.map((o) => o.value)).toEqual(["|Paladin-Holy", "|Paladin-Protection", "|Paladin-Retribution"]);
        expect(byPrefix(payload, "signup-status:").every((b) => !b.disabled)).toBe(true);
        expect(payload.components).toHaveLength(5);
    });

    it("disables all but Spät and Abmelden after the deadline", () => {
        const event = mocks.ownEvent({ signupDeadline: Math.floor(Date.now() / 1000) - 60 });
        const payload = dialog.buildSignupDialog(event, ANNA, { notice: "⚠️ Nope" });
        expect(payload.embeds[0].description).toContain("signup deadline has passed");
        expect(payload.embeds[0].description).toContain("⚠️ Nope");
        expect(byPrefix(payload, "signup-status:").filter((b) => !b.disabled).map((b) => b.label)).toEqual(["Late", "Absence"]);
    });

    it("ignores a state that names somebody else's character", () => {
        const picks = dialog.resolveState(mocks.events.get("eh-kara"), profiles.getProfile(ANNA), null, { character: "fremd", spec: "Rogue-Combat", canAlso: [] });
        expect(picks).toMatchObject({ character: "nerathil", spec: "Mage-Arcane" });
    });
});
