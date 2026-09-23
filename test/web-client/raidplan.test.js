// Raidplan (docs/raidplan.md): the board logic behind the editor
// (src/web-client/src/lib/raidplan.ts) run for real, and the pages' structure
// checked on the source — the client is TSX without a React renderer here.
const fs = require("fs");
const path = require("path");
const { loadTs, read, makeT, stripComments, allDicts } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts", { t: makeT("de") });
const libEn = loadTs("lib/raidplan.ts", { t: makeT("en") });

const player = (userId, role = "dps") => ({ userId, character: userId, classId: "", className: "", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1 });
const board = (extra = {}) => ({ ...lib.emptyBoard(), ...extra });
const profile = (extra = {}) => ({ id: "p1", name: "Tanks", category: "Tank", bossKey: "", targets: [{ title: "Main-Tank" }, { title: "Off-Tank" }], notes: "", updatedAt: 0, ...extra });

describe("roles and clamping", () => {
    it("colours tank blue, healer cyan and everything else as damage", () => {
        expect(lib.roleTone("tank")).toBe("tank");
        expect(lib.roleTone("healer")).toBe("healer");
        for (const r of ["melee", "ranged", "dps", "", "whatever"]) expect(lib.roleTone(r)).toBe("dps");
    });

    it("clamps a coordinate to 0..1 and treats junk as 0", () => {
        expect(lib.clamp01(-2)).toBe(0);
        expect(lib.clamp01(3)).toBe(1);
        expect(lib.clamp01(0.4)).toBe(0.4);
        expect(lib.clamp01(NaN)).toBe(0);
    });
});

describe("boards", () => {
    it("completes the board of an untouched boss", () => {
        expect(lib.boardOf({}, "bt/supremus")).toEqual({ tokens: [], slots: [], marks: [], zones: [], targets: [], notes: "", profileId: "" });
        expect(lib.boardOf({ "bt/supremus": { notes: "x" } }, "bt/supremus")).toMatchObject({ notes: "x", tokens: [] });
    });

    it("lists who is not placed yet, in setup order", () => {
        const roster = [player("a"), player("b"), player("c")];
        expect(lib.unplaced(roster, board({ tokens: [{ userId: "b", x: 0.5, y: 0.5 }] })).map((p) => p.userId)).toEqual(["a", "c"]);
    });

    it("places a token once and moves it afterwards, clamped to the board", () => {
        let b = lib.placeToken(board(), "a", 0.3, 0.6);
        expect(b.tokens).toEqual([{ userId: "a", x: 0.3, y: 0.6 }]);
        b = lib.placeToken(b, "a", 1.4, -0.2);
        expect(b.tokens).toEqual([{ userId: "a", x: 1, y: 0 }]);
        b = lib.placeToken(b, "b", 0.1, 0.1);
        expect(b.tokens.map((t) => t.userId)).toEqual(["a", "b"]);
    });

    it("takes a token off without touching the rows and nudges within the board", () => {
        const b = board({ tokens: [{ userId: "a", x: 0.5, y: 0.5 }], targets: [{ id: "r", title: "MT", userIds: ["a"] }] });
        expect(lib.removeToken(b, "a").tokens).toEqual([]);
        expect(lib.removeToken(b, "a").targets[0].userIds).toEqual(["a"]);
        expect(lib.nudgeObject(b, "token", "a", 0.01, -0.01).tokens[0]).toEqual({ userId: "a", x: 0.51, y: 0.49 });
        expect(lib.nudgeObject(lib.placeToken(b, "a", 0.999, 0), "token", "a", 0.05, -0.05).tokens[0]).toEqual({ userId: "a", x: 1, y: 0 });
        expect(lib.nudgeObject(b, "token", "nobody", 0.1, 0.1)).toBe(b);
    });

    it("counts tokens and rows for the boss list", () => {
        const bosses = { a: { tokens: [{ userId: "x", x: 0, y: 0 }], targets: [{ id: "1", title: "t", userIds: [] }] } };
        expect(lib.boardCount(bosses, "a")).toBe(2);
        expect(lib.boardCount(bosses, "b")).toBe(0);
    });

    it("compares what a save would carry, not the incidental shape", () => {
        const keys = ["a", "b"];
        expect(lib.sameBosses({}, { a: undefined }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "x", tokens: [], targets: [], profileId: "" } }, keys)).toBe(true);
        expect(lib.sameBosses({ a: { notes: "x" } }, { a: { notes: "y" } }, keys)).toBe(false);
        // a boss the event does not have is not part of the save
        expect(lib.sameBosses({ gone: { notes: "x" } }, {}, keys)).toBe(true);
        expect(Object.keys(lib.toSave({ a: { notes: "x" }, gone: { notes: "y" } }, keys))).toEqual(["a"]);
    });
});

describe("target rows", () => {
    it("adds, renames, assigns once, unassigns and removes", () => {
        const row = lib.newTarget("Main-Tank");
        expect(row).toMatchObject({ title: "Main-Tank", userIds: [] });
        expect(row.id).toMatch(/^r/);
        let b = board({ targets: [row] });
        b = lib.updateTarget(b, row.id, { title: "MT" });
        expect(b.targets[0].title).toBe("MT");
        b = lib.toggleAssignee(b, row.id, "u1");
        b = lib.toggleAssignee(b, row.id, "u2");
        expect(b.targets[0].userIds).toEqual(["u1", "u2"]);
        b = lib.toggleAssignee(b, row.id, "u1");
        expect(b.targets[0].userIds).toEqual(["u2"]);
        expect(lib.removeTarget(b, row.id).targets).toEqual([]);
    });

    it("gives every new row its own id", () => {
        expect(new Set(Array.from({ length: 50 }, () => lib.newRowId())).size).toBe(50);
    });
});

describe("tactic profiles", () => {
    it("asks first only when the board holds something", () => {
        expect(lib.hasContent(board())).toBe(false);
        expect(lib.hasContent(board({ notes: "  " }))).toBe(false);
        expect(lib.hasContent(board({ notes: "x" }))).toBe(true);
        expect(lib.hasContent(board({ targets: [lib.newTarget("a")] }))).toBe(true);
    });

    it("applies a profile: its rows and the profile id, players stay on rows whose title stays", () => {
        const b = board({
            tokens: [{ userId: "a", x: 0.5, y: 0.5 }],
            targets: [{ id: "keep", title: "main-tank", userIds: ["u1"] }, { id: "old", title: "Something else", userIds: ["u2"] }],
            notes: "mine",
        });
        const r = lib.applyProfile(b, profile());
        expect(r.profileId).toBe("p1");
        expect(r.targets.map((x) => x.title)).toEqual(["Main-Tank", "Off-Tank"]);
        expect(r.targets[0]).toMatchObject({ id: "keep", userIds: ["u1"] });
        expect(r.targets[1].userIds).toEqual([]);
        expect(r.tokens).toEqual(b.tokens);
        // an empty profile note does not wipe the board's own note; a filled one replaces it
        expect(r.notes).toBe("mine");
        expect(lib.applyProfile(b, profile({ notes: "phase 1" })).notes).toBe("phase 1");
    });

    it("saves only the row titles as a profile", () => {
        const b = board({ targets: [{ id: "1", title: " MT ", userIds: ["u1"] }, { id: "2", title: "  ", userIds: [] }] });
        expect(lib.profileRows(b)).toEqual([{ title: "MT" }]);
    });

    it("offers the profiles for every boss, the boss's instance or exactly this boss", () => {
        const all = profile({ id: "all" });
        const inst = profile({ id: "inst", bossKey: "bt" });
        const here = profile({ id: "here", bossKey: "bt/supremus" });
        const other = profile({ id: "other", bossKey: "bt/illidan-stormrage" });
        const elsewhere = profile({ id: "kara", bossKey: "kara" });
        expect(lib.profilesFor([all, inst, here, other, elsewhere], "bt/supremus").map((p) => p.id)).toEqual(["all", "inst", "here"]);
    });

    it("groups by category, filtered by a search, with the uncategorised last", () => {
        const ps = [profile({ id: "1", name: "Zeta", category: "Tank" }), profile({ id: "2", name: "Alpha", category: "" }), profile({ id: "3", name: "Beta", category: "Heiler" })];
        expect(lib.groupProfiles(ps, "").map((g) => g.category)).toEqual(["Heiler", "Tank", ""]);
        expect(lib.groupProfiles(ps, "  ZETA ").map((g) => g.profiles.map((p) => p.id))).toEqual([["1"]]);
        expect(lib.groupProfiles(ps, "heil").map((g) => g.profiles[0].id)).toEqual(["3"]);
        expect(lib.groupProfiles(ps, "nothing")).toEqual([]);
    });

    it("looks players up by userId", () => {
        const m = lib.rosterMap([player("a"), player("b")]);
        expect(m.get("b").userId).toBe("b");
        expect(m.get("zzz")).toBeUndefined();
    });
});

describe("the pages", () => {
    const tab = read("pages/raid-detail/RaidplanTab.tsx");
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const board2 = read("components/raidplan/PlanBoard.tsx");
    const detail = read("pages/RaidDetailPage.tsx");
    const app = read("App.tsx");
    const pub = read("pages/PlanPublicPage.tsx");
    const css = read("styles/raidplan.css");

    it("is a tab of an own event only, after the setup", () => {
        expect(detail).toMatch(/const TABS: Tab\[\] = \["roster", "setup", "plan", "loot", "logs"\];/);
        expect(detail).toMatch(/\(t !== "setup" && t !== "plan"\) \|\| ownEvent/);
        expect(detail).toContain("{shown === \"plan\" && <RaidplanTab ctx={ctx} />}");
    });

    it("drags with Pointer Events on window, never with HTML5 drag and drop", () => {
        const src = stripComments(tab + work + board2);
        expect(src).toContain("window.addEventListener(\"pointermove\"");
        expect(src).toContain("window.addEventListener(\"pointerup\"");
        expect(src).toContain("window.addEventListener(\"pointercancel\"");
        for (const banned of ["onDragStart", "onDrop", "onDragOver", "draggable={true}", "dataTransfer"]) expect(src).not.toContain(banned);
        // fingers: the draggable things do not scroll the page
        expect(css).toMatch(/\.rp-token\.is-editable \.rp-token-btn \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-zone\.is-editable \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-handle \{[^}]*touch-action: none/);
        expect(css).toMatch(/\.rp-chip\.is-drag \{[^}]*touch-action: none/);
    });

    it("sends the version it read, treats a conflict as a hint and writes nothing before Save", () => {
        expect(tab).toContain("version: view.plan.version");
        expect(tab).toContain("e.code === \"conflict\"");
        expect(tab).toContain("raidBoard.conflict.text");
        // the drag only edits the local draft
        expect(tab.match(/saveRaidplan\(/g)).toHaveLength(1);
    });

    it("draws players with their spec icon in a role ring, not with hand-drawn circles", () => {
        expect(board2).toContain("player.iconUrl");
        expect(board2).toContain("rp-role-${roleTone(player.role)}");
        expect(board2).not.toMatch(/<svg|<circle/);
        expect(css).toMatch(/\.rp-role-tank \{ --ring: var\(--rp-tank\)/);
        expect(css).toMatch(/--rp-tank: #60a5fa; --rp-healer: #35d6c4; --rp-dps: #f59e0b/);
    });

    it("answers the public route before the menu asks for a session", () => {
        expect(app).toMatch(/pathname\.match\(\/\^\\\/p\\\/\(\[A-Za-z0-9_-\]\+\)\\\/\?\$\/\)/);
        expect(app).toMatch(/if \(publicPlan\) return <PlanPublicPage token=\{publicPlan\[1\]\} \/>;\s*\n\s*return <MenuApp \/>;/);
        expect(pub).toContain("getRaidplanPublic(token)");
        expect(pub).toContain("data.me");
        expect(pub).not.toContain("csrfToken");
    });

    it("keeps to its own css namespace and the app's tokens", () => {
        const classes = [...css.matchAll(/\.([a-z]{2,4}-[\w-]+)/g)].map((m) => m[1]);
        const prefixes = new Set(classes.map((c) => c.split("-")[0]));
        // "rp-", plus the two shared building blocks it re-uses (dialogs' btn/flash aside)
        expect([...prefixes].filter((p) => p !== "rp" && p !== "is")).toEqual([]);
        expect(css).toContain("var(--accent)");
        expect(css).toContain("var(--panel)");
    });
});

describe("the texts", () => {
    it("exist in German and English for every key the raid plan asks for", () => {
        const { de, en } = allDicts();
        const files = ["pages/RaidplanTemplatesPage.tsx", "pages/raid-detail/raidplan/BoardWorkspace.tsx", "pages/raid-detail/raidplan/ObjectModals.tsx", "pages/raid-detail/RaidplanTab.tsx", "pages/raid-detail/raidplan/TargetsPanel.tsx", "pages/raid-detail/raidplan/ProfileModals.tsx", "pages/raid-detail/raidplan/ShareModal.tsx", "pages/raid-detail/raidplan/MapModal.tsx", "pages/PlanPublicPage.tsx", "components/raidplan/PlanBoard.tsx"];
        const keys = new Set();
        for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"((?:raidBoard|planTemplates)\.[\w.]+)"/g)) keys.add(m[1]);
        expect(keys.size).toBeGreaterThan(90);
        const missing = [...keys].filter((k) => de[k] === undefined || en[k] === undefined);
        expect(missing).toEqual([]);
        // the role labels are looked up by a computed key
        for (const role of ["tank", "healer", "dps"]) expect(de[`raidBoard.role.${role}`]).toBeTruthy();
        // the labels that are looked up by a computed key
        for (const k of ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]) expect([de, en].map((d) => d[`raidBoard.mark.${k}`])).not.toContain(undefined);
        for (const k of ["danger", "healthy", "neutral", "custom", "rect", "ellipse"]) expect([de, en].map((d) => d[`raidBoard.zone.${k}`])).not.toContain(undefined);
        for (const k of ["tank", "healer", "dps", "group"]) expect([de, en].map((d) => [d[`raidBoard.slot.${k}`], d[`raidBoard.slot.kind.${k}`]])).not.toContain(undefined);
        expect(de["raidBoard.slot.kind.label"]).toBeTruthy();
        expect(de["raidDetail.page.tab.plan"]).toBe("Raidplan");
        expect(en["raidDetail.page.tab.plan"]).toBe("Raid plan");
    });

    it("keeps the two languages' placeholders in step", () => {
        const de = makeT("de");
        const en = makeT("en");
        expect(de("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(en("raidBoard.profile.applyTitle", { name: "X" })).toContain("X");
        expect(de("raidBoard.bar.savedDropped", { count: 2 })).toContain("2");
    });

    it("has no leftover file for the wrong namespace", () => {
        const dir = path.join(__dirname, "..", "..", "src", "web-client", "src", "i18n", "locales");
        expect(fs.existsSync(path.join(dir, "de", "raidBoard.json"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "en", "raidBoard.json"))).toBe(true);
    });
});

describe("board objects", () => {
    it("adds slots with the next free number per kind and a free label as it is", () => {
        let b = lib.addSlot(lib.emptyBoard(), "tank", "");
        b = lib.addSlot(b, "tank", "");
        b = lib.addSlot(b, "healer", "");
        b = lib.addSlot(b, "label", "Boss-Tank");
        expect(b.slots.map((s) => [s.kind, s.n, s.label])).toEqual([["tank", 1, ""], ["tank", 2, ""], ["healer", 1, ""], ["label", 1, "Boss-Tank"]]);
        expect(new Set(b.slots.map((s) => s.id)).size).toBe(4);
        expect(b.slots.every((s) => s.x > 0.3 && s.x < 0.7 && s.userId === "")).toBe(true);
        // a slot added after one was deleted takes the highest number + 1, never a duplicate
        const gap = lib.removeObject(b, "slot", b.slots[0].id);
        expect(lib.addSlot(gap, "tank", "").slots.filter((s) => s.kind === "tank").map((s) => s.n)).toEqual([2, 3]);
    });

    it("titles a slot in the active language, with its own label winning", () => {
        const slot = { id: "a", kind: "tank", n: 2, label: "", x: 0, y: 0, userId: "" };
        expect(lib.slotTitle(slot)).toBe("Tank 2");
        expect(lib.slotTitle({ ...slot, kind: "healer" })).toBe("Heiler 2");
        expect(libEn.slotTitle({ ...slot, kind: "healer" })).toBe("Healer 2");
        expect(lib.slotTitle({ ...slot, kind: "group" })).toBe("Gruppe 2");
        expect(lib.slotTitle({ ...slot, label: "MT" })).toBe("MT");
        expect(lib.slotTitle({ ...slot, kind: "label", label: "Boss-Tank" })).toBe("Boss-Tank");
    });

    it("adds marks and zones, a zone in its type's preset colour", () => {
        let b = lib.addMark(lib.emptyBoard(), "skull");
        expect(b.marks).toHaveLength(1);
        expect(b.marks[0]).toMatchObject({ mark: "skull" });
        b = lib.addZone(b, "danger", "ellipse");
        b = lib.addZone(b, "healthy", "rect");
        expect(b.zones.map((z) => [z.type, z.shape, z.color, z.opacity])).toEqual([["danger", "ellipse", "#ef4444", 0.3], ["healthy", "rect", "#22c55e", 0.3]]);
        expect(lib.RAID_MARKS).toHaveLength(8);
        expect(lib.ZONE_TYPES).toEqual(["danger", "healthy", "neutral", "custom"]);
    });

    it("moves a slot or a mark by its centre and a zone by its corner, staying on the board", () => {
        let b = lib.addSlot(lib.addMark(lib.addZone(lib.emptyBoard(), "neutral", "rect"), "star"), "dps", "");
        const [slot, mark, zone] = [b.slots[0].id, b.marks[0].id, b.zones[0].id];
        b = lib.moveObject(b, "slot", slot, 2, -1);
        b = lib.moveObject(b, "mark", mark, 0.25, 0.75);
        b = lib.moveObject(b, "zone", zone, 5, 5);
        expect(b.slots[0]).toMatchObject({ x: 1, y: 0 });
        expect(b.marks[0]).toMatchObject({ x: 0.25, y: 0.75 });
        expect(b.zones[0].x).toBeCloseTo(0.8);
        expect(b.zones[0].y).toBeCloseTo(0.8);
        expect(b.zones[0]).toMatchObject({ w: 0.2, h: 0.2 });
        expect(lib.objectPoint(b, "mark", mark)).toEqual({ x: 0.25, y: 0.75 });
        expect(lib.objectPoint(b, "slot", "nope")).toBeNull();
    });

    it("deletes any object; a deleted slot's player is simply not placed any more", () => {
        let b = lib.addSlot(lib.addMark(lib.addZone(lib.emptyBoard(), "custom", "rect"), "moon"), "tank", "");
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        expect(lib.placedIds(b).has("u1")).toBe(true);
        for (const [kind, id] of [["slot", b.slots[0].id], ["mark", b.marks[0].id], ["zone", b.zones[0].id]]) b = lib.removeObject(b, kind, id);
        expect(b).toMatchObject({ slots: [], marks: [], zones: [] });
        expect(lib.placedIds(b).size).toBe(0);
    });
});

describe("zones: moving and scaling", () => {
    const start = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 };

    it("scales from a corner while the opposite corner stays", () => {
        expect(lib.resizeRect(start, "se", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.4), h: expect.closeTo(0.3) });
        const nw = lib.resizeRect(start, "nw", -0.1, -0.1);
        expect(nw.x).toBeCloseTo(0.1);
        expect(nw.y).toBeCloseTo(0.1);
        expect(nw.x + nw.w).toBeCloseTo(0.5);
        expect(nw.y + nw.h).toBeCloseTo(0.4);
        const ne = lib.resizeRect(start, "ne", 0.1, -0.1);
        expect([ne.x, ne.y + ne.h]).toEqual([0.2, expect.closeTo(0.4)]);
        const sw = lib.resizeRect(start, "sw", -0.1, 0.1);
        expect([sw.x + sw.w, sw.y]).toEqual([expect.closeTo(0.5), 0.2]);
    });

    it("never drops below the minimum size, flips over or leaves the board", () => {
        const tiny = lib.resizeRect(start, "se", -5, -5);
        expect(tiny.w).toBeCloseTo(lib.MIN_ZONE);
        expect(tiny.h).toBeCloseTo(lib.MIN_ZONE);
        expect(tiny.x).toBe(0.2);
        const nw = lib.resizeRect(start, "nw", 5, 5);
        expect(nw.x + nw.w).toBeCloseTo(0.5);
        expect(nw.w).toBeCloseTo(lib.MIN_ZONE);
        const big = lib.resizeRect(start, "se", 5, 5);
        expect(big.x + big.w).toBe(1);
        expect(big.y + big.h).toBe(1);
        const left = lib.resizeRect(start, "nw", -5, -5);
        expect(left.x).toBe(0);
        expect(left.y).toBe(0);
    });

    it("moves as a whole and stays on the board", () => {
        expect(lib.moveRect(start, 0.1, 0.05)).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.25), w: 0.3, h: 0.2 });
        expect(lib.moveRect(start, 9, 9)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.8), w: 0.3, h: 0.2 });
        expect(lib.moveRect(start, -9, -9)).toEqual({ x: 0, y: 0, w: 0.3, h: 0.2 });
    });

    it("changes a zone's fields without touching the others", () => {
        let b = lib.addZone(lib.addZone(lib.emptyBoard(), "danger", "rect"), "healthy", "rect");
        b = lib.updateZone(b, b.zones[0].id, { label: "Feuer", color: "#112233", opacity: 0.5 });
        expect(b.zones[0]).toMatchObject({ label: "Feuer", color: "#112233", opacity: 0.5, type: "danger" });
        expect(b.zones[1]).toMatchObject({ label: "", color: "#22c55e" });
    });
});

describe("slots and players", () => {
    const mk = () => lib.addSlot(lib.addSlot(lib.emptyBoard(), "tank", ""), "healer", "");

    it("puts a player into a slot, taking them off their token and any other slot", () => {
        let b = mk();
        b = lib.placeToken(b, "u1", 0.5, 0.5);
        b = lib.assignSlot(b, b.slots[0].id, "u1");
        expect(b.tokens).toEqual([]);
        expect(b.slots.map((s) => s.userId)).toEqual(["u1", ""]);
        b = lib.assignSlot(b, b.slots[1].id, "u1");
        expect(b.slots.map((s) => s.userId)).toEqual(["", "u1"]);
        b = lib.assignSlot(b, b.slots[1].id, "");
        expect(b.slots.map((s) => s.userId)).toEqual(["", ""]);
    });

    it("takes a player out of a slot when they become a free token, and never lists a slotted player as unplaced", () => {
        let c = mk();
        c = lib.assignSlot(c, c.slots[0].id, "u1");
        expect(lib.unplaced([player("u1"), player("u2")], c).map((p) => p.userId)).toEqual(["u2"]);
        c = lib.placeToken(c, "u1", 0.1, 0.1);
        expect(c.slots[0].userId).toBe("");
        expect(c.tokens.map((k) => k.userId)).toEqual(["u1"]);
        expect(lib.unplaced([player("u1"), player("u2")], c).map((p) => p.userId)).toEqual(["u2"]);
    });

    it("names the players of a setup group for a group marker and counts the open slots", () => {
        const roster = [{ ...player("a"), group: 1 }, { ...player("b"), group: 2 }, { ...player("c"), group: 2 }];
        expect(lib.groupMembers({ kind: "group", n: 2 }, roster).map((p) => p.userId)).toEqual(["b", "c"]);
        let b = lib.addSlot(lib.addSlot(lib.addSlot(lib.emptyBoard(), "tank", ""), "group", ""), "label", "MT");
        expect(lib.openSlots(b)).toBe(1);
        b = lib.assignSlot(b, b.slots[0].id, "a");
        expect(lib.openSlots(b)).toBe(0);
    });

    it("counts objects for the boss list and treats them as content for the questions", () => {
        const bosses = { a: { slots: [{ id: "1" }], marks: [{ id: "2" }], zones: [{ id: "3" }] } };
        expect(lib.boardCount(bosses, "a")).toBe(3);
        expect(lib.hasContent(lib.boardOf(bosses, "a"))).toBe(true);
        expect(lib.planHasContent(bosses, ["a", "b"])).toBe(true);
        expect(lib.planHasContent(bosses, ["b"])).toBe(false);
        expect(lib.planHasContent({}, ["a"])).toBe(false);
    });
});

describe("the new pages", () => {
    const work = read("pages/raid-detail/raidplan/BoardWorkspace.tsx");
    const tpl = read("pages/RaidplanTemplatesPage.tsx");
    const tab = read("pages/raid-detail/RaidplanTab.tsx");
    const app = read("App.tsx");
    const css = read("styles/raidplan.css");
    const board = read("components/raidplan/PlanBoard.tsx");
    const pub = read("pages/PlanPublicPage.tsx");

    it("shares one workspace between the event plan and the template, with no second copy of the drag", () => {
        expect(tab).toContain("<BoardWorkspace");
        expect(tpl).toContain("<BoardWorkspace");
        expect(tab).toContain('mode="event"');
        expect(tpl).toContain('mode="template"');
        for (const src of [tab, tpl]) expect(stripComments(src)).not.toContain("addEventListener");
    });

    it("gives the board the width of the column and takes the menu's width cap away for these pages", () => {
        expect(css).toContain(".content:has(.rp-wide) { max-width: none; }");
        expect(css).toMatch(/\.rp-layout \{[^}]*grid-template-columns: 190px minmax\(0, 1fr\)/);
        expect(css).toMatch(/\.rp-board \{[^}]*width: 100%/);
        expect(css).toMatch(/\.rp-public-body \{ display: flex; flex-direction: column/);
        expect(tab).toContain("rp-editor rp-wide");
        expect(tpl).toContain("rp-editor rp-wide");
        expect(pub).toContain("rp-public rp-wide");
    });

    it("reaches the template page from the raid list and the router, inside the raids area", () => {
        expect(app).toMatch(/path="raids\/plan-templates" element=\{<Guard user=\{user\} areas=\{\["raids"\]\}><RaidplanTemplatesPage \/><\/Guard>\}/);
        expect(read("pages/RaidsPage.tsx")).toContain("to=\"/raids/plan-templates\"");
        expect(read("components/Shell.tsx")).toContain("/raids/plan-templates");
    });

    it("renders zones, marks, slots and groups in the shared board, in both editors and the read view", () => {
        for (const needle of ["zones.map", "marks.map", "slots.map", "groupMembers", "rp-zone-label", "ZONE_GLYPHS"]) expect(board).toContain(needle);
        expect(pub).toContain("slots={boss.slots}");
        expect(pub).toContain("marks={boss.marks}");
        expect(pub).toContain("zones={boss.zones}");
        expect(pub).toContain("boss.slots.some((sl) => sl.userId === data.me)");
    });

    it("marks a zone's type by pattern and label as well as colour", () => {
        expect(css).toMatch(/\.rp-zone-danger \{[^}]*repeating-linear-gradient/);
        expect(css).toMatch(/\.rp-zone-healthy \{[^}]*radial-gradient/);
        expect(css).toMatch(/\.rp-zone-neutral \{[^}]*dashed/);
        expect(board).toContain("aria-label={`${t(`raidBoard.zone.${z.type}`)}: ${name}`}");
    });

    it("offers all eight raid marks and draws them itself (Blizzard's textures are not on the icon CDN)", () => {
        const icon = read("components/raidplan/MarkIcon.tsx");
        for (const m of ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"]) expect(icon).toContain(m);
        expect(icon).toContain("not on the icon CDN");
    });

    it("lets a map be reset to its default from the map dialog", () => {
        const modal = read("pages/raid-detail/raidplan/MapModal.tsx");
        expect(modal).toContain("raidBoard.board.mapReset");
        expect(tab).toContain("e/${eventId}/${boss.key}");
        expect(tpl).toContain("t/${tpl.id}/${boss.key}");
    });

    it("applies a template on the server's answer and asks first only when the plan holds something", () => {
        expect(tab).toContain("applyRaidplanTemplate(csrfToken, { event: eventId, templateId: tpl.id, version: view.plan.version })");
        expect(tab).toContain("planHasContent(view.plan.bosses, bossKeys)");
    });
});
