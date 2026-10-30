// Wer darf welchen Raid leiten? (#1034)
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/roster/leaderFlagsStore");
const { canLead, userCanLead, leadInstances, leadsForVersion } = require("../../../src/services/roster/leaderFlags");

const LEADS = { tbc: { instances: ["kara", "gruul", "mag"] }, forever: { instances: ["forever-hyjal"] } };

describe("services/roster/leaderFlags canLead", () => {
    it("deckt ein Event mit einer Instanz ab", () => {
        expect(canLead(LEADS, "tbc", ["kara"])).toBe(true);
        expect(canLead(LEADS, "tbc", ["ssc"])).toBe(false);
    });

    it("verlangt bei mehreren Instanzen alle", () => {
        expect(canLead(LEADS, "tbc", ["gruul", "mag"])).toBe(true);
        expect(canLead(LEADS, "tbc", ["gruul", "ssc"])).toBe(false);
    });

    it("zählt bei einem Event ohne Instanz jedes Flag der Version", () => {
        expect(canLead(LEADS, "tbc", [])).toBe(true);
        expect(canLead(LEADS, "tbc", undefined)).toBe(true);
        expect(canLead(LEADS, "classic", [])).toBe(false);
    });

    it("trennt die Versionen strikt", () => {
        expect(canLead(LEADS, "tbc", ["forever-hyjal"])).toBe(false);
        expect(canLead({ forever: { instances: ["forever-hyjal"] } }, "tbc", [])).toBe(false);
    });

    it("macht niemanden ohne Flag zum Leader", () => {
        expect(canLead({}, "tbc", [])).toBe(false);
        expect(canLead(null, "tbc", ["kara"])).toBe(false);
        expect(leadInstances(undefined, "tbc")).toEqual([]);
    });
});

describe("services/roster/leaderFlags mit Store", () => {
    beforeEach(() => store.useFile(tempStoreFile("leader-flags.json")));
    afterAll(() => store.useFile(null));

    it("liest die Flags eines Kontos", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        expect(userCanLead("u1", "tbc", ["kara"])).toBe(true);
        expect(userCanLead("u2", "tbc", ["kara"])).toBe(false);
    });

    it("liefert die Flags vieler Konten für eine Version", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        store.setLeads("u2", "forever", ["forever-ony"]);
        expect(leadsForVersion(["u1", "u2", "u3", "u1"], "tbc")).toEqual({ u1: ["kara"] });
        expect(leadsForVersion(["u1", "u2"], "forever")).toEqual({ u2: ["forever-ony"] });
    });
});
