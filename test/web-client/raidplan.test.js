// Raidplan (docs/raidplan.md): the board logic behind the editor
// (src/web-client/src/lib/raidplan.ts) run for real, and the pages' structure
// checked on the source — the client is TSX without a React renderer here.
const fs = require("fs");
const path = require("path");
const { loadTs, read, makeT, stripComments, allDicts } = require("./i18nHelper");

const lib = loadTs("lib/raidplan.ts");

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
        expect(lib.boardOf({}, "bt/supremus")).toEqual({ tokens: [], targets: [], notes: "", profileId: "" });
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
        expect(lib.nudgeToken(b, "a", 0.01, -0.01).tokens[0]).toEqual({ userId: "a", x: 0.51, y: 0.49 });
        expect(lib.nudgeToken(lib.placeToken(b, "a", 0.999, 0), "a", 0.05, -0.05).tokens[0]).toEqual({ userId: "a", x: 1, y: 0 });
        expect(lib.nudgeToken(b, "nobody", 0.1, 0.1)).toBe(b);
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
        const src = stripComments(tab + board2);
        expect(src).toContain("window.addEventListener(\"pointermove\"");
        expect(src).toContain("window.addEventListener(\"pointerup\"");
        expect(src).toContain("window.addEventListener(\"pointercancel\"");
        for (const banned of ["onDragStart", "onDrop", "onDragOver", "draggable={true}", "dataTransfer"]) expect(src).not.toContain(banned);
        // fingers: the draggable things do not scroll the page
        expect(css).toMatch(/\.rp-token\.is-editable \.rp-token-btn \{[^}]*touch-action: none/);
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
        const files = ["pages/raid-detail/RaidplanTab.tsx", "pages/raid-detail/raidplan/TargetsPanel.tsx", "pages/raid-detail/raidplan/ProfileModals.tsx", "pages/raid-detail/raidplan/ShareModal.tsx", "pages/raid-detail/raidplan/MapModal.tsx", "pages/PlanPublicPage.tsx", "components/raidplan/PlanBoard.tsx"];
        const keys = new Set();
        for (const f of files) for (const m of read(f).matchAll(/\bt\(\s*"(raidBoard\.[\w.]+)"/g)) keys.add(m[1]);
        expect(keys.size).toBeGreaterThan(40);
        const missing = [...keys].filter((k) => de[k] === undefined || en[k] === undefined);
        expect(missing).toEqual([]);
        // the role labels are looked up by a computed key
        for (const role of ["tank", "healer", "dps"]) expect(de[`raidBoard.role.${role}`]).toBeTruthy();
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
