// rosterComposition (#657): places per role against the slots, classes and the
// buffs of the version's rule set.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const { rosterComposition, memberCharacter } = require("../../../src/services/roster/rosterComposition");

const add = (userId, name, className, spec) => raiderProfileStore.addCharacter(userId, { name, className, specs: [spec] });

let roster;
beforeEach(() => {
    fs.__store.clear();
    roster = rosterStore.createRoster({ name: "Raid", slots: { total: 10, tank: 2, healer: 3, bench: 2 } });
    add("100001", "Brumm", "Warrior", "Warrior-Protection");
    add("100002", "Devi", "Priest", "Priest-Holy");
    add("100003", "Keslight", "Mage", "Mage-Frost");
    add("100004", "Klinge", "Rogue", "Rogue-Combat");
    add("100005", "Ersatz", "Mage", "Mage-Fire");
    rosterStore.upsertMember(roster.id, "100001", { status: "core", chars: ["brumm"] });
    rosterStore.upsertMember(roster.id, "100002", { status: "trial", chars: ["devi"] });
    rosterStore.upsertMember(roster.id, "100003", { status: "core", chars: ["keslight"] });
    rosterStore.upsertMember(roster.id, "100004", { status: "core", chars: ["klinge"] });
    rosterStore.upsertMember(roster.id, "100005", { status: "bench", chars: ["ersatz"] });
    rosterStore.upsertMember(roster.id, "100006", { status: "core", chars: ["Handname"] });
    rosterStore.upsertMember(roster.id, "100007", { status: "pause" });
});

describe("services/roster/rosterComposition", () => {
    it("counts roles of core and trial against the slots, bench apart", () => {
        const c = rosterComposition(rosterStore.getRoster(roster.id));
        expect(c.counts).toEqual({ core: 4, trial: 1, bench: 1, pause: 1 });
        expect(c.roles).toEqual([
            { role: "tank", target: 2, actual: 1 },
            { role: "healer", target: 3, actual: 1 },
            { role: "dps", target: 5, actual: 2 },
        ]);
        expect(c.dps).toEqual({ melee: 1, ranged: 1 });
        expect(c.unknown).toBe(1);
        expect(c.bench).toEqual({ target: 2, actual: 1 });
        expect(c.open).toBe(5);
    });

    it("lists the classes in the roster, most first, with the rule set's labels", () => {
        const c = rosterComposition(rosterStore.getRoster(roster.id));
        expect(c.classes.map((x) => [x.className, x.count])).toEqual([["Mage", 1], ["Priest", 1], ["Rogue", 1], ["Warrior", 1]]);
        expect(c.classes.find((x) => x.className === "Priest")).toEqual(expect.objectContaining({ label: "Priester", labelEn: "Priest", color: expect.any(String) }));
    });

    it("marks the buffs of the rule set the roster covers, with who brings them", () => {
        const c = rosterComposition(rosterStore.getRoster(roster.id));
        expect(c.buffsAvailable).toBe(true);
        const fort = c.buffs.find((b) => b.key === "fortitude");
        expect(fort).toEqual(expect.objectContaining({ scope: "raid", covered: true, providers: ["100002"] }));
        const motw = c.buffs.find((b) => b.key === "motw");
        expect(motw).toEqual(expect.objectContaining({ covered: false, providers: [] }));
        // the benched mage brings nothing
        expect(c.buffs.find((b) => b.key === "intellect").providers).toEqual(["100003"]);
    });

    it("knows no class for a character typed by hand or a member without one", () => {
        const fresh = rosterStore.getRoster(roster.id);
        expect(memberCharacter("100006", fresh.members["100006"], "tbc")).toBeNull();
        expect(memberCharacter("100007", fresh.members["100007"], "tbc")).toBeNull();
        expect(memberCharacter("100001", fresh.members["100001"], "tbc")).toEqual({ className: "Warrior", spec: "Warrior-Protection", role: "tank" });
    });

    it("never counts open places below zero", () => {
        const small = rosterStore.updateRoster(roster.id, { slots: { total: 2, tank: 0, healer: 0 } });
        expect(rosterComposition(small).open).toBe(0);
    });
});
