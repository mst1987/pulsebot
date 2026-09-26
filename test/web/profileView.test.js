// How a raider profile goes out over the API (#255): the owner's view against
// the orga's (who wished for whom, mutual wishes), the role switches and the
// armory lookup. The profile store runs for real on a scratch file; the logs
// index and the Blizzard client are mocks.
jest.mock("../../src/classes/blizzard", () => jest.fn().mockImplementation(() => mockBlizzard));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({ blizzard: { clientId: "id" } })) }));
jest.mock("../../src/web/profileLogs", () => ({
    ...jest.requireActual("../../src/web/profileLogs"),
    logIndex: jest.fn(() => new Map()),
}));

let mockBlizzard = null;

const fs = require("fs");
const Blizzard = require("../../src/classes/blizzard");
const { getConfig } = require("../../src/web/settingsStore");
const { logIndex } = require("../../src/web/profileLogs");
const profiles = require("../../src/web/raiderProfileStore");
const { armoryUrlFor } = require("../../src/web/charLinks");
const {
    profileView, suggestedRoles, effectiveRoles, lookupArmory, realmSlug,
} = require("../../src/web/profileView");
const { tempStoreFile } = require("../helpers/tempStore");

const PROFILES_FILE = tempStoreFile("eh-profile-view.json");

const ME = "100001";
const FRIEND = "100002";
const FAN = "100003";
const GONE = "100009";

const raw = {
    [ME]: {
        name: "Nera",
        characters: [
            { name: "Treeguy", className: "Druid", main: true, specs: [{ key: "Druid-Restoration", gear: "ready" }], canOfftank: true, armory: { level: 70, guild: "Pulse", fetchedAt: 9 } },
            { name: "Frosty", className: "Mage", specs: [{ key: "Mage-Frost" }], canHeal: true },
        ],
        availability: ["mi", "do"],
        preferredRaids: [],
        wishes: [FRIEND, GONE],
        avoidEnabled: true,
        avoid: [FAN],
        note: "Nur bis 23 Uhr",
        updatedAt: 1234,
    },
    [FRIEND]: {
        name: "Friend",
        characters: [{ name: "Frosty", className: "Mage", specs: [] }, { name: "Bubbles", className: "Paladin", main: true }],
        wishes: [ME],
    },
    [FAN]: { name: "", characters: [{ name: "Sneaky", className: "Rogue" }], wishes: [ME] },
};

const all = () => profiles.listProfiles();
const mine = () => profiles.getProfile(ME);

beforeAll(() => {
    profiles.useFile(PROFILES_FILE);
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({ profiles: raw }));
});
afterAll(() => profiles.useFile(null));

beforeEach(() => {
    jest.clearAllMocks();
    mockBlizzard = { isConfigured: jest.fn(() => true), getCharacterSummary: jest.fn(async () => null) };
});

describe("profileView for the owner", () => {
    it("shows the characters with spec details, log evidence, roles and claims", () => {
        const index = new Map([["treeguy", { key: "treeguy", reports: 4, specKey: "Druid-Restoration", specSource: "wcl" }]]);
        const view = profileView(mine(), { index, all: all() });

        expect(view.userId).toBe(ME);
        expect(view.name).toBe("Nera");
        expect(view.characters).toHaveLength(2);
        const [tree, frosty] = view.characters;
        expect(tree).toMatchObject({
            key: "treeguy",
            name: "Treeguy",
            className: "Druid",
            main: true,
            source: "manual",
            armory: { level: 70, guild: "Pulse", fetchedAt: 9 },
            armoryUrl: armoryUrlFor("Treeguy"),
            canOfftank: true,
            canHeal: true,
            suggested: { canOfftank: false, canHeal: true },
            possible: { canOfftank: true, canHeal: true },
            claimedBy: [],
        });
        expect(tree.specs).toEqual([{
            key: "Druid-Restoration",
            gear: "ready",
            label: profiles.specInfo("Druid-Restoration").label,
            specId: "Restoration",
            role: "healer",
            icon: profiles.specInfo("Druid-Restoration").icon,
            canTank: false,
            canHeal: true,
            logs: { status: "seen", reports: 4, source: "wcl" },
        }]);
        // A mage never heals, whatever the switch says; the other account claims the name.
        expect(frosty).toMatchObject({ canHeal: false, canOfftank: false, claimedBy: [{ userId: FRIEND, name: "Friend" }] });
        expect(frosty.specs[0]).toMatchObject({ key: "Mage-Frost", gear: "usable", role: "ranged", logs: { status: "unknown", reports: 0 } });
    });

    it("names the wishes without saying whether they are mutual, and never who wished for the owner", () => {
        const view = profileView(mine(), { index: new Map(), all: all() });
        expect(view.wishes).toEqual([
            { userId: FRIEND, name: "Friend", main: "Bubbles", className: "Paladin" },
            { userId: GONE, name: "", main: "", className: "" },
        ]);
        expect(view.wishedBy).toBeUndefined();
        expect(view.avoidEnabled).toBe(true);
        expect(view.avoid).toEqual([{ userId: FAN, name: "Sneaky", main: "Sneaky", className: "Rogue" }]);
        expect(view).toMatchObject({
            availability: ["mi", "do"],
            preferredRaids: [],
            note: "Nur bis 23 Uhr",
            updatedAt: 1234,
            canOfftank: true,
            canHeal: true,
            suggested: { canOfftank: false, canHeal: true },
        });
    });

    it("reads the logs index and the stored profiles when none are handed in", () => {
        const view = profileView(mine());
        expect(logIndex).toHaveBeenCalledTimes(1);
        expect(view.characters[1].claimedBy).toEqual([{ userId: FRIEND, name: "Friend" }]);
    });

    it("keeps an unknown spec key as its own label", () => {
        const profile = { ...mine(), characters: [{ ...mine().characters[0], specs: [{ key: "Druid-Nope", gear: "none" }] }] };
        const view = profileView(profile, { index: new Map(), all: [] });
        expect(view.characters[0].specs).toEqual([{
            key: "Druid-Nope", gear: "none", label: "Druid-Nope", specId: "", role: "", icon: "",
            canTank: false, canHeal: false, logs: { status: "unknown", reports: 0 },
        }]);
    });
});

describe("profileView for the orga", () => {
    it("adds mutual wishes and who wished for this raider", () => {
        const view = profileView(mine(), { forOrga: true, index: new Map(), all: all() });
        expect(view.wishes).toEqual([
            { userId: FRIEND, name: "Friend", main: "Bubbles", className: "Paladin", mutual: true },
            { userId: GONE, name: "", main: "", className: "", mutual: false },
        ]);
        expect(view.wishedBy).toEqual([
            { userId: FRIEND, name: "Friend", main: "Bubbles", className: "Paladin" },
            { userId: FAN, name: "Sneaky", main: "Sneaky", className: "Rogue" },
        ]);
    });

    it("marks a one-sided wish as not mutual", () => {
        const friend = profiles.getProfile(FRIEND);
        const view = profileView({ ...mine(), wishes: [FAN] }, { forOrga: true, index: new Map(), all: [friend, profiles.getProfile(FAN)] });
        expect(view.wishes).toEqual([{ userId: FAN, name: "Sneaky", main: "Sneaky", className: "Rogue", mutual: true }]);
        const other = profileView(profiles.getProfile(FAN), { forOrga: true, index: new Map(), all: [friend, mine()] });
        expect(other.wishes).toEqual([{ userId: ME, name: "Nera", main: "Treeguy", className: "Druid", mutual: false }]);
    });
});

describe("suggestedRoles / effectiveRoles", () => {
    it("derives the switches from the specs of all characters", () => {
        expect(suggestedRoles(mine())).toEqual({ canOfftank: false, canHeal: true });
        expect(suggestedRoles({ characters: [] })).toEqual({ canOfftank: false, canHeal: false });
    });

    it("is true when any character may step in", () => {
        expect(effectiveRoles(mine())).toEqual({ canOfftank: true, canHeal: true, suggested: { canOfftank: false, canHeal: true } });
    });

    it("falls back to the old profile-wide words without characters", () => {
        expect(effectiveRoles({ characters: [], canOfftank: true, canHeal: null })).toEqual({
            canOfftank: true, canHeal: false, suggested: { canOfftank: false, canHeal: false },
        });
    });
});

describe("realmSlug", () => {
    it("builds the slug the profile API wants", () => {
        expect(realmSlug("Die Aldor")).toBe("die-aldor");
        expect(realmSlug("  Kael'thas   Server ")).toBe("kaelthas-server");
        expect(realmSlug(undefined)).toBe("");
    });
});

describe("lookupArmory", () => {
    const linkOnly = (name) => ({ url: armoryUrlFor(name), fetched: false, className: "", level: null, guild: "" });

    it("adds class, level and guild when the API answers", async () => {
        mockBlizzard.getCharacterSummary.mockResolvedValueOnce({ className: "MAGE", level: 70, guild: "Pulse" });
        const out = await lookupArmory("Frosty", "Die Aldor");
        expect(Blizzard).toHaveBeenCalledWith({ clientId: "id" });
        expect(mockBlizzard.getCharacterSummary).toHaveBeenCalledWith("Frosty", { realmSlug: "die-aldor" });
        expect(out).toEqual({ url: armoryUrlFor("Frosty"), fetched: true, className: "Mage", level: 70, guild: "Pulse" });
    });

    it("defaults level and guild and asks without a realm when none is given", async () => {
        mockBlizzard.getCharacterSummary.mockResolvedValueOnce({ className: "Rogue" });
        const out = await lookupArmory("Sneaky");
        expect(mockBlizzard.getCharacterSummary).toHaveBeenCalledWith("Sneaky", {});
        expect(out).toEqual({ url: armoryUrlFor("Sneaky"), fetched: true, className: "Rogue", level: null, guild: "" });
    });

    it("answers the link only without credentials, without an answer or on a failure", async () => {
        mockBlizzard.isConfigured.mockReturnValueOnce(false);
        expect(await lookupArmory("Frosty")).toEqual(linkOnly("Frosty"));
        expect(mockBlizzard.getCharacterSummary).not.toHaveBeenCalled();

        expect(await lookupArmory("Frosty")).toEqual(linkOnly("Frosty"));

        mockBlizzard.getCharacterSummary.mockRejectedValueOnce(new Error("timeout"));
        expect(await lookupArmory("Frosty")).toEqual(linkOnly("Frosty"));
    });

    it("builds the client with empty options when no Blizzard config is stored", async () => {
        getConfig.mockReturnValueOnce({});
        await lookupArmory("Frosty");
        expect(Blizzard).toHaveBeenCalledWith({});
    });
});
