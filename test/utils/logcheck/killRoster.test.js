const { buildKillRoster } = require("../../../src/utils/logcheck/killRoster");

const unit = (id, name, type, fightIds) => ({ id, name, type, fights: fightIds.map((f) => ({ id: f })) });

describe("utils/logcheck/killRoster", () => {
    it("lists every boss kill with the players in it, in log order with absolute times", () => {
        const fights = {
            start: 1_700_000_000_000,
            fights: [
                { id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 },
                { id: 2, boss: 601, name: "Naj'entus", kill: true, start_time: 5000, end_time: 9000 },
                { id: 3, boss: 607, name: "Shahraz", kill: false, start_time: 10000, end_time: 12000 },
                { id: 4, boss: 607, name: "Shahraz", kill: true, start_time: 20000, end_time: 30000 },
            ],
            friendlies: [
                unit(1, "Tanky", "Warrior", [1, 2, 3, 4]),
                unit(2, "Gone", "Mage", [2, 3]),
                unit(3, "Wolf", "Pet", [2, 4]),
                unit(4, "Totem", "NPC", [4]),
            ],
        };
        expect(buildKillRoster(fights)).toEqual([
            { id: 2, encounterId: 601, boss: "Naj'entus", at: 1_700_000_005_000, players: ["Gone", "Tanky"] },
            { id: 4, encounterId: 607, boss: "Shahraz", at: 1_700_000_020_000, players: ["Tanky"] },
        ]);
    });

    it("leaves wipes and trash out and copes with a payload without kills", () => {
        expect(buildKillRoster({ fights: [{ id: 1, boss: 601, kill: false }], friendlies: [] })).toEqual([]);
        expect(buildKillRoster({})).toEqual([]);
        expect(buildKillRoster(null)).toEqual([]);
    });

    it("keeps a kill nobody is listed for (empty players) and skips nameless units", () => {
        const fights = {
            fights: [{ id: 7, boss: 609, name: "Illidan", kill: true, start_time: 100 }],
            friendlies: [{ id: 9, name: "", type: "Warrior", fights: [{ id: 7 }] }, { id: 10, name: "Solo", type: "Priest" }],
        };
        expect(buildKillRoster(fights)).toEqual([{ id: 7, encounterId: 609, boss: "Illidan", at: 100, players: [] }]);
    });
});
