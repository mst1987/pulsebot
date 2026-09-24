// The assignments' client logic (lib/assign.ts): resolving references, the multi-select edits,
// which types a board offers, suggestions merged in, the map lines, "is this row mine".
const fs = require("fs");
const path = require("path");
const { loadTs, makeT } = require("./i18nHelper");

const lib = loadTs("lib/assign.ts", { t: makeT("de") });
const libEn = loadTs("lib/assign.ts", { t: makeT("en") });

const player = (userId, character, classId = "Priest", group = 1) => ({ userId, character, classId, className: "", classColor: "", spec: "", specLabel: "", role: "healer", iconUrl: "", group });
const slot = (kind, n, userId = "", x = 0.1, y = 0.1, extra = {}) => ({ id: `${kind}${n}`, kind, n, userId, x, y, label: "", ...extra });
const board = (extra = {}) => ({ tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", profileId: "", mapOpacity: 1, objectScale: 1, ...extra });
const ctxOf = (slots, list) => ({ slots, players: new Map(list.map((p) => [p.userId, p])) });

describe("resolving references", () => {
    const ctx = ctxOf([slot("healer", 2, "u1"), slot("tank", 1)], [player("u1", "Heilbert"), player("u2", "Bolzen", "Hunter", 3)]);
    it("a slot placeholder resolves to whoever stands in it, or stays a named open place", () => {
        const filled = lib.resolveAssignee("slot:healer:2", ctx);
        expect(filled).toMatchObject({ kind: "slot", label: "Heiler 2", open: false });
        expect(filled.player.character).toBe("Heilbert");
        expect(lib.resolveAssignee("slot:tank:1", ctx)).toMatchObject({ open: true, player: null, label: "Tank 1" });
        expect(lib.resolveAssignee("slot:tank:9", ctx).open).toBe(true);
    });
    it("a raider, a group, a mark and text", () => {
        expect(lib.resolveAssignee("user:u2", ctx).player.character).toBe("Bolzen");
        expect(lib.resolveAssignee("user:zzz", ctx)).toMatchObject({ label: "?", open: true });
        expect(lib.resolveTarget({ kind: "group", ref: "3" }, ctx)).toMatchObject({ kind: "group", group: 3, label: "Gruppe 3" });
        expect(lib.resolveTarget({ kind: "mark", ref: "skull" }, ctx)).toMatchObject({ kind: "mark", mark: "skull" });
        expect(lib.resolveTarget({ kind: "text", ref: "Fear" }, ctx).label).toBe("Fear");
        expect(lib.resolveTarget({ kind: "slot", ref: "healer:2" }, ctx).player.character).toBe("Heilbert");
        expect(libEn.resolveTarget({ kind: "group", ref: "2" }, ctx).label).toBe("Group 2");
    });
});

describe("is this row mine", () => {
    const ctx = ctxOf([slot("healer", 1, "me"), slot("tank", 1, "t1")], [player("me", "Ich", "Priest", 4), player("t1", "Tank", "Warrior", 1)]);
    const a = (assignees, targets) => ({ id: "a", type: "heal", assignees, targets, note: "", suggested: false });
    it("as assignee through a slot or directly, as a target, or through my group", () => {
        expect(lib.isMine(a(["slot:healer:1"], []), ctx, ["me"])).toBe(true);
        expect(lib.isMine(a(["user:me"], []), ctx, ["me"])).toBe(true);
        expect(lib.isMine(a([], [{ kind: "player", ref: "me" }]), ctx, ["me"])).toBe(true);
        expect(lib.isMine(a([], [{ kind: "group", ref: "4" }]), ctx, ["me"])).toBe(true);
        expect(lib.isMine(a(["slot:tank:1"], [{ kind: "group", ref: "2" }]), ctx, ["me"])).toBe(false);
        expect(lib.isMine(a(["slot:healer:1"], []), ctx, [])).toBe(false);
        // several players of the same visitor (a main and an alt)
        expect(lib.isMine(a(["slot:tank:1"], []), ctx, ["nobody", "t1"])).toBe(true);
    });
});

describe("types per area", () => {
    it("boss, trash and the whole raid offer their own types, everything can be 'other'", () => {
        expect(lib.assignTypes("boss")).toEqual(expect.arrayContaining(["heal", "kick", "md", "ss", "fearward", "special", "other"]));
        expect(lib.assignTypes("trash")[0]).toBe("trashtank");
        expect(lib.assignTypes("general")).toEqual(["curse", "thunderclap", "demoshout", "buff", "other"]);
        expect(lib.assignTypes("nonsense")).toEqual(lib.assignTypes("boss"));
        for (const scope of ["boss", "trash", "general"]) expect(lib.assignTypes(scope)).toContain("other");
        expect(lib.scopeOf({ general: true })).toBe("general");
        expect(lib.scopeOf({ trash: true })).toBe("trash");
        expect(lib.scopeOf({})).toBe("boss");
    });
    it("every type has an icon; the class filter fits the type and never rules anybody out for heal", () => {
        for (const type of Object.keys(lib.ASSIGN_META)) expect(lib.ASSIGN_META[type].icon).toMatch(/^[a-z0-9_]+$/);
        expect(lib.fitsType("md", player("h", "H", "Hunter"))).toBe(true);
        expect(lib.fitsType("md", player("m", "M", "Mage"))).toBe(false);
        expect(lib.fitsType("kick", player("r", "R", "Rogue"))).toBe(true);
        expect(lib.fitsType("ss", player("w", "W", "Warlock"))).toBe(true);
        expect(lib.fitsType("fearward", player("p", "P", "Priest"))).toBe(true);
        expect(lib.fitsType("heal", player("m", "M", "Mage"))).toBe(true);
    });
    it("slot choices are unique and in role order", () => {
        const c = lib.slotChoices([slot("healer", 2), slot("tank", 1), slot("healer", 1), slot("healer", 1), slot("group", 1), slot("label", 1)]);
        expect(c.map((x) => x.ref)).toEqual(["tank:1", "healer:1", "healer:2"]);
    });
});

describe("cards", () => {
    const row = (type) => ({ id: type, type, title: "", assignees: [], targets: [], note: "", suggested: false });
    it("every area has its default cards even when empty, in a fixed order", () => {
        expect(lib.cardTypes("boss", [], [], false)).toEqual(["tank", "heal"]);
        expect(lib.cardTypes("trash", [], [], false)).toEqual(["trashtank", "heal"]);
        expect(lib.cardTypes("general", [], [], false)).toEqual(["curse", "thunderclap", "demoshout"]);
    });
    it("a type with a row and a card added by hand appear, in the fixed order whatever the order of the rows", () => {
        expect(lib.cardTypes("boss", [row("cc"), row("kick"), row("heal")], ["md"], false)).toEqual(["tank", "heal", "kick", "md", "cc"]);
        expect(lib.cardTypes("boss", [row("other")], [], false)).toEqual(["tank", "heal", "other"]);
    });
    it("the read view shows only cards with content, in the same order", () => {
        expect(lib.cardTypes("boss", [], [], true)).toEqual([]);
        expect(lib.cardTypes("boss", [row("kick"), row("tank")], ["md"], true)).toEqual(["tank", "kick"]);
    });
    it("offers to add the area's other types, and a row of a card has the card's type", () => {
        expect(lib.addableCards("boss", ["tank", "heal"])).toEqual(["kick", "md", "ss", "fearward", "special", "dispel", "cc", "buff", "other"]);
        expect(lib.addableCards("general", ["curse"])).toEqual(["buff", "thunderclap", "demoshout", "other"]);
        const r = lib.addRowOfType(board(), "tank");
        expect(r.board.assignments[0].type).toBe("tank");
        expect(lib.rowsOfType([row("tank"), row("heal"), row("tank")], "tank")).toHaveLength(2);
    });
});

describe("editing rows", () => {
    it("adds, edits, removes; several healers on one target and one healer on several targets", () => {
        let r = lib.addAssignment(board(), "heal");
        const id = r.id;
        let b = r.board;
        expect(b.assignments[0]).toMatchObject({ type: "heal", assignees: [], targets: [], suggested: false });
        b = lib.toggleAssignee(b, id, "slot:healer:1");
        b = lib.toggleAssignee(b, id, "slot:healer:2");
        b = lib.toggleTarget(b, id, { kind: "slot", ref: "tank:1" });
        b = lib.toggleTarget(b, id, { kind: "group", ref: "3" });
        b = lib.toggleTarget(b, id, { kind: "mark", ref: "skull" });
        expect(b.assignments[0].assignees).toEqual(["slot:healer:1", "slot:healer:2"]);
        expect(b.assignments[0].targets).toHaveLength(3);
        b = lib.toggleAssignee(b, id, "slot:healer:1");
        b = lib.toggleTarget(b, id, { kind: "group", ref: "3" });
        expect(b.assignments[0].assignees).toEqual(["slot:healer:2"]);
        expect(b.assignments[0].targets.map((t) => t.kind)).toEqual(["slot", "mark"]);
        r = lib.addAssignment(b, "kick");
        expect(r.board.assignments).toHaveLength(2);
        expect(lib.removeAssignment(r.board, id).assignments.map((a) => a.type)).toEqual(["kick"]);
        expect(lib.toggleAssignee(board(), "nope", "slot:tank:1").assignments).toEqual([]);
    });
    it("the kick rotation can be reordered", () => {
        let b = board({ assignments: [{ id: "k", type: "kick", assignees: ["user:a", "user:b", "user:c"], targets: [], note: "", suggested: false }] });
        b = lib.moveAssignee(b, "k", "user:c", -1);
        expect(b.assignments[0].assignees).toEqual(["user:a", "user:c", "user:b"]);
        expect(lib.moveAssignee(b, "k", "user:a", -1)).toBe(b);
        expect(lib.moveAssignee(b, "k", "user:b", 1)).toBe(b);
    });
    it("an edit by hand clears the suggestion flag", () => {
        const b = board({ assignments: [{ id: "s", type: "heal", assignees: [], targets: [], note: "", suggested: true }] });
        expect(lib.patchAssignment(b, "s", { note: "x" }).assignments[0].suggested).toBe(false);
        expect(lib.toggleTarget(b, "s", { kind: "group", ref: "1" }).assignments[0].suggested).toBe(false);
    });
    it("suggestions replace the earlier suggestions of their type and keep rows made by hand", () => {
        const hand = { id: "h", type: "heal", assignees: ["slot:healer:9"], targets: [], note: "", suggested: false };
        const old = { id: "o", type: "heal", assignees: [], targets: [], note: "", suggested: true };
        const other = { id: "k", type: "kick", assignees: [], targets: [], note: "", suggested: true };
        const fresh = { id: "n", type: "heal", assignees: ["slot:healer:1"], targets: [], note: "", suggested: false };
        const b = lib.applySuggestions(board({ assignments: [hand, old, other] }), "heal", [fresh]);
        expect(b.assignments.map((a) => a.id)).toEqual(["h", "k", "n"]);
        expect(b.assignments[2].suggested).toBe(true);
    });
});

describe("lines on the map", () => {
    it("connect a healer to what it heals when both ends are on the board", () => {
        const b = board({
            slots: [slot("healer", 1, "", 0.2, 0.2), slot("tank", 1, "", 0.5, 0.5), slot("group", 3, "", 0.8, 0.8)],
            marks: [{ id: "m", mark: "skull", x: 0.9, y: 0.1 }],
            assignments: [
                { id: "a", type: "heal", assignees: ["slot:healer:1"], targets: [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "3" }, { kind: "mark", ref: "skull" }, { kind: "text", ref: "x" }, { kind: "slot", ref: "tank:7" }], note: "", suggested: false },
                { id: "k", type: "kick", assignees: ["slot:healer:1"], targets: [{ kind: "slot", ref: "tank:1" }], note: "", suggested: false },
            ],
        });
        const l = lib.assignmentLinks(b);
        expect(l.map((k) => [k.x1, k.y1, k.x2, k.y2])).toEqual([[0.2, 0.2, 0.5, 0.5], [0.2, 0.2, 0.8, 0.8], [0.2, 0.2, 0.9, 0.1]]);
        expect(l[0].color).toBe(lib.HEAL_COLOR);
    });
    it("a hidden slot has no line and an assignee without a slot on the board has none either", () => {
        const b = board({ slots: [slot("tank", 1, "", 0.5, 0.5)], assignments: [{ id: "a", type: "heal", assignees: ["slot:healer:1", "user:x"], targets: [{ kind: "slot", ref: "tank:1" }], note: "", suggested: false }] });
        expect(lib.assignmentLinks(b)).toEqual([]);
    });
});

describe("wiring and texts", () => {
    const root = path.join(__dirname, "../../src/web-client/src");
    const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
    it("the workspace shows the panel right at the board, the read view the table", () => {
        expect(read("pages/raid-detail/raidplan/BoardWorkspace.tsx")).toContain("<AssignPanel");
        expect(read("pages/PlanPublicPage.tsx")).toContain("<AssignTable");
        expect(read("components/raidplan/PlanBoard.tsx")).toContain("rp-links");
    });
    it("has every type and picker text in both languages", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(root, "i18n/locales", lang, "raidBoard.json"), "utf8")).assign;
            for (const type of Object.keys(lib.ASSIGN_META)) expect(typeof d.type[type]).toBe("string");
            for (const type of lib.SUGGESTABLE) expect(typeof d.suggestType[type]).toBe("string");
            for (const k of ["title", "general", "trash", "add", "suggest", "suggested", "note", "pickSlots", "pickGroups", "pickMarks", "noSuggestion", "empty"]) expect(typeof d[k]).toBe("string");
        }
    });
});

describe("icons of tasks", () => {
    const row = (type, title = "", targets = []) => ({ id: "a", type, title, assignees: [], targets, note: "", suggested: false });
    it("finds the spell icon a task or a text target names, else the icon of the type", () => {
        expect(lib.iconForText("Curse of the Elements")).toBe("spell_shadow_chilltouch");
        expect(lib.iconForText("curse of RECKLESSNESS")).toBe("spell_shadow_unholystrength");
        expect(lib.iconForText("Curse of Doom")).toBe("spell_shadow_auraofdarkness");
        expect(lib.iconForText("Thunder Clap")).toBe("spell_nature_thunderclap");
        expect(lib.iconForText("Demoralizing Shout")).toBe("ability_warrior_warcry");
        expect(lib.iconForText("Counterspell")).toBe("spell_frost_iceshock");
        expect(lib.iconForText("nothing known")).toBe("");
        expect(lib.iconForTask(row("curse", "", [{ kind: "text", ref: "Curse of Doom" }]))).toBe("spell_shadow_auraofdarkness");
        expect(lib.iconForTask(row("kick", "Kick Fear"))).toBe("ability_kick");
        expect(lib.iconForTask(row("other", "Something"))).toBe(lib.ASSIGN_META.other.icon);
        expect(lib.iconForTask(row("heal"))).toBe(lib.ASSIGN_META.heal.icon);
    });
    it("every known icon name is a plain icon file name; the curse and interrupt lists have icons", () => {
        for (const [word, icon] of lib.TEXT_ICONS) { expect(word).toBe(word.toLowerCase()); expect(icon).toMatch(/^[a-z0-9_]+$/); }
        for (const text of [...lib.quickTexts("curse"), ...lib.quickTexts("kick")]) expect(lib.iconForText(text)).not.toBe("");
        expect(lib.quickTexts("heal")).toEqual([]);
    });
});

describe("tasks derived from the assignments", () => {
    const players = [player("h1", "Heilbert", "Priest", 1), player("t1", "Tank", "Warrior", 1), player("r1", "Schleich", "Rogue", 2)];
    const ctx = ctxOf([slot("healer", 1, "h1"), slot("tank", 1, "t1"), slot("healer", 2)], players);
    const list = [
        { id: "a", type: "heal", title: "", assignees: ["slot:healer:1", "slot:healer:2"], targets: [{ kind: "slot", ref: "tank:1" }, { kind: "group", ref: "3" }], note: "", suggested: false },
        { id: "b", type: "kick", title: "Fear", assignees: ["user:r1", "user:h1"], targets: [], note: "", suggested: false },
        { id: "c", type: "ss", title: "", assignees: ["user:r1"], targets: [{ kind: "player", ref: "h1" }], note: "", suggested: false },
    ];
    it("one entry per assignee, a filled slot counts as its player, sentences read like a person would say them", () => {
        const all = lib.tasksByAssignee(list, ctx);
        expect(all.map((x) => x.who.label)).toEqual(["Heiler 1", "Heiler 2", "Schleich"]);
        const heilbert = all.find((x) => x.who.player && x.who.player.userId === "h1");
        expect(heilbert.tasks.map((k) => k.text)).toEqual(["Heilt Tank 1 + Gruppe 3", "Fear #2"]);
        const open = all.find((x) => x.who.open && x.who.ref === "slot:healer:2");
        expect(open.tasks[0].text).toBe("Heilt Tank 1 + Gruppe 3");
        const rogue = all.find((x) => x.who.player && x.who.player.userId === "r1");
        expect(rogue.tasks.map((k) => k.text)).toEqual(["Fear #1", "Soulstone auf Heilbert"]);
        expect(rogue.tasks[0].icon).toBe("ability_kick");
    });
    it("your tasks are the tasks of your players, an alt included; nothing when you are not in it", () => {
        expect(lib.myTasks(list, ctx, ["r1"]).map((k) => k.text)).toEqual(["Fear #1", "Soulstone auf Heilbert"]);
        expect(lib.myTasks(list, ctx, ["r1", "h1"])).toHaveLength(4);
        expect(lib.myTasks(list, ctx, ["nobody"])).toEqual([]);
        expect(lib.myTasks(list, ctx, [])).toEqual([]);
    });
    it("a row with a title uses it, without a target there is no arrow", () => {
        const one = [{ id: "z", type: "curse", title: "Elements", assignees: ["user:r1"], targets: [], note: "", suggested: false }];
        expect(lib.tasksByAssignee(one, ctx)[0].tasks[0].text).toBe("Elements");
    });
});
