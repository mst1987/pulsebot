jest.mock("fs", () => {
    const store = new Map();
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => store.set(p, String(data))),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw new Error("ENOENT");
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    listSignups, getSignup, lastSignupOf, saveSignup, removeSignup, deleteEventSignups, normalizeSignup, onSignupsChanged,
} = require("../../src/web/signupStore");

describe("web/signupStore", () => {
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
        const specHistory = require("../../src/web/specHistoryStore");
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
        fs.__store.set(require("../../src/web/signupStore").SIGNUPS_FILE, JSON.stringify({
            signups: {
                "eh-old": {
                    u1: { userId: "u1", character: "Alt", spec: "Mage-Fire", role: "ranged", status: "signed", at: 1 },
                    u2: { userId: "u2", character: "", spec: "", role: "", status: "absence", at: 2 },
                },
            },
        }));
        expect(getSignup("eh-old", "u1").characters).toEqual([{ character: "Alt", spec: "Mage-Fire", role: "ranged" }]);
        expect(listSignups("eh-old").map((s) => s.characters)).toEqual([[{ character: "Alt", spec: "Mage-Fire", role: "ranged" }], []]);
        // a changed signup keeps its place and writes the new shape
        const { signup } = saveSignup("eh-old", "u1", { characters: [{ character: "Alt", spec: "Mage-Fire" }, { character: "Neu", spec: "Druid-Balance" }] });
        expect(signup.at).toBe(1);
        expect(JSON.parse(fs.__store.get(require("../../src/web/signupStore").SIGNUPS_FILE)).signups["eh-old"].u1.characters).toHaveLength(2);
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
