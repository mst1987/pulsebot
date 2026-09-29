// Discord-Anmeldung je Spielversion (#543): der Dialog und die Charakterauswahl
// bieten nur die Charaktere der Event-Version an; wer nur Charaktere einer
// anderen Version hat, bekommt den Hinweis mit Link aufs Profil (Englisch).

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1 }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/raiderProfileStore");
const dialog = require("../../../src/utils/signup/signupDialog");
const joinPicker = require("../../../src/utils/signup/joinPicker");
const { toEnglish } = require("../../../src/utils/signup/botEnglish");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-dialog-versions.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent({ versionId: "tbc" }));
    mocks.events.set("eh-barrow", mocks.ownEvent({ id: "eh-barrow", title: "Barrow Deeps", versionId: "forever" }));
    profiles.addCharacter(ANNA, { name: "Devi", className: "Priest", specs: ["Priest-Holy"] }, { name: "Anna" });
    profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", specs: ["Priest-Shadow"], versionId: "forever" }, { name: "Anna" });
    profiles.addCharacter(BERT, { name: "Ysolde", className: "Mage", specs: ["Mage-Frost"] }, { name: "Bert" });
});

const flat = (payload) => (payload.components || []).flatMap((row) => row.components || []);
const selectOf = (payload, prefix) => flat(payload).find((c) => String(c.custom_id || "").startsWith(prefix) && c.options);
const description = (payload) => (payload.embeds[0].description || "");

describe("signupDialog je Spielversion", () => {
    it("bietet für ein Forever-Event nur Devi Res, für TBC nur Devi", () => {
        const forever = dialog.buildSignupDialog(mocks.events.get("eh-barrow"), ANNA);
        expect(selectOf(forever, "signup-pick:eh-barrow:s").options.map((o) => o.value)).toEqual(["forever~devi res|Priest-Shadow"]);
        const tbc = dialog.buildSignupDialog(mocks.events.get("eh-kara"), ANNA);
        expect(selectOf(tbc, "signup-pick:eh-kara:s").options.map((o) => o.value)).toEqual(["devi|Priest-Holy"]);
    });

    it("sagt einem Raider ohne Charakter der Version, was zu tun ist – mit Link", () => {
        const payload = dialog.buildSignupDialog(mocks.events.get("eh-barrow"), BERT);
        expect(description(payload)).toContain("No WoW Forever character in your profile yet – create a WoW Forever character in your [profile](https://eh.example/profile)");
        // the class way stays open, and the link button says which character is missing
        expect(selectOf(payload, "signup-pick:eh-barrow:k")).toBeTruthy();
        const link = flat(payload).find((c) => c.url === "https://eh.example/profile");
        expect(link.label).toBe("Add a WoW Forever character");
    });

    it("ohne jeden Charakter bleibt der alte Hinweis", () => {
        const payload = dialog.buildSignupDialog(mocks.events.get("eh-barrow"), "200000000000000009");
        expect(description(payload)).toContain("No character in your profile yet");
        expect(dialog.missingVersionLine(profiles.getProfile("200000000000000009"), "forever")).toBe("");
    });

    it("signableCharacters und pickText bleiben in der Version", () => {
        const p = profiles.getProfile(ANNA);
        expect(dialog.signableCharacters(p, "forever").map((c) => c.name)).toEqual(["Devi Res"]);
        expect(dialog.signableCharacters(p).map((c) => c.name)).toEqual(["Devi", "Devi Res"]);
        expect(dialog.pickText(p, "Devi Res", "Priest-Shadow", "forever")).toMatch(/^Devi Res · /);
        expect(dialog.versionLabel("forever")).toBe("WoW Forever");
    });

    it("hält die customId auch mit dem längsten Forever-Schlüssel unter 100 Zeichen", () => {
        const state = { character: `forever~${"x".repeat(12)} ${"y".repeat(12)}`, spec: "Hunter-BeastMastery", canAlso: ["tank", "healer", "melee"] };
        const id = dialog.statusId("eh-mf00abcd123456", "tentative", state);
        expect(id.length).toBeLessThanOrEqual(100);
        expect(dialog.parseStatusId(id).state.character).toBe(state.character);
    });
});

describe("joinPicker je Spielversion", () => {
    it("characterOptions filtert nach der Version", () => {
        const p = profiles.getProfile(ANNA);
        expect(joinPicker.characterOptions(p, "forever").map((o) => o.character)).toEqual(["forever~devi res"]);
        expect(joinPicker.characterOptions(p, "tbc").map((o) => o.character)).toEqual(["devi"]);
        expect(joinPicker.characterOptions(p)).toHaveLength(2);
    });

    it("die Auswahl zeigt nur Charaktere der Event-Version und sonst den Hinweis", () => {
        const payload = joinPicker.buildJoinPicker(mocks.events.get("eh-barrow"), ANNA, "signed");
        expect(selectOf(payload, "event-join:eh-barrow").options.map((o) => o.value)).toEqual(["forever~devi res|Priest-Shadow"]);
        const bert = joinPicker.buildJoinPicker(mocks.events.get("eh-barrow"), BERT, "signed");
        expect(description(bert)).toContain("No WoW Forever character in your profile yet");
    });

    it("merkt sich „zuletzt“ je Version und vergleicht über den Namen", () => {
        mocks.signups.set("eh-kara/" + ANNA, { userId: ANNA, character: "Devi", spec: "Priest-Holy", status: "signed", updatedAt: 5 });
        expect(joinPicker.lastSignupInVersion(ANNA, "tbc")).toMatchObject({ character: "Devi" });
        expect(joinPicker.lastSignupInVersion(ANNA, "forever")).toBeNull();
        const options = joinPicker.characterOptions(profiles.getProfile(ANNA), "forever");
        expect(joinPicker.defaultPick(options, { mine: { character: "Devi Res", spec: "Priest-Shadow", status: "signed" } }).character).toBe("forever~devi res");
    });
});

describe("botEnglish für die Versions-Hinweise", () => {
    it("übersetzt die Ablehnung und den Überspring-Grund", () => {
        expect(toEnglish("Devi Res gehört zu WoW Forever – lege einen TBC Anniversary-Charakter im Profil an."))
            .toBe("Devi Res belongs to WoW Forever – create a TBC Anniversary character in your profile.");
        expect(toEnglish("Charakter aus einer anderen Spielversion – dieser Raid ist WoW Forever"))
            .toBe("character of another game version – this raid is WoW Forever");
    });
});
