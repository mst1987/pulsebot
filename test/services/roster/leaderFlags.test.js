// Wer darf welchen Raid leiten? (#1034) - und wo darf die Orga Flags anderer schalten (ihr Kontext)?
jest.mock("../../../src/stores/events/raidTemplateStore", () => ({
    getRaidTemplate: jest.fn((id) => (id === "tpl-t5" ? { id, instanceIds: ["ssc", "tk"] } : null)),
}));
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    canOrgaEvent: jest.fn(async (user, event) => user.id === "mgr" && event.categoryId === "cat1"),
}));
const { tempStoreFile } = require("../../helpers/tempStore");
const store = require("../../../src/stores/roster/leaderFlagsStore");
const eventStore = require("../../../src/stores/events/eventStore");
const { emptyAccess } = require("../../../src/config/permissions");
const {
    canLead, userCanLead, userCanLeadEvent, leadInstances, leadsForVersion,
    categoryLeadInstances, eventLeadContext, rosterLeadContext, setLeadsInContext, mayOrgaRosterLeads,
} = require("../../../src/services/roster/leaderFlags");

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

describe("services/roster/leaderFlags userCanLeadEvent", () => {
    beforeEach(() => store.useFile(tempStoreFile("leader-flags.json")));
    afterAll(() => store.useFile(null));

    it("nimmt Version und Instanzen aus dem Event", () => {
        store.setLeads("u1", "tbc", ["kara"]);
        expect(userCanLeadEvent("u1", { versionId: "tbc", instanceIds: ["kara"] })).toBe(true);
        expect(userCanLeadEvent("u1", { versionId: "tbc", instanceIds: ["kara", "gruul"] })).toBe(false);
        expect(userCanLeadEvent("u1", { versionId: "tbc", instanceIds: [] })).toBe(true);
        expect(userCanLeadEvent("u1", { versionId: "forever", instanceIds: [] })).toBe(false);
        expect(userCanLeadEvent("u1", null)).toBe(false);
    });
});

describe("services/roster/leaderFlags Kontext der Orga", () => {
    const now = Date.now();
    const CONFIG = { categoryRaidTemplate: { cat1: "tpl-t5" } };
    function raid(categoryId, instanceIds, daysFromNow, versionId = "tbc") {
        return eventStore.createEvent({
            guildId: "g1", channelId: "c1", categoryId, title: "R", versionId, instanceIds,
            startTime: Math.floor(now / 1000) + daysFromNow * 86400, size: 10,
        }).event;
    }
    beforeEach(() => {
        store.useFile(tempStoreFile("leader-flags.json"));
        eventStore.useFile(tempStoreFile("events.json"));
    });
    afterAll(() => store.useFile(null));

    it("die Kategorie: Raids der Version (90 Tage zurück und kommend) plus die Raid-Vorlage", () => {
        raid("cat1", ["kara"], 3);
        raid("cat1", ["gruul"], -10);
        raid("cat1", ["mag"], -200);
        raid("cat2", ["hyjal"], 3);
        raid("cat1", ["forever-hyjal"], 3, "forever");
        expect(categoryLeadInstances("cat1", "tbc", { config: CONFIG, guildId: "g1", now })).toEqual(["kara", "gruul", "ssc", "tk"]);
        expect(categoryLeadInstances("cat2", "tbc", { config: CONFIG, guildId: "g1", now })).toEqual(["hyjal"]);
        expect(categoryLeadInstances("cat3", "tbc", { config: CONFIG, guildId: "g1", now })).toEqual([]);
        expect(categoryLeadInstances("", "tbc", { config: CONFIG })).toEqual([]);
        expect(categoryLeadInstances("cat1", "gibtsnicht", { config: CONFIG })).toEqual([]);
    });

    it("ein Raid: seine Instanzen, ohne Instanz die der Kategorie", () => {
        const kara = raid("cat1", ["kara"], 3);
        expect(eventLeadContext(kara, { config: CONFIG, now })).toEqual({ versionId: "tbc", instances: ["kara"] });
        const open = { categoryId: "cat1", guildId: "g1", versionId: "tbc", instanceIds: [] };
        expect(eventLeadContext(open, { config: CONFIG, now })).toEqual({ versionId: "tbc", instances: ["kara", "ssc", "tk"] });
        expect(rosterLeadContext({ categoryId: "cat1", guildId: "g1", versionId: "tbc" }, { config: CONFIG, now }))
            .toEqual({ versionId: "tbc", instances: ["kara", "ssc", "tk"] });
        expect(rosterLeadContext({ categoryId: "", versionId: "tbc" }, { config: CONFIG }).instances).toEqual([]);
    });

    it("mischt die Kontext-Instanzen in die übrigen Flags (kein Ersetzen)", () => {
        store.setLeads("u1", "tbc", ["ssc", "kara"], { by: "u1" });
        let done = setLeadsInContext("u1", "tbc", ["kara", "gruul"], ["gruul"], { by: "orga" });
        expect(done.entry).toMatchObject({ instances: ["gruul", "ssc"], by: "orga" });
        done = setLeadsInContext("u1", "tbc", ["kara", "gruul"], [], { by: "orga" });
        expect(done.entry.instances).toEqual(["ssc"]);
    });

    it("lehnt Instanzen außerhalb des Kontexts und unbekannte Versionen ab, ohne zu schreiben", () => {
        store.setLeads("u1", "tbc", ["ssc"], { by: "u1" });
        expect(setLeadsInContext("u1", "tbc", ["kara"], ["kara", "ssc"], { by: "orga" })).toEqual({ error: "outside_context", outside: ["ssc"] });
        expect(setLeadsInContext("u1", "gibtsnicht", ["kara"], ["kara"], { by: "orga" })).toEqual({ error: "unknown_version" });
        expect(store.leadsOf("u1").tbc).toMatchObject({ instances: ["ssc"], by: "u1" });
    });

    it("mayOrgaRosterLeads: globale Orga mit Schreibrecht oder die Orga der Kategorie", async () => {
        const write = { ...emptyAccess(), raids: { read: true, write: true } };
        const roster = { id: "r1", categoryId: "cat1", versionId: "tbc" };
        expect(await mayOrgaRosterLeads({ id: "orga", isOrga: true, access: write }, roster)).toBe(true);
        expect(await mayOrgaRosterLeads({ id: "orga", isOrga: true, access: write }, { ...roster, closedAt: 1 })).toBe(false);
        expect(await mayOrgaRosterLeads({ id: "mgr", access: emptyAccess() }, roster)).toBe(true);
        expect(await mayOrgaRosterLeads({ id: "mgr", access: emptyAccess() }, { ...roster, categoryId: "cat2" })).toBe(false);
        expect(await mayOrgaRosterLeads({ id: "mgr", access: emptyAccess() }, { ...roster, categoryId: "" })).toBe(false);
        expect(await mayOrgaRosterLeads(null, roster)).toBe(false);
    });
});
