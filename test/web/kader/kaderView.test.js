// The Kaderplaner's merge (docs/kaderplaner.md): profile + planner assignment →
// player. The planner wins; a deviation is marked, never written back.
const { buildKaderView, mutationContext, publicView, diffAgainst } = require("../../../src/web/kader/kaderView");
const { emptyPlanner } = require("../../../src/services/kader/kaderModel");

const U1 = "111111111111111111";
const U2 = "222222222222222222";
const HAND = "444444444444444444";

const classes = [
    { key: "Warrior", name: "Krieger", specs: [{ key: "Warrior-Protection", role: "tank" }, { key: "Warrior-Fury", role: "melee" }] },
    { key: "Druid", name: "Druide", specs: [{ key: "Druid-Restoration", role: "healer" }, { key: "Druid-Balance", role: "ranged" }] },
];
const warrior = {
    key: "forever~aldric sturmwind", name: "Aldric Sturmwind", className: "Warrior", main: false,
    specs: [{ spec: "Warrior-Protection", gear: "ready" }, { spec: "Warrior-Fury", gear: "none" }], canTank: true, canHeal: false, logSpecs: ["Warrior-Fury"],
};
const druid = { key: "forever~mira sonnlicht", name: "Mira Sonnlicht", className: "Druid", main: true, specs: [{ spec: "Druid-Restoration", gear: "usable" }], canTank: false, canHeal: true, logSpecs: [] };

const source = (over = {}) => ({
    guildId: "g1",
    versionId: "forever",
    classes,
    instances: [],
    buffs: { raid: [], party: [] },
    members: [{ userId: U1, displayName: "Aldric", avatarUrl: null }, { userId: U2, displayName: "Bea", avatarUrl: null }],
    profiles: [{ userId: U1, characters: [warrior, druid], availability: ["mi", "do"] }],
    attendance: [{ userId: U1, attended: 3, counted: 4, rate: 0.75, nights: [{ date: "2026-12-18", eventId: "e1", title: "Hyjal", attended: true, reason: null }] }],
    warnings: [],
    ...over,
});

describe("web/kader/kaderView", () => {
    it("shows the profile's characters with its main active when the planner has nothing", () => {
        const view = buildKaderView({ source: source(), planner: emptyPlanner() });
        const [p] = view.players;
        expect(p).toMatchObject({ userId: U1, displayName: "Aldric", hasProfile: true, manual: false, hasOverride: false, differs: [], availability: ["mi", "do"] });
        expect(p.characters.map((c) => c.id)).toEqual(["p:forever~aldric sturmwind", "p:forever~mira sonnlicht"]);
        expect(p.activeCharacterId).toBe("p:forever~mira sonnlicht");
        expect(p.characters[0]).toMatchObject({ origin: "profile", mainSpec: "Warrior-Protection", role: "tank", gear: "ready" });
        expect(p.profile).toEqual({ character: "Mira Sonnlicht", className: "Druid", mainSpec: "Druid-Restoration", logSpecs: [] });
        expect(p.attendance).toEqual({ attended: 3, counted: 4, pct: 75, nights: [{ date: "2026-12-18", title: "Hyjal", attended: true, reason: null }] });
    });

    it("lets the planner's assignment win and marks what deviates from the profile", () => {
        const planner = {
            ...emptyPlanner(),
            assignments: { [U1]: {
                characters: [
                    { id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [{ spec: "Warrior-Fury", main: true, gear: "ready" }], canTank: false, canHeal: false, onlineKey: "forever~aldric sturmwind" },
                    { id: "c2", name: "Neu Name", className: "Druid", specs: [], canTank: false, canHeal: false },
                ],
                activeCharacterId: "c1",
            } },
        };
        const [p] = buildKaderView({ source: source(), planner }).players;
        expect(p.hasOverride).toBe(true);
        expect(p.activeCharacterId).toBe("c1");
        expect(p.differs).toEqual(["mainSpec", "tank"]);
        expect(p.characters[0]).toMatchObject({ origin: "planner", role: "melee" });
        expect(p.characters[1].differs).toEqual(["notInProfile"]);
        // the profile line still tells what the raider wrote
        expect(p.profile.mainSpec).toBe("Druid-Restoration");
    });

    it("adds hand-added accounts to the pool and marks the server's members", () => {
        const planner = { ...emptyPlanner(), accounts: [{ userId: HAND, displayName: "Hand", addedAt: "" }, { userId: U2, displayName: "Bea", addedAt: "" }] };
        const view = buildKaderView({ source: source(), planner });
        expect(view.players.map((p) => [p.userId, p.displayName, p.manual])).toEqual([[U1, "Aldric", false], [HAND, "Hand", true], [U2, "Bea", true]]);
        expect(view.players[1]).toMatchObject({ hasProfile: false, characters: [], activeCharacterId: null, attendance: null, profile: null });
        expect(view.members).toEqual([
            { userId: U1, displayName: "Aldric", inPool: true, hasProfile: true, profile: { className: "Druid", mainSpec: "Druid-Restoration" }, pct: 75 },
            { userId: U2, displayName: "Bea", inPool: true, hasProfile: false, profile: null, pct: null },
        ]);
    });

    it("shows no attendance while nothing is counted (rate null)", () => {
        const view = buildKaderView({ source: source({ attendance: [{ userId: U1, attended: 0, counted: 0, rate: null, nights: [] }] }), planner: emptyPlanner() });
        expect(view.players[0].attendance).toBeNull();
    });

    it("gives the mutators their helpers and keeps them off the wire", () => {
        const view = buildKaderView({ source: source(), planner: emptyPlanner() });
        const ctx = mutationContext(view);
        expect([...ctx.poolIds]).toEqual([U1]);
        expect([...ctx.memberIds]).toEqual([U1, U2]);
        expect(ctx.naturalRole(U1)).toBe("healer");
        expect(ctx.naturalRole(U2)).toBeNull();
        expect(ctx.playerInfo(U1)).toEqual({ classKey: "Druid", rate: 0.75 });
        expect(ctx.classes.get("Warrior").name).toBe("Krieger");
        expect(publicView(view)).not.toHaveProperty("poolIds");
    });

    it("diffs class changes and a character the profile does not know", () => {
        const idx = new Map(classes.map((c) => [c.key, c]));
        expect(diffAgainst({ name: "x", className: "Druid", specs: [], canTank: true, canHeal: false }, warrior, idx)).toEqual(["class", "mainSpec", "gear"]);
        expect(diffAgainst({ name: "x", className: "Druid", specs: [], canTank: false, canHeal: false }, null, idx)).toEqual(["notInProfile"]);
    });
});
