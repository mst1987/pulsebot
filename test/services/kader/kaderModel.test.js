// The Kaderplaner's planner (docs/kaderplaner.md): its shape and repair,
// accounts, character data and the Kader themselves. Refusals are AppErrors
// with their status.
const model = require("../../../src/services/kader/kaderModel");
const { U, NOW, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const ctx = kaderCtx();

function withKader(name = "Forever-Kader 2027") {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name }, ctx);
    return { planner, kaderId, kader: planner.kaders[0] };
}

describe("services/kader/kaderModel", () => {
    describe("normalizePlanner", () => {
        it("repairs anything into a valid planner", () => {
            expect(model.normalizePlanner(null)).toEqual(model.emptyPlanner());
            expect(model.normalizePlanner("x")).toEqual(model.emptyPlanner());
            const out = model.normalizePlanner({
                v: 2,
                accounts: [{ userId: U.hand, displayName: "Hand" }, { nope: 1 }, { userId: U.hand, displayName: "twice" }],
                assignments: { [U.a]: { characters: [{ id: "c", name: "A B", className: "Mage", specs: [{ spec: "Mage-Frost", gear: "shiny" }] }], activeCharacterId: "gone" } },
                kaders: [{
                    id: "k1", name: "  ", leads: [U.lead, U.lead, ""],
                    questions: [
                        { id: "q1", text: "Tage", type: "multi", options: [{ id: "o1", label: "Mo" }, { id: "o1", label: "dup" }, { id: "o2", label: "Di" }] },
                        { id: "q2", text: "Frei", type: "odd" },
                    ],
                    players: {
                        [U.a]: {
                            state: "nonsense",
                            wishes: [{ className: "Mage", spec: "Mage-Frost" }, { className: "Mage", spec: "Mage-Frost" }, { spec: "x" }],
                            interview: { answers: { q1: ["o2", "zz"], q2: "  ", gone: "x" }, note: "n" },
                            votes: { [U.lead]: "yes", [U.b]: "maybe" },
                            comments: [{ id: "c1", by: U.lead, text: "ok" }, { id: "c2", text: "   " }],
                            history: [{ type: "added", at: NOW, extra: "x" }, { at: NOW }],
                        },
                        [U.b]: { state: "roster", decision: { className: "Mage", spec: "Mage-Fire" } },
                    },
                    setups: [{ id: "v1", name: "", size: 25, groups: [[{ userId: U.b, spec: "Mage-Fire" }, { userId: U.b }, { userId: U.a }]] }],
                }],
            });
            expect(out.accounts).toEqual([{ userId: U.hand, displayName: "Hand", addedAt: "" }]);
            expect(out.assignments[U.a].activeCharacterId).toBe("c");
            const k = out.kaders[0];
            expect(k).toMatchObject({ name: "Kader", leads: [U.lead] });
            expect(k.questions.map((q) => [q.id, q.type, q.options.map((o) => o.id)])).toEqual([["q1", "multi", ["o1", "o2"]], ["q2", "text", []]]);
            const a = k.players[U.a];
            expect(a).toMatchObject({ state: "pool", wishes: [{ className: "Mage", spec: "Mage-Frost" }], votes: { [U.lead]: "yes" } });
            expect(a.interview.answers).toEqual({ q1: ["o2"] });
            expect(a.comments.map((c) => c.id)).toEqual(["c1"]);
            expect(a.history).toEqual([{ at: NOW, by: "", type: "added" }]);
            expect(k.players[U.b].decision).toEqual({ className: "Mage", spec: "Mage-Fire" });
            // a setup holds only players who may stand in one, each once; the size is 10 or 20
            expect(k.setups[0]).toMatchObject({ name: "Variante", size: 20 });
            expect(k.setups[0].groups[0]).toEqual([{ userId: U.b, spec: "Mage-Fire" }, null, null, null, null]);
            expect(k.setups[0].groups).toHaveLength(4);
        });

        it("never makes up ids while repairing, so two reads are the same", () => {
            const raw = { kaders: [{ id: "k1", name: "K", setups: [] }] };
            expect(model.normalizePlanner(raw)).toEqual(model.normalizePlanner(raw));
            expect(model.normalizePlanner(raw).kaders[0].setups).toEqual([]);
        });

        it("takes over an old planner of #566 with the planner's own character data", () => {
            const out = model.normalizePlanner({
                assignments: { [U.a]: { characters: [{ id: "c", name: "Aldric Sturm", className: "Warrior", specs: [{ spec: "Warrior-Fury", main: true }, { spec: "Warrior-Protection" }] }], activeCharacterId: "c" } },
                rosters: [{ id: "r1", name: "Hyjal", size: 20, members: [{ userId: U.a, role: "tank" }], bench: [U.b] }],
                setups: { r1: { variants: [{ id: "v1", name: "A", groups: [[U.a, U.b]] }] } },
            });
            const k = out.kaders[0];
            expect(k).toMatchObject({ id: "r1", name: "Hyjal" });
            expect(k.players[U.a]).toMatchObject({ state: "roster", decision: { className: "Warrior", spec: "Warrior-Protection" } });
            expect(k.players[U.b]).toMatchObject({ state: "bench", wishes: [] });
            expect(k.setups[0].groups[0].slice(0, 2)).toEqual([{ userId: U.a, spec: "Warrior-Protection" }, { userId: U.b, spec: "" }]);
            expect(out.rosters).toBeUndefined();
        });
    });

    describe("Kader", () => {
        it("creates a Kader led by its creator, with a first example setup", () => {
            const { kader, kaderId } = withKader();
            expect(kader).toMatchObject({ id: kaderId, name: "Forever-Kader 2027", leads: [U.lead], createdAt: NOW, createdBy: U.lead, questions: [], players: {} });
            // no raid category counts until a lead picks one
            expect(kader.attendanceCategories).toEqual([]);
            expect(kader.setups).toEqual([{ id: expect.any(String), name: "Variante A", size: 20, groups: model.emptyGroups() }]);
            expect(refusal(() => model.createKader(model.emptyPlanner(), { name: "" }, ctx)).status).toBe(400);
        });

        it("renames, changes the leads (never none) and deletes", () => {
            const { planner, kaderId } = withKader();
            let next = model.updateKader(planner, { kaderId, name: "Mittwoch", leads: [U.lead, U.lead2] }, ctx);
            expect(next.kaders[0]).toMatchObject({ name: "Mittwoch", leads: [U.lead, U.lead2] });
            expect(refusal(() => model.updateKader(next, { kaderId, leads: [] }, ctx)).message).toMatch(/Leitung/);
            expect(refusal(() => model.updateKader(next, { kaderId, leads: ["123"] }, ctx)).status).toBe(400);
            expect(refusal(() => model.updateKader(next, { kaderId: "nope", name: "x" }, ctx)).status).toBe(404);
            next = model.deleteKader(next, kaderId);
            expect(next.kaders).toEqual([]);
            expect(refusal(() => model.deleteKader(next, kaderId)).status).toBe(404);
        });

        it("keeps the raid categories attendance counts in: known ones only, each once, an empty pick allowed", () => {
            const { planner, kaderId } = withKader();
            const withCats = { ...ctx, raidCategoryIds: new Set(["c-mo", "c-do", "c-pug"]) };
            let next = model.updateKader(planner, { kaderId, attendanceCategories: ["c-do", " c-mo ", "c-do", "c-gone", 42] }, withCats);
            // an id the server does not know as a raid category is left out, not refused
            expect(next.kaders[0].attendanceCategories).toEqual(["c-do", "c-mo"]);
            // name and leads stay as they are
            expect(next.kaders[0]).toMatchObject({ name: "Forever-Kader 2027", leads: [U.lead] });
            next = model.updateKader(next, { kaderId, attendanceCategories: [] }, withCats);
            expect(next.kaders[0].attendanceCategories).toEqual([]);
            // without the server's list nothing is known, so nothing is kept
            expect(model.updateKader(planner, { kaderId, attendanceCategories: ["c-mo"] }, ctx).kaders[0].attendanceCategories).toEqual([]);
            expect(refusal(() => model.updateKader(planner, { kaderId, attendanceCategories: "c-mo" }, withCats)).status).toBe(400);
        });

        it("repairs a stored pick on read and gives an old Kader an empty one", () => {
            const many = Array.from({ length: 30 }, (_, i) => `c${i}`);
            const out = model.normalizePlanner({ v: 2, kaders: [
                { id: "k1", name: "Alt" },
                { id: "k2", name: "Neu", attendanceCategories: ["c1", "c1", "", null, 7, ...many] },
            ] });
            expect(out.kaders[0].attendanceCategories).toEqual([]);
            expect(out.kaders[1].attendanceCategories.slice(0, 3)).toEqual(["c1", "7", "c0"]);
            expect(out.kaders[1].attendanceCategories).toHaveLength(model.LIMITS.attendanceCategories);
        });
    });

    describe("accounts", () => {
        it("knows an account by hand (a second time only refreshes the name), optionally with a first character", () => {
            let p = model.addAccount(model.emptyPlanner(), { userId: U.hand, displayName: " Bea ", character: { firstName: "rikka", lastName: "FELDMARK", className: "Shaman" } }, ctx);
            expect(p.accounts).toEqual([{ userId: U.hand, displayName: "Bea", addedAt: NOW }]);
            expect(p.assignments[U.hand].characters[0]).toMatchObject({ name: "Rikka Feldmark", className: "Shaman", nameStyle: "forever" });
            p = model.addAccount(p, { userId: U.hand, displayName: "Bea 2" }, ctx);
            expect(p.accounts).toEqual([{ userId: U.hand, displayName: "Bea 2", addedAt: NOW }]);
            expect(refusal(() => model.addAccount(model.emptyPlanner(), { userId: "12345", displayName: "x" }, ctx)).status).toBe(400);
            expect(refusal(() => model.addAccount(model.emptyPlanner(), { userId: U.hand, displayName: "" }, ctx)).status).toBe(400);
            const nick = model.addAccount(model.emptyPlanner(), { userId: U.hand, displayName: "H", character: { nameStyle: "nick", nickname: "Knuffel", className: "Mage" } }, ctx);
            expect(nick.assignments[U.hand].characters[0]).toMatchObject({ name: "Knuffel", nameStyle: "nick" });
        });

        it("forgets a hand-added account everywhere, and only such one", () => {
            let { planner } = withKader();
            planner = model.addAccount(planner, { userId: U.hand, displayName: "Hand" }, ctx);
            planner.kaders[0].players[U.hand] = { state: "pool" };
            const out = model.removeAccount(planner, U.hand);
            expect(out.accounts).toEqual([]);
            expect(out.kaders[0].players).toEqual({});
            expect(refusal(() => model.removeAccount(out, U.a)).status).toBe(404);
        });
    });

    describe("character data", () => {
        const char = (over = {}) => ({ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [{ spec: "Warrior-Fury", gear: "ready" }, { spec: "Warrior-Protection", main: true }], ...over });

        it("stores the planner's characters with exactly one main spec and what the class can", () => {
            const p = model.setAssignment(model.emptyPlanner(), U.a, { characters: [char({ canTank: true, canHeal: true })], activeCharacterId: "c1" }, ctx);
            const [c] = p.assignments[U.a].characters;
            expect(c.specs).toEqual([{ spec: "Warrior-Fury", main: false, gear: "ready" }, { spec: "Warrior-Protection", main: true, gear: "none" }]);
            expect(c).toMatchObject({ canTank: true, canHeal: false, nameStyle: "forever" });
        });

        it("checks names by their style, classes and specs, and knows only known accounts", () => {
            const bad = (over, who = U.a) => refusal(() => model.setAssignment(model.emptyPlanner(), who, { characters: [char(over)] }, ctx));
            expect(bad({ name: "Aldric" }).message).toMatch(/Vorname und Nachname/);
            expect(bad({ name: "Aldric Sturmwindwindig" }).message).toMatch(/12/);
            expect(bad({ className: "Monk" }).message).toMatch(/Klasse/);
            expect(bad({ specs: [{ spec: "Mage-Frost" }] }).message).toMatch(/Spec/);
            expect(bad({ name: "K", nameStyle: "nick" }).message).toMatch(/2 bis 24/);
            expect(bad({ name: "Hitler", nameStyle: "nick" }).message).toMatch(/nicht erlaubt/);
            expect(bad({}, "999999999999999999").status).toBe(404);
            const ok = model.setAssignment(model.emptyPlanner(), U.a, { characters: [char({ name: "Der Große Bär-2", nameStyle: "nick" })] }, ctx);
            expect(ok.assignments[U.a].characters[0]).toMatchObject({ name: "Der Große Bär-2", nameStyle: "nick" });
        });

        it("resets back to the profile", () => {
            const p = model.setAssignment(model.emptyPlanner(), U.a, { characters: [char()] }, ctx);
            expect(model.resetAssignment(p, U.a).assignments).toEqual({});
            expect(refusal(() => model.resetAssignment(model.emptyPlanner(), U.a)).status).toBe(404);
        });

        it("gives characters stored before the name styles one by their name", () => {
            const out = model.normalizePlanner({ v: 2, assignments: { [U.a]: { characters: [
                { id: "a", name: "Aldric Sturmwind", className: "Warrior" },
                { id: "b", name: "Knuffel", className: "Mage" },
                { id: "c", name: "Mira Sonnlicht", nameStyle: "nick", className: "Druid" },
            ] } } });
            expect(out.assignments[U.a].characters.map((c) => c.nameStyle)).toEqual(["forever", "nick", "nick"]);
        });
    });

    it("refuses a class/spec pair the rule set does not know", () => {
        expect(model.cleanClassSpec({ className: "Mage", spec: "Mage-Fire" }, ctx)).toEqual({ className: "Mage", spec: "Mage-Fire" });
        expect(refusal(() => model.cleanClassSpec({ className: "Mage", spec: "Warrior-Fury" }, ctx)).status).toBe(400);
        expect(refusal(() => model.cleanClassSpec({ className: "Monk", spec: "x" }, ctx)).status).toBe(400);
    });
});
