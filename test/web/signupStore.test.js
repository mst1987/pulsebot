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
