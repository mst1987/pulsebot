// memberSpec (docs/roster-profile.md "Spec eines Mitglieds"): class, spec and
// role of a member's first character - override > signup > logs > profile > class.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/events/eventSources", () => ({
    ...jest.requireActual("../../../src/services/events/eventSources"),
    ownUpcomingRaw: jest.fn(() => []),
}));

const fs = require("fs");
const { ownUpcomingRaw } = require("../../../src/services/events/eventSources");
const raiderProfileStore = require("../../../src/stores/roster/raiderProfileStore");
const characterStore = require("../../../src/stores/roster/characterStore");
const specHistoryStore = require("../../../src/stores/roster/specHistoryStore");
const kaderStore = require("../../../src/stores/roster/kaderStore");
const {
    resolveMemberSpec, specContext, specChoices, knownClassOf, specRecord, roleOfSpecRole, SOURCES,
} = require("../../../src/services/roster/memberSpec");

const CAT = "700000000000000001";
const ROSTER = { id: "r1", guildId: "g1", categoryId: CAT, versionId: "tbc" };
const U = "200000000000000001";
const ctxWith = (signUps, extra = {}) => ({ allRaidsByCategory: new Map([[CAT, [{ id: "e1", startTime: 1, signUps, logs: [] }]]]), roleByKey: {}, ...extra });
const resolve = (member, ctx = null) => resolveMemberSpec(U, member, specContext(ROSTER, ctx));

beforeEach(() => {
    fs.__store.clear();
    ownUpcomingRaw.mockReset();
    ownUpcomingRaw.mockReturnValue([]);
    raiderProfileStore.addCharacter(U, { name: "Gentletwowl", className: "Druid", specs: [{ key: "Druid-Restoration" }, { key: "Druid-Balance" }] });
});

describe("services/roster/memberSpec resolveMemberSpec", () => {
    it("names the sources in their order", () => {
        expect(SOURCES).toEqual(["override", "signup", "logs", "profile", "kader", "class"]);
    });

    describe("the linked Kader's plan", () => {
        const LINKED = { ...ROSTER, kaderId: "k1" };
        const planned = (member, roster = LINKED) => resolveMemberSpec(U, member, specContext(roster));
        const planWith = (decision) => kaderStore.writePlanner("g1", {
            v: 2,
            accounts: [],
            assignments: {},
            kaders: [{ id: "k1", name: "Forever", leads: [], questions: [], players: { [U]: { state: "roster", decision } } }],
        });

        beforeEach(() => planWith({ className: "Mage", spec: "Mage-Frost" }));

        it("answers for a member without a character: class, spec and role, and no reason left", () => {
            expect(planned({ chars: [] })).toMatchObject({
                character: "", className: "Mage", spec: "Mage-Frost", specRole: "ranged", role: "dps", source: "kader", reason: "",
                auto: { className: "Mage", spec: "Mage-Frost", source: "kader" },
            });
        });

        it("says no_spec for a planned class without a spec", () => {
            // a decision always has a spec: only the planner's active character can name a class alone
            kaderStore.writePlanner("g1", {
                v: 2,
                accounts: [],
                assignments: { [U]: { characters: [{ id: "x1", name: "Ohnespec", className: "Mage", specs: [] }], activeCharacterId: "x1" } },
                kaders: [{ id: "k1", name: "Forever", leads: [], questions: [], players: { [U]: { state: "roster" } } }],
            });
            expect(planned({ chars: [] })).toMatchObject({ className: "Mage", spec: "", role: "", source: "kader", reason: "no_spec" });
        });

        it("stays out of a roster without the link and of a member the Kader does not plan", () => {
            expect(planned({ chars: [] }, ROSTER)).toMatchObject({ className: "", source: "", reason: "no_char" });
            expect(resolveMemberSpec("200000000000000002", { chars: [] }, specContext(LINKED))).toMatchObject({ className: "", source: "", reason: "no_char" });
        });

        it("names the class of a character nothing else knows, and yields to every real source", () => {
            expect(planned({ chars: ["brando"] })).toMatchObject({ character: "brando", className: "Mage", spec: "Mage-Frost", source: "kader" });
            // the profile knows the character: a Druid stays a Druid with the profile's spec
            expect(planned({ chars: ["gentletwowl"] })).toMatchObject({ className: "Druid", spec: "Druid-Restoration", source: "profile" });
        });

        it("gives a known class no spec of another class, and lets a fitting plan fill a class alone", () => {
            raiderProfileStore.addCharacter(U, { name: "Nurdruide", className: "Druid", specs: [] });
            expect(planned({ chars: ["nurdruide"] })).toMatchObject({ className: "Druid", spec: "", source: "class" });
            raiderProfileStore.addCharacter(U, { name: "Nurmagier", className: "Mage", specs: [] });
            expect(planned({ chars: ["nurmagier"] })).toMatchObject({ className: "Mage", spec: "Mage-Frost", source: "kader" });
        });

        it("lets the orga's spec win on a character only the plan names a class for", () => {
            expect(planned({ chars: ["brando"], spec: "Warrior-Fury" })).toMatchObject({ className: "Warrior", spec: "Warrior-Fury", source: "override" });
            expect(knownClassOf(LINKED, U, "brando")).toBe("");
        });
    });

    it("answers no_char for a member without a character", () => {
        expect(resolve({ chars: [] })).toMatchObject({ character: "", className: "", spec: "", role: "", source: "", reason: "no_char" });
    });

    it("prefers an upcoming own signup over the past nights", () => {
        ownUpcomingRaw.mockReturnValue([{ id: "up", startTime: 99, signUps: [{ userId: U, status: "signed", characters: [{ character: "Gentletwowl", spec: "Druid-Feral" }] }] }]);
        const ctx = ctxWith([{ userId: U, status: "signed", characters: [{ character: "Gentletwowl", spec: "Druid-Balance" }] }]);
        expect(resolve({ chars: ["gentletwowl"] }, ctx)).toMatchObject({ spec: "Druid-Feral", source: "signup", role: "dps", specRole: "melee" });
        expect(ownUpcomingRaw).toHaveBeenCalledWith("g1", { categoryId: CAT });
    });

    it("falls back to the spec history imported from Raid-Helper, matched by name", () => {
        specHistoryStore.applyImport([{ userId: U, spec: "Druid-Balance", eventId: "rh1", at: 5, character: "Gentletwowl" }], { eventIds: ["rh1"] });
        expect(resolve({ chars: ["gentletwowl"] })).toMatchObject({ spec: "Druid-Balance", source: "signup" });
        // imported for another character: not this one's
        fs.__store.clear();
        raiderProfileStore.addCharacter(U, { name: "Gentletwowl", className: "Druid", specs: [{ key: "Druid-Restoration" }] });
        specHistoryStore.applyImport([{ userId: U, spec: "Druid-Balance", eventId: "rh2", at: 5, character: "Twink" }], { eventIds: ["rh2"] });
        expect(resolve({ chars: ["gentletwowl"] })).toMatchObject({ spec: "Druid-Restoration", source: "profile" });
    });

    it("takes a signup's class when nothing else knows the character", () => {
        const ctx = ctxWith([{ userId: U, status: "late", characters: [{ character: "Fremd", spec: "Mage-Fire" }] }]);
        expect(resolve({ chars: ["fremd"] }, ctx)).toMatchObject({ className: "Mage", spec: "Mage-Fire", source: "signup" });
    });

    it("keeps the auto answer and the stored override apart", () => {
        const r = resolve({ chars: ["gentletwowl"], spec: "Druid-Balance" });
        expect(r).toMatchObject({ spec: "Druid-Balance", source: "override", override: "Druid-Balance", auto: { className: "Druid", spec: "Druid-Restoration", source: "profile" } });
        // an override of another class is ignored, but still reported
        expect(resolve({ chars: ["gentletwowl"], spec: "Mage-Frost" })).toMatchObject({ spec: "Druid-Restoration", source: "profile", override: "Mage-Frost" });
    });

    it("gives a class-only member the log's role", () => {
        characterStore.saveCharacter("Bubble", { className: "Paladin", source: "export" });
        const r = resolve({ chars: ["bubble"] }, { allRaidsByCategory: new Map(), roleByKey: { bubble: "healer" } });
        expect(r).toMatchObject({ className: "Paladin", spec: "", source: "class", role: "healer", reason: "no_spec" });
    });

    it("answers no_class for a name nothing knows", () => {
        expect(resolve({ chars: ["niemand"] })).toMatchObject({ className: "", source: "", reason: "no_class", role: "" });
    });
});

describe("services/roster/memberSpec helpers", () => {
    it("lists a class's specs of the version for the drawer", () => {
        expect(specChoices("Druid", "tbc").map((s) => [s.key, s.role])).toEqual([
            ["Druid-Balance", "ranged"], ["Druid-Feral", "melee"], ["Druid-Guardian", "tank"], ["Druid-Restoration", "healer"],
        ]);
        expect(specChoices("Druid", "tbc")[0]).toEqual(expect.objectContaining({ id: "Balance", label: expect.any(String), labelEn: "Balance", icon: expect.any(String) }));
        expect(specChoices("Nope", "tbc")).toEqual([]);
        expect(specChoices("Druid", "wotlk")).toEqual([]);
    });

    it("knows the class of a character without the override", () => {
        expect(knownClassOf(ROSTER, U, "gentletwowl")).toBe("Druid");
        expect(knownClassOf(ROSTER, U, "")).toBe("");
        expect(knownClassOf(ROSTER, U, "niemand")).toBe("");
    });

    it("reads a spec record with its class and maps roles to tank/healer/dps", () => {
        expect(specRecord("Mage-Frost", "tbc")).toEqual(expect.objectContaining({ key: "Mage-Frost", classId: "Mage", role: "ranged" }));
        expect(specRecord("Mage-Ice", "tbc")).toBeNull();
        expect(specRecord("", "tbc")).toBeNull();
        expect(["tank", "healer", "melee", "ranged", ""].map(roleOfSpecRole)).toEqual(["tank", "healer", "dps", "dps", ""]);
    });
});
