jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const {
    listSignups, getSignup, lastSignupOf, saveSignup, removeSignup, deleteEventSignups, normalizeSignup, onSignupsChanged,
} = require("../../src/stores/signupStore");

describe("stores/signupStore", () => {
    beforeEach(() => fs.__store.clear());

    it("stores a signup with the role taken from the rule set", () => {
        const { signup } = saveSignup("eh-1", "u1", {
            character: "Schattenmann", spec: "Priest-Shadow", status: "signed", canAlso: ["healer", "ranged", "bogus"], comment: "  komme später  ",
        });
        expect(signup).toMatchObject({
            userId: "u1", character: "Schattenmann", spec: "Priest-Shadow", role: "ranged",
            status: "signed", canAlso: ["healer"], comment: "komme später",
        });
        expect(getSignup("eh-1", "u1")).toEqual(signup);
    });

    it("knows the spec a user signed up with last, over every event (#287)", () => {
        const now = jest.spyOn(Date, "now");
        try {
            now.mockReturnValue(1000);
            saveSignup("eh-1", "u1", { character: "Schattenmann", spec: "Priest-Shadow", status: "signed" });
            now.mockReturnValue(2000);
            saveSignup("eh-2", "u1", { character: "Heilmann", spec: "Priest-Holy", status: "late" });
            now.mockReturnValue(3000);
            saveSignup("eh-3", "u1", { status: "absence" });
            saveSignup("eh-3", "u2", { character: "Other", spec: "Mage-Frost", status: "signed" });
        } finally {
            now.mockRestore();
        }
        expect(lastSignupOf("u1")).toEqual({ eventId: "eh-2", character: "Heilmann", spec: "Priest-Holy" });
        expect(lastSignupOf("nobody")).toBeNull();
        expect(lastSignupOf("")).toBeNull();
    });

    it("falls back to the spec imported from Raid-Helper, and an own signup wins over it (#291)", () => {
        const specHistory = require("../../src/stores/specHistoryStore");
        specHistory.applyImport(
            [{ userId: "u7", spec: "Druid-Balance", eventId: "rh-1", at: 1000, character: "Eule" }],
            { eventIds: ["rh-1"] },
        );
        expect(lastSignupOf("u7")).toEqual({ eventId: "rh-1", character: "Eule", spec: "Druid-Balance", imported: true });
        saveSignup("eh-9", "u7", { character: "Baum", spec: "Druid-Restoration", status: "signed" });
        expect(lastSignupOf("u7")).toEqual({ eventId: "eh-9", character: "Baum", spec: "Druid-Restoration" });
    });

    it("stores several characters in priority order, the first mirrored on top (#293)", () => {
        const { signup } = saveSignup("eh-1", "u1", {
            characters: [{ character: "Zibbo", spec: "Priest-Holy" }, { character: "Zibbowar", spec: "Warrior-Protection" }, { character: "zibbo", spec: "Priest-Shadow" }],
            canAlso: ["healer", "tank"],
        });
        expect(signup).toMatchObject({
            character: "Zibbo", spec: "Priest-Holy", role: "healer", canAlso: ["tank"],
            characters: [
                { character: "Zibbo", spec: "Priest-Holy", role: "healer" },
                { character: "Zibbowar", spec: "Warrior-Protection", role: "tank" },
            ],
        });
        expect(normalizeSignup({ characters: [{ character: "A", spec: "Mage-Frost" }, { character: "B", spec: "Bogus" }] }).error).toBe("Unbekannte Spezialisierung „Bogus“.");
        const four = ["A", "B", "C", "D"].map((character) => ({ character, spec: "Mage-Frost" }));
        expect(normalizeSignup({ characters: four }).error).toBe("Höchstens 3 Charaktere je Anmeldung.");
        expect(normalizeSignup({ characters: [] }).error).toBe("Für eine Anmeldung fehlt die Spezialisierung.");
    });

    it("migrates a signup stored before #293 on read: its one character becomes characters[0]", () => {
        fs.__store.set(require("../../src/stores/signupStore").SIGNUPS_FILE, JSON.stringify({
            signups: {
                "eh-old": {
                    u1: { userId: "u1", character: "Alt", spec: "Mage-Fire", role: "ranged", status: "signed", at: 1 },
                    u2: { userId: "u2", character: "", spec: "", role: "", status: "absence", at: 2 },
                },
            },
        }));
        expect(getSignup("eh-old", "u1").characters).toEqual([{ character: "Alt", spec: "Mage-Fire", role: "ranged", status: "signed" }]);
        expect(listSignups("eh-old").map((s) => s.characters)).toEqual([[{ character: "Alt", spec: "Mage-Fire", role: "ranged", status: "signed" }], []]);
        // a changed signup keeps its place and writes the new shape
        const { signup } = saveSignup("eh-old", "u1", { characters: [{ character: "Alt", spec: "Mage-Fire" }, { character: "Neu", spec: "Druid-Balance" }] });
        expect(signup.at).toBe(1);
        expect(JSON.parse(fs.__store.get(require("../../src/stores/signupStore").SIGNUPS_FILE)).signups["eh-old"].u1.characters).toHaveLength(2);
    });

    it("knows every status Raid-Helper's normalised signups have", () => {
        for (const status of ["signed", "tentative", "late", "bench", "absence"]) {
            expect(normalizeSignup({ spec: "Warrior-Fury", status }).error).toBeUndefined();
        }
        expect(normalizeSignup({ spec: "Warrior-Fury", status: "maybe" }).error).toMatch(/Anmeldestatus/);
    });

    it("needs a spec unless somebody signs off", () => {
        expect(normalizeSignup({ status: "signed" }).error).toMatch(/Spezialisierung/);
        expect(normalizeSignup({ status: "absence" }).value).toMatchObject({ spec: "", role: "", status: "absence" });
        expect(normalizeSignup({ spec: "Priest-Tank" }).error).toMatch(/Unbekannte Spezialisierung/);
    });

    it("keeps the original position when a signup is changed", () => {
        const first = saveSignup("eh-1", "u1", { spec: "Warrior-Fury" }).signup;
        saveSignup("eh-1", "u2", { spec: "Mage-Fire" });
        const changed = saveSignup("eh-1", "u1", { spec: "Warrior-Protection" }).signup;
        expect(changed.at).toBe(first.at);
        expect(changed.role).toBe("tank");
        expect(listSignups("eh-1").map((s) => s.userId)).toEqual(["u1", "u2"]);
    });

    it("tells listeners about every roster change and removes signups", () => {
        const seen = [];
        const off = onSignupsChanged((id) => seen.push(id));
        saveSignup("eh-1", "u1", { spec: "Warrior-Fury" });
        expect(removeSignup("eh-1", "u1")).toBe(true);
        expect(removeSignup("eh-1", "u1")).toBe(false);
        off();
        saveSignup("eh-1", "u2", { spec: "Warrior-Fury" });
        expect(seen).toEqual(["eh-1", "eh-1"]);
        expect(deleteEventSignups("eh-1")).toBe(true);
        expect(listSignups("eh-1")).toEqual([]);
        expect(saveSignup("", "u1", {}).error).toBeTruthy();
    });
});

describe("lastSignupOf je Spielversion (#543)", () => {
    beforeEach(() => fs.__store.clear());

    it("zählt mit versionId nur Events dieser Version und importierte Specs dieser Version", () => {
        const specHistory = require("../../src/stores/specHistoryStore");
        specHistory.applyImport([
            { userId: "u8", spec: "Priest-Holy", eventId: "rh-1", at: 1000, character: "Devi" },
            { userId: "u8", spec: "Priest-Shadow", eventId: "rh-2", at: 900, character: "Devi Res", versionId: "forever" },
        ], { eventIds: ["rh-1", "rh-2"] });
        const versionOf = (eventId) => (eventId === "eh-forever" ? "forever" : "tbc");
        expect(lastSignupOf("u8", { versionId: "forever", versionOf })).toEqual({ eventId: "rh-2", character: "Devi Res", spec: "Priest-Shadow", imported: true });
        expect(lastSignupOf("u8", { versionId: "tbc", versionOf })).toMatchObject({ character: "Devi", imported: true });

        saveSignup("eh-tbc", "u8", { character: "Devi", spec: "Priest-Holy", status: "signed" });
        expect(lastSignupOf("u8", { versionId: "forever", versionOf })).toMatchObject({ character: "Devi Res", imported: true });
        expect(lastSignupOf("u8", { versionId: "tbc", versionOf })).toEqual({ eventId: "eh-tbc", character: "Devi", spec: "Priest-Holy" });
        // without a version: the newest over everything, as before
        expect(lastSignupOf("u8")).toMatchObject({ eventId: "eh-tbc" });
        // the spec history keeps the two apart, TBC under the bare spec key
        expect(specHistory.specHistoryOf("u8", { versionId: "forever" }).map((e) => e.spec)).toEqual(["Priest-Shadow"]);
        expect(specHistory.specHistoryOf("u8").map((e) => [e.spec, e.versionId])).toEqual([["Priest-Holy", "tbc"], ["Priest-Shadow", "forever"]]);
        expect(specHistory.migrateVersions()).toBe(0);
    });
});

// The file is read per event and per raider (absences, attendance, every event
// list): cached, parsed once per change, and every signup handed out a copy.
describe("cache", () => {
    const { SIGNUPS_FILE, signupsOfUser } = require("../../src/stores/signupStore");
    const parses = () => fs.readFileSync.mock.calls.filter(([p]) => p === SIGNUPS_FILE).length;

    beforeEach(() => {
        fs.__store.clear();
        fs.readFileSync.mockClear();
    });

    it("parses the file once for any number of lookups while it does not change", () => {
        saveSignup("eh-1", "u1", { spec: "Warrior-Fury" });
        saveSignup("eh-2", "u1", { spec: "Mage-Fire" });
        fs.readFileSync.mockClear();
        for (let i = 0; i < 20; i += 1) {
            listSignups("eh-1");
            getSignup("eh-2", "u1");
            signupsOfUser("u1");
            lastSignupOf("u1");
        }
        expect(parses()).toBe(1);
    });

    it("reads again after its own write and after a change from outside", () => {
        saveSignup("eh-1", "u1", { spec: "Warrior-Fury" });
        expect(getSignup("eh-1", "u1").spec).toBe("Warrior-Fury");
        saveSignup("eh-1", "u1", { spec: "Warrior-Protection" });
        expect(getSignup("eh-1", "u1").spec).toBe("Warrior-Protection");
        // an edit by hand
        const data = JSON.parse(fs.__store.get(SIGNUPS_FILE));
        data.signups["eh-1"].u1.comment = "von Hand";
        fs.__store.set(SIGNUPS_FILE, JSON.stringify(data));
        expect(getSignup("eh-1", "u1").comment).toBe("von Hand");
    });

    it("hands out copies: a caller changing a signup changes nothing stored", () => {
        saveSignup("eh-1", "u1", { spec: "Warrior-Fury", canAlso: ["healer"] });
        const one = getSignup("eh-1", "u1");
        one.spec = "x";
        one.canAlso.push("tank");
        one.characters[0].character = "Fremd";
        listSignups("eh-1")[0].status = "absence";
        signupsOfUser("u1")["eh-1"].comment = "x";
        expect(getSignup("eh-1", "u1")).toMatchObject({ spec: "Warrior-Fury", canAlso: ["healer"], status: "signed", comment: "" });
        expect(getSignup("eh-1", "u1").characters[0].character).toBe("");
        expect(Object.isFrozen(getSignup("eh-1", "u1"))).toBe(false);
    });
});
