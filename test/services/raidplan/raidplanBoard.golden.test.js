// Golden master of raidplanBoard.cleanBoard (#424): the cleaner was split into
// one function per kind of board object; the output for a board that walks
// every section must stay exactly what it was before the split. New ids are
// counted (gen1, gen2, ...) so a replaced duplicate id is deterministic, too.
let mockIdCount = 0;
jest.mock("../../../src/utils/ids", () => ({ ...jest.requireActual("../../../src/utils/ids"), newId: () => `gen${++mockIdCount}` }));

const board = require("../../../src/services/raidplan/raidplanBoard");
const { input, options, many } = require("../../fixtures/raidplanBoard/cleanBoardInput");
const golden = require("../../fixtures/raidplanBoard/cleanBoardGolden.json");

describe("raidplanBoard.cleanBoard golden master", () => {
    beforeEach(() => { mockIdCount = 0; });

    it("cleans a board with every kind of object exactly as before", () => {
        expect(board.cleanBoard(input, options)).toEqual(golden.board);
    });

    it("keeps any well-formed player for ANY_PLAYER, drops everything without tokens allowed, defaults an empty board", () => {
        expect(board.cleanBoard({ tokens: [{ userId: "any-1", x: 0.5, y: 0.5 }, { userId: "bad id!", x: 0, y: 0 }], targets: [{ id: "t", userIds: ["any-2"] }] }, { allowedUserIds: board.ANY_PLAYER }))
            .toEqual(golden.anyPlayer);
        mockIdCount = 0;
        expect(board.cleanBoard({ tokens: [{ userId: "u1" }] }, { allowedUserIds: ["u1"], allowTokens: false })).toEqual(golden.noTokens);
        mockIdCount = 0;
        expect(board.cleanBoard(null)).toEqual(golden.empty);
    });

    it("refuses a board over any limit, naming the limit — the first section over it wins", () => {
        const allowedUserIds = many(80, (i) => `u${i}`);
        const over = (key, n, make) => board.cleanBoard({ [key]: many(n, make) }, { allowedUserIds });
        expect(over("tokens", 61, (i) => ({ userId: `u${i}` }))).toEqual({ code: "invalid", error: "Höchstens 60 Spieler je Boss." });
        expect(over("slots", 61, () => ({ kind: "tank" }))).toEqual({ code: "invalid", error: "Höchstens 60 Slots je Boss." });
        expect(over("marks", 41, () => ({ mark: "skull" }))).toEqual({ code: "invalid", error: "Höchstens 40 Marker je Boss." });
        expect(over("icons", 61, () => ({ iconKey: "enemy" }))).toEqual({ code: "invalid", error: "Höchstens 60 Icons je Boss." });
        expect(over("zones", 31, () => ({}))).toEqual({ code: "invalid", error: "Höchstens 30 Zonen je Boss." });
        expect(over("lines", 41, () => ({}))).toEqual({ code: "invalid", error: "Höchstens 40 Linien je Boss." });
        expect(over("texts", 41, () => ({ text: "x" }))).toEqual({ code: "invalid", error: "Höchstens 40 Texte je Boss." });
        expect(over("targets", 31, () => ({}))).toEqual({ code: "invalid", error: "Höchstens 30 Aufgabenzeilen je Boss." });
        expect(over("assignments", 500, () => ({})).code).toBe("invalid");
        expect(over("steps", 500, () => ({})).code).toBe("invalid");
        // slots over the limit and marks over the limit: the slots are named
        expect(board.cleanBoard({ slots: many(61, () => ({ kind: "tank" })), marks: many(41, () => ({ mark: "skull" })) }).error).toBe("Höchstens 60 Slots je Boss.");
    });
});
