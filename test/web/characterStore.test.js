// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    listCharacters, getCharacter, characterMap, saveCharacter, deleteCharacter,
} = require("../../src/web/characterStore");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/characterStore", () => {
    describe("saveCharacter", () => {
        it("stores class, spec and source under a realm-independent key", () => {
            const saved = saveCharacter("Keslight-Thunderstrike", { className: "Paladin", spec: "Holy", source: "wcl", reportId: "abc" });
            expect(saved).toMatchObject({ character: "Keslight", className: "Paladin", spec: "Holy", source: "wcl", reportId: "abc" });
            expect(getCharacter("keslight")).toMatchObject({ className: "Paladin", spec: "Holy" });
        });

        it("adds the spec later without losing the class", () => {
            saveCharacter("Gemli", { className: "Warrior", source: "export" });
            const updated = saveCharacter("Gemli", { spec: "Fury", source: "wcl" });
            expect(updated).toMatchObject({ className: "Warrior", spec: "Fury", source: "wcl" });
        });

        it("never wipes a known spec with an empty one", () => {
            saveCharacter("Gemli", { className: "Warrior", spec: "Fury", source: "wcl" });
            saveCharacter("Gemli", { className: "Warrior", source: "export" });
            expect(getCharacter("Gemli").spec).toBe("Fury");
        });

        it("keeps a manual entry against automatic sources", () => {
            saveCharacter("Gemli", { className: "Warrior", spec: "Arms", source: "manual" });
            saveCharacter("Gemli", { className: "Warrior", spec: "Fury", source: "wcl" });
            expect(getCharacter("Gemli")).toMatchObject({ spec: "Arms", source: "manual" });
            // …but another manual edit wins
            saveCharacter("Gemli", { className: "Warrior", spec: "Protection", source: "manual" });
            expect(getCharacter("Gemli").spec).toBe("Protection");
        });

        it("ignores a blank name or an empty payload", () => {
            expect(saveCharacter("", { className: "Mage" })).toBeNull();
            expect(saveCharacter("Nwek", {})).toBeNull();
            expect(listCharacters()).toEqual([]);
        });

        it("does not rewrite the file when nothing changed", () => {
            saveCharacter("Nwek", { className: "Mage", source: "export" });
            const writes = fs.writeFileSync.mock.calls.length;
            saveCharacter("Nwek", { className: "Mage", source: "export" });
            expect(fs.writeFileSync.mock.calls.length).toBe(writes);
        });

        it("falls back to the export source for an unknown source value", () => {
            expect(saveCharacter("Nwek", { className: "Mage", source: "hacked" }).source).toBe("export");
        });
    });

    describe("listCharacters / characterMap", () => {
        it("lists alphabetically and maps by key", () => {
            saveCharacter("Zwilin", { className: "Mage" });
            saveCharacter("Crimed", { className: "Rogue" });
            expect(listCharacters().map((c) => c.character)).toEqual(["Crimed", "Zwilin"]);
            expect(Object.keys(characterMap()).sort()).toEqual(["crimed", "zwilin"]);
        });
    });

    describe("getCharacter / deleteCharacter", () => {
        it("finds a character case-insensitively and removes it again", () => {
            saveCharacter("Gemli", { className: "Warrior" });
            expect(getCharacter("GEMLI")).not.toBeNull();
            expect(deleteCharacter("gemli")).toBe(true);
            expect(getCharacter("Gemli")).toBeNull();
            expect(deleteCharacter("Gemli")).toBe(false);
        });

        it("returns null for a blank name", () => {
            expect(getCharacter("")).toBeNull();
        });
    });

    it("tolerates a missing/corrupt file", () => {
        expect(listCharacters()).toEqual([]);
        expect(characterMap()).toEqual({});
    });
});
