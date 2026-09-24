// Setup-Editor (#263): the moves behind the editor (src/web-client/src/lib/
// setupEditor.ts), run for real, and the page's structure, checked on the
// source — the client is TSX without a React renderer here.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const { loadTs, makeT } = require("./i18nHelper");

// the lib run for real, with the German texts (its messages are asserted in German below)
const lib = loadTs("lib/setupEditor.ts", { t: makeT("de") });
const libEn = loadTs("lib/setupEditor.ts", { t: makeT("en") });

const person = (userId, spec, role, extra = {}) => ({ userId, character: userId, spec, role, name: "", classId: "", classColor: "", classLabel: "", specLabel: "", specIcon: "", ...extra });

function setup() {
    return {
        version: 3,
        groups: [
            { index: 1, slots: [person("t", "Warrior-Protection", "tank", { locked: true }), person("h", "Priest-Holy", "healer"), person("m1", "Mage-Fire", "ranged"), person("m2", "Mage-Frost", "ranged"), person("r", "Rogue-Combat", "melee")] },
            { index: 2, slots: [person("w", "Warlock-Destruction", "ranged")] },
        ],
        bench: [person("b", "Hunter-BeastMastery", "ranged")],
    };
}

describe("setup editor moves (client)", () => {
    const s = setup();
    const input = lib.toInput(s);
    const people = lib.peopleOf(s);

    it("turns the stored setup into the save request", () => {
        expect(input.version).toBe(3);
        expect(input.groups[0].slots[0]).toEqual({ userId: "t", character: "t", spec: "Warrior-Protection", role: "tank", locked: true, pos: 1 });
        expect(input.bench).toEqual([{ userId: "b", locked: false }]);
    });

    it("moves a raider into a group with room, and onto the bench", () => {
        const toGroup = lib.moveRaider(input, "m1", { group: 2 }, people, 25);
        expect(toGroup.input.groups.map((g) => g.slots.map((x) => x.userId))).toEqual([["t", "h", "m2", "r"], ["w", "m1"]]);
        const toBench = lib.moveRaider(input, "h", { bench: true }, people, 25);
        expect(toBench.input.bench.map((b) => b.userId)).toEqual(["b", "h"]);
        // the original request is untouched
        expect(input.groups[0].slots).toHaveLength(5);
    });

    it("brings a bench raider in with their spec, into a new group", () => {
        const out = lib.moveRaider(input, "b", { group: 3 }, people, 25);
        expect(out.input.groups.find((g) => g.index === 3).slots).toEqual([{ userId: "b", character: "b", spec: "Hunter-BeastMastery", role: "ranged", locked: false, pos: 1 }]);
        expect(out.input.bench).toEqual([]);
    });

    it("refuses a full group and a full raid, but swaps onto a raider", () => {
        expect(lib.moveRaider(input, "w", { group: 1 }, people, 25).error).toMatch(/Gruppe 1 ist voll/);
        expect(lib.moveRaider(input, "b", { group: 2 }, people, 6).error).toMatch(/Raid ist voll/);
        // a swap keeps both positions: the bench raider takes the healer's place 2
        const swap = lib.moveRaider(input, "b", { userId: "h" }, people, 6);
        expect(swap.input.groups[0].slots.map((x) => x.userId)).toEqual(["t", "b", "m1", "m2", "r"]);
        expect(swap.input.groups[0].slots[1]).toEqual({ userId: "b", character: "b", spec: "Hunter-BeastMastery", role: "ranged", locked: false, pos: 2 });
        expect(swap.input.bench).toEqual([{ userId: "h", locked: false }]);
        const across = lib.moveRaider(input, "w", { userId: "t" }, people, 25);
        expect(across.input.groups[0].slots.map((x) => x.userId)).toEqual(["w", "h", "m1", "m2", "r"]);
        expect(across.input.groups[1].slots).toEqual([{ userId: "t", character: "t", spec: "Warrior-Protection", role: "tank", locked: true, pos: 1 }]);
    });

    describe("places inside a group (a group of two can stand on places 1 and 5)", () => {
        const places = (slots) => slots.map((x) => `${x.userId}@${x.pos}`);

        it("gives every slot a place of its own and keeps them sorted, gaps and all", () => {
            const placed = lib.withPlaces([{ userId: "a", pos: 5 }, { userId: "b" }, { userId: "c", pos: 5 }, { userId: "d", pos: 9 }]);
            // "a" keeps 5; "c" wants the taken 5, "d" an impossible 9, "b" none: the rest take the lowest free ones in order
            expect(places(placed)).toEqual(["b@1", "c@2", "d@3", "a@5"]);
            expect(lib.placeGrid([{ userId: "a", pos: 5 }, { userId: "b", pos: 1 }]).map((p) => p && p.userId)).toEqual(["b", null, null, null, "a"]);
        });

        it("drops a raider onto a free place of a group that is not full — from the bench, from another group, from inside", () => {
            const fromBench = lib.moveRaider(input, "b", { group: 2, pos: 5 }, people, 25).input;
            expect(places(fromBench.groups[1].slots)).toEqual(["w@1", "b@5"]);
            expect(fromBench.bench).toEqual([]);
            const fromGroup = lib.moveRaider(input, "r", { group: 2, pos: 4 }, people, 25).input;
            expect(places(fromGroup.groups[1].slots)).toEqual(["w@1", "r@4"]);
            // inside the own group: the sham stands alone on place 1 and moves to place 5
            const alone = lib.moveRaider(input, "w", { group: 2, pos: 5 }, people, 25).input;
            expect(places(alone.groups[1].slots)).toEqual(["w@5"]);
        });

        it("takes the lowest free place when the wanted one is taken, and does nothing for the place already held", () => {
            const taken = lib.moveRaider(input, "b", { group: 2, pos: 1 }, people, 25).input;
            expect(places(taken.groups[1].slots)).toEqual(["w@1", "b@2"]);
            expect(lib.moveRaider(input, "w", { group: 2, pos: 1 }, people, 25)).toEqual({ input: null });
        });

        it("swaps the places too, and the places survive into the save request and the redraw", () => {
            const gapped = lib.moveRaider(input, "b", { group: 2, pos: 5 }, people, 25).input;
            const swapped = lib.moveRaider(gapped, "w", { userId: "b" }, people, 25).input;
            expect(places(swapped.groups[1].slots)).toEqual(["b@1", "w@5"]);
            expect(places(lib.applyLocal(s, gapped).groups[1].slots)).toEqual(["w@1", "b@5"]);
            expect(lib.toInput(lib.applyLocal(s, gapped)).groups[1].slots.map((x) => x.pos)).toEqual([1, 5]);
        });
    });

    it("reorders a group: swap inside it, or drop on its free places to go last", () => {
        const inside = lib.moveRaider(input, "m1", { userId: "t" }, people, 25);
        expect(inside.input.groups[0].slots.map((x) => x.userId)).toEqual(["m1", "h", "t", "m2", "r"]);
        const twoGroup = lib.moveRaider(input, "m1", { group: 2 }, people, 25).input;
        const last = lib.moveRaider(twoGroup, "w", { group: 2 }, people, 25);
        expect(last.input.groups[1].slots.map((x) => x.userId)).toEqual(["m1", "w"]);
    });

    it("does nothing where nothing would change", () => {
        expect(lib.moveRaider(input, "r", { group: 1 }, people, 25)).toEqual({ input: null });
        expect(lib.moveRaider(input, "m1", { userId: "m1" }, people, 25)).toEqual({ input: null });
        expect(lib.moveRaider(input, "b", { bench: true }, people, 25)).toEqual({ input: null });
    });

    it("toggles a lock and redraws the lineup locally", () => {
        const locked = lib.toggleLock(input, "w");
        expect(locked.groups[1].slots[0].locked).toBe(true);
        const moved = lib.moveRaider(locked, "w", { bench: true }, people, 25).input;
        const drawn = lib.applyLocal(s, moved);
        expect(drawn.bench.find((b) => b.userId === "w")).toMatchObject({ locked: true, spec: "Warlock-Destruction" });
        expect(drawn.groups[1].slots).toEqual([]);
    });

    it("resizes the raid live: drops whole groups beyond the new count, then trims the rest onto the bench", () => {
        const big = () => ({
            version: 1,
            groups: [1, 2, 3, 4, 5].map((idx) => ({
                index: idx,
                slots: [1, 2, 3, 4, 5].map((n) => ({ userId: `g${idx}s${n}`, character: `g${idx}s${n}`, spec: "Warrior-Protection", role: "tank", locked: false })),
            })),
            bench: [{ userId: "b1", locked: false }],
        });

        // 25 -> 10: two whole groups fit exactly, three drop entirely — no partial trim needed
        const toTen = lib.resizeLineup(big(), 10);
        expect(toTen.groups.map((g) => g.index)).toEqual([1, 2]);
        expect(toTen.groups.every((g) => g.slots.length === 5)).toBe(true);
        expect(toTen.bench).toHaveLength(1 + 15);

        // 25 -> 12: groups 4/5 drop whole, then group 3 (the highest kept) is trimmed from its last slot down
        const toTwelve = lib.resizeLineup(big(), 12);
        expect(toTwelve.groups.map((g) => [g.index, g.slots.length])).toEqual([[1, 5], [2, 5], [3, 2]]);
        expect(toTwelve.groups.reduce((n, g) => n + g.slots.length, 0)).toBe(12);
        expect(toTwelve.bench.map((b) => b.userId)).toEqual([
            "b1", "g4s1", "g4s2", "g4s3", "g4s4", "g4s5", "g5s1", "g5s2", "g5s3", "g5s4", "g5s5", "g3s5", "g3s4", "g3s3",
        ]);

        // growing touches nothing that already fits (the slots only gain their places)
        const bare = (groups) => groups.map((g) => ({ ...g, slots: g.slots.map(({ pos, ...rest }) => rest) }));
        const grown = lib.resizeLineup(big(), 30);
        expect(bare(grown.groups)).toEqual(big().groups);
        expect(grown.bench).toEqual(big().bench);

        // locked is not special-cased here (a raw capacity trim, not a proposal re-run): a locked raider can still be bumped
        const withLock = big();
        withLock.groups[4].slots[0].locked = true;
        const shrunk = lib.resizeLineup(withLock, 5);
        expect(bare(shrunk.groups)).toEqual([{ index: 1, slots: withLock.groups[0].slots }]);
        expect(shrunk.bench.find((b) => b.userId === "g5s1")).toEqual({ userId: "g5s1", locked: true });

        // the original input is never mutated
        const original = big();
        lib.resizeLineup(original, 5);
        expect(original.groups).toHaveLength(5);
    });

    it("splits the bench into group-sized cards, with a fresh empty one once the last is full", () => {
        const make = (n) => Array.from({ length: n }, (_, i) => person(`b${i}`, "Priest-Holy", "healer"));
        expect(lib.benchChunks(make(0)).map((c) => c.length)).toEqual([0]);
        expect(lib.benchChunks(make(3)).map((c) => c.length)).toEqual([3]);
        expect(lib.benchChunks(make(5)).map((c) => c.length)).toEqual([5, 0]);
        expect(lib.benchChunks(make(7)).map((c) => c.length)).toEqual([5, 2]);
        expect(lib.benchChunks(make(10)).map((c) => c.length)).toEqual([5, 5, 0]);
    });

    it("lists every group of the raid, empty ones included", () => {
        expect(lib.withAllGroups(s.groups, 5).map((g) => [g.index, g.slots.length])).toEqual([[1, 5], [2, 1], [3, 0], [4, 0], [5, 0]]);
    });

    it("says a role target the way the summary shows it", () => {
        expect(lib.roleTarget({ min: 3, max: 3 })).toBe("3");
        expect(lib.roleTarget({ min: 2, max: null })).toBe("≥ 2");
        expect(lib.roleTarget({ min: 0, max: null })).toBe("");
        expect(lib.roleTarget({ min: 2, max: 4 })).toBe("2–4");
        expect(lib.dpsCheck({ melee: { count: 6, min: 0, ok: true }, ranged: { count: 10, min: 2, ok: false } })).toEqual({ count: 16, min: 2, max: null, ok: false });
    });
});

describe("setup editor page", () => {
    const editor = read("pages", "raid-detail", "SetupEditor.tsx");
    const page = read("pages", "RaidDetailPage.tsx");
    const css = read("styles", "setup-editor.css");

    it("is a tab of the raid detail — only for an own event", () => {
        expect(page).toContain("const TABS: Tab[] = [\"roster\", \"setup\", \"loot\", \"logs\"];");
        expect(page).toContain("const tabs = TABS.filter((t) => t !== \"setup\" || ownEvent);");
        expect(page).toContain("{shown === \"setup\" && <SetupEditor ctx={ctx} />}");
        // the primary action and the step open the tab
        expect(page).toContain("else if (action.tab) switchTab(action.tab);");
    });

    it("draws group cards and the bench as drop targets, with a click-and-target alternative", () => {
        expect(editor).toContain("<GroupCard key={g.index}");
        expect(editor).toContain("<BenchCard bench={setup.bench}");
        expect(editor).toMatch(/draggable=\{ui\.editable\}/);
        expect(editor).toMatch(/onDrop: \(e: DragEvent<HTMLElement>\)/);
        expect(editor).toContain("aria-pressed={ui.editable ? selected : undefined}");
        // the bench is chunked into group-sized cards, every one of them a drop target for "onto the bench"
        expect(editor).toContain("benchChunks(bench).map((slots, i) => <BenchChunk key={i}");
        expect(editor).toMatch(/const zone = useZone\(\{ bench: true \}, ui\);/);
        expect(editor).toMatch(/e\.key === "Escape"/);
        // no drag-and-drop library
        expect(editor).not.toMatch(/from "(react-dnd|@dnd-kit|react-beautiful-dnd)/);
    });

    it("shows every group's five places — empty ones as boxes — and the bench under the setup", () => {
        // each free place is a drop target of its own (place 5 of a group of two), not just "somewhere in the group"
        expect(editor).toContain("placeGrid(group.slots).map(");
        expect(editor).toContain("ui.onDrop({ group, pos }, e.dataTransfer.getData(\"text/plain\"))");
        expect(editor).toContain("className=\"se-ph se-ph-take\"");
        expect(editor).not.toContain(">leer<");
        // groups and bench share one column across the full width — the summary sits in the top row above
        expect(editor).toMatch(/<div className="se-main">\s*<div className="se-groups">[\s\S]*?<BenchCard bench=\{setup\.bench\} ui=\{ui\} \/>\s*<\/div>\s*<\/div>/);
        expect(css).toMatch(/\.se-bench::before \{[^}]*border-top/);
    });

    it("draws the bench as cards the size and look of a group (#354), not one flat list", () => {
        expect(editor).toContain("function BenchChunk(");
        expect(editor).toMatch(/<section className=\{`se-group\$\{zone\.over/);
        expect(editor).toContain("const title = t(\"setup.bench.chunkTitle\", { index });");
        const de = makeT("de");
        expect(de("setup.bench.chunkTitle", { index: 2 })).toBe("Bank 2");
        // never the wording of a real raid group — a bench card is not a raid slot
        expect(de("setup.bench.chunkTitle", { index: 2 })).not.toMatch(/^Gruppe/);
    });

    it("lets the orga change the raid size right in the bar, reshuffled live", () => {
        expect(editor).toContain("<SizeControl size={data.event.size} disabled={busy} onCommit={resize} />");
        expect(editor).toContain("const resized = resizeLineup(toInput(shown.setup), newSize);");
        // reshuffled locally before anything is sent to the server
        expect(editor).toMatch(/setData\(\{ \.\.\.shown, event: \{ \.\.\.shown\.event, size: newSize \}, groupCount, setup: applyLocal\(shown\.setup, resized\) \}\);\s*\n\s*setBusy\(true\);/);
        // the size itself persists through the same PATCH the event-edit dialog uses
        expect(editor).toContain("await updateRaidSize(ctx.csrfToken, ctx.eventId, newSize);");
        const de = makeT("de");
        // entered as a number of groups, the total is calculated (groups × 5)
        expect(de("setup.editor.sizeLabel")).toBe("Gruppen");
        expect(de("setup.editor.sizeTotal", { perGroup: 5, size: 25 })).toBe("× 5 = 25 Spieler");
        expect(editor).toContain("onCommit(parsed * GROUP_SIZE)");
        expect(editor).toContain("Math.ceil(size / GROUP_SIZE)");
    });

    it("has an optional compact view (off by default, remembered per browser) and a top row of three boxes", () => {
        expect(editor).toContain('localStorage.getItem(COMPACT_KEY) === "1"');
        expect(editor).toMatch(/se-editor\$\{compact \? " se-compact" : ""\}/);
        // the bar and the channel line across the full width; under them left the ping message over the summary, right the raider panel
        expect(editor).toMatch(/<div className="se-bar">[\s\S]*?<PublishLine[\s\S]*?className="se-topline">\s*<div className="se-topleft">\s*<PingTextField[\s\S]*?<Summary[\s\S]*?<\/div>\s*\{inspectedPerson \? <SlotTip[\s\S]*?<TipEmpty/);
        const css = read("styles", "setup-editor.css");
        // five groups side by side: the cards are ~190 px wide, the compact ones narrower
        expect(css).toMatch(/\.se-groups \{[^}]*minmax\(188px/);
        expect(css).toMatch(/\.se-compact \.se-groups \{[^}]*minmax\(158px/);
        // the whole top row has ONE fixed height, so the panel never grows or shrinks with its content and the groups never jump;
        // whatever would not fit is cut off inside its own box, never spilled into the next
        expect(css).toMatch(/\.se-topline \{[^}]*grid-template-rows: 352px/);
        // stacked below 1360 px of viewport (the sidebar takes ~250 px, the panel needs ~600 px of its own)
        expect(css).toMatch(/@media \(max-width: 1360px\) \{\s*\.se-topline \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: none;/);
        // compact enough that the worst case (7 raid buffs, 4 reasons) fits — checked in a real browser, not just here
        expect(css).toMatch(/\.se-tip \{[^}]*font-size: 13\.5px/);
        expect(css).toMatch(/\.se-tip-buff \.wi \{ width: 22px/);
        expect(editor).toContain('t("setup.person.tip.bringsGroupShort", { count: b.count })');
        expect(editor).not.toMatch(/title=\{`\$\{b\.label\}/);
        expect(css).toMatch(/\.se-topline > \* \{[^}]*overflow: hidden/);
        // readable: every figure and setting is a bordered tile of its own, and the quiet buttons keep a visible fill and outline
        expect(css).toMatch(/\.se-topline \.se-stats \{ display: contents; \}/);
        expect(css).toMatch(/\.se-topline \.se-side-row \{[^}]*border: 1px solid var\(--line\)/);
        // two lines in a tile (label over value): a wide badge never runs into its label
        expect(css).toMatch(/\.se-topline \.se-side-row \{[^}]*grid-template-columns: minmax\(0, 1fr\); justify-items: start/);
        expect(css).toMatch(/\.se-bar-act \.btn\[class\*="ghost"\] \{[^}]*border: 1px solid color-mix/);
        // the panel: a header across the whole width, three columns under it (brings · why · attendance details)
        expect(css).toMatch(/\.se-tip \{[^}]*grid-template-columns: minmax\(0, 1\.3fr\) minmax\(0, 1\.2fr\) minmax\(0, \.9fr\); grid-template-rows: auto minmax\(0, 1fr\)/);
        expect(css).toMatch(/\.se-tip-top \{ grid-column: 1 \/ -1;/);
        expect(editor).toContain('<header className="se-tip-top">');
        // the attendance is the big number of the header, its details are a column of their own
        expect(editor).toMatch(/<header className="se-tip-top">[\s\S]*?<AttendanceHead a=\{attendance\} \/>[\s\S]*?<\/header>[\s\S]*?<AttendanceDetails a=\{attendance\} \/>/);
        expect(css).toMatch(/\.se-tip-att b \{[^}]*font-size: 28px/);
        expect(css).toMatch(/\.se-tip \{ font-family: inherit; font-size: 13\.5px;/);
        expect(editor).toContain('<span className="se-pingtext-hint">');
        expect(css).toMatch(/\.se-bar-hint \{ display: none; \}/);
        expect(css).not.toMatch(/\.se-tip \{[^}]*overflow-y: auto/);
        expect(css).not.toMatch(/\.se-tip \{[^}]*max-height/);
        // a raider and a free place share one row height, so cards are equally tall whether a place is taken or not
        expect(css).toMatch(/\.se-editor \{[^}]*--se-row: 46px/);
        expect(css).toMatch(/\.se-slot \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-ph \{[^}]*height: var\(--se-row\)/);
        expect(css).toMatch(/\.se-compact \{ --se-row: 32px; \}/);
        expect(makeT("de")("setup.editor.compact")).toBe("Kompakt");
    });

    it("keeps one line per raider — reasons only in the tooltip", () => {
        // the reasons live in the raider panel docked in the right column (SlotTip), not in the line
        expect(editor).toContain("<SlotTip p={inspectedPerson}");
        expect(editor).toContain("tipReasons(p.reasons)");
        // the reasons are never rendered as text of their own
        expect(editor).not.toMatch(/\.reasons\.map\(/);
        expect(editor).toContain("<span className={`se-name ${color.className || \"\"}`} style={color.style}>{p.character}</span>");
        expect(editor).toContain("icon={p.locked ? <LockIcon /> : <UnlockIcon />}");
    });

    it("keeps the side column to roles, buffs, fairness and wishes — weights and the explanation in dialogs", () => {
        const summary = editor.match(/function Summary\([\s\S]*?\n}\n/)[0];
        for (const label of ["label={rolePluralLabel(\"tank\")}", "label={rolePluralLabel(\"healer\")}", "label={t(\"setup.summary.dps\")}", "{t(\"setup.summary.buffs\")}<", "{t(\"setup.summary.fairness\")}<", "{t(\"setup.summary.wishes\")}<"]) {
            expect({ label, found: summary.includes(label) }).toEqual({ label, found: true });
        }
        // wishes are a switch of their own (like fairness), saved through the same request; "Gewichte…" sits with the actions in the bar
        expect(summary).toContain("onChange={() => onWishes(!wishesOn)}");
        expect(editor).toContain("{ wishes: on }");
        expect(editor).toMatch(/onClick=\{\(\) => setDialog\("weights"\)\}>\{t\("setup\.summary\.weights"\)\}<\/Button>/);
        expect(makeT("de")("setup.summary.wishesCapOff")).toBe("Aus – hier einschalten");
        const de = makeT("de");
        expect([de("setup.summary.dps"), de("setup.summary.wishes"), de("setup.summary.weights")]).toEqual(["DD", "Wünsche", "Gewichte…"]);
        expect(summary).not.toContain("type=\"range\"");
        expect(editor).toMatch(/<Modal[\s\S]*?title=\{t\("setup\.weightsModal\.title"\)\}/);
        expect(editor).toMatch(/<Modal[\s\S]*?title=\{t\("setup\.explain\.title"\)\}/);
        expect([de("setup.weightsModal.title"), de("setup.explain.title")]).toEqual(["Gewichte", "KI-Begründung"]);
    });

    it("says what state the setup is in and approves only the version it shows", () => {
        const de = makeT("de");
        const states = { "setup.status.approved": "Freigegeben", "setup.status.changed": "geändert seit Freigabe", "setup.status.draft": "Entwurf", "setup.status.auto": "automatischer Vorschlag" };
        for (const [key, text] of Object.entries(states)) {
            expect(editor).toContain(`{t("${key}")}`);
            expect(de(key)).toBe(text);
        }
        expect(editor).toContain("if (setup.origin !== \"auto\") return draft;");
        // after the moves still on their way, with the version the server confirmed last
        expect(editor).toMatch(/await chain\.current;\s*const next = await approveRaidSetup\(ctx\.csrfToken, ctx\.eventId, confirmedVersion\.current\);/);
        expect(editor).toContain("title: t(\"setup.editor.approveAnywayTitle\")");
        expect(de("setup.editor.approveAnywayTitle")).toBe("Trotzdem freigeben?");
        // a reader never gets the editor, only the approved lineup
        expect(editor).toContain("if (!data.canWrite) return <ReadOnly data={data} />;");
    });

    it("uses its own stylesheet and namespace, no gold", () => {
        expect(editor).toContain("import \"../../styles/setup-editor.css\";");
        const classes = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || [];
        for (const c of classes) expect(c).toMatch(/^\.(se-|wi$|btn$|is-on$)/);
        expect(css).not.toMatch(/gold|#d4af37|#ffd700/i);
    });

    it("shows the setup's own message under the bar and offers one \"Setup posten\" (#290)", () => {
        expect(editor).toContain("<PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} />");
        expect(editor).toMatch(/await chain\.current;\s*const next = await publishRaidSetup\(ctx\.csrfToken, ctx\.eventId\);/);
        // while the DMs run only their state is polled, never the lineup
        expect(editor).toContain("setData((prev) => (prev ? { ...prev, publish: next.publish } : prev))");
    });
});

describe("what posting the setup will do / did (#290)", () => {
    const time = (ms) => `T${ms}`;
    const publish = (over = {}) => ({
        channelId: "c1", channelName: "kara-do", cancelled: false, dmsEnabled: false, recipients: 25, pendingDms: 25,
        posted: null, outdated: false, error: "", errorAt: 0, dms: null, ...over,
    });

    it("says nothing for a reader", () => {
        expect(lib.publishHint(undefined, false, time)).toBeNull();
    });

    it("says before approving where it posts and whether DMs go out", () => {
        expect(lib.publishHint(publish(), false, time)).toMatchObject({ text: "Beim Freigeben: postet Setup in #kanal · DMs an 25 Raider (aus)".replace("#kanal", "#kara-do"), canPost: false });
        const on = lib.publishHint(publish({ dmsEnabled: true, pendingDms: 3, posted: { messageUrl: "u", version: 1, postedAt: 5, editedAt: 0 } }), false, time);
        expect(on.text).toBe("Beim Freigeben: aktualisiert das Setup in #kara-do · DMs an 3 Raider");
        expect(on.sub).toContain("nie gepostet");
    });

    it("says after approving what happened, failures in the tooltip", () => {
        const done = lib.publishHint(publish({
            dmsEnabled: true,
            posted: { messageUrl: "u", version: 2, postedAt: 100, editedAt: 0 },
            dms: { status: "done", version: 2, at: 120, total: 25, sent: 22, failed: [{ userId: "1", character: "Kael", error: "Cannot send" }, { userId: "2", character: "", error: "x" }, { userId: "3", character: "Zibbo", error: "y" }], unchanged: 0 },
        }), true, time);
        expect(done).toMatchObject({ tone: "mid", text: "gepostet T100 in #kara-do · 22 DMs · 3 fehlgeschlagen", canPost: true, running: false });
        expect(done.sub).toContain("Kael – Cannot send");
        expect(done.sub).toContain("2 – x");

        const running = lib.publishHint(publish({ dmsEnabled: true, posted: { messageUrl: "u", version: 2, postedAt: 100, editedAt: 0 }, dms: { status: "running", version: 2, at: 0, total: 25, sent: 4, failed: [], unchanged: 0 } }), true, time);
        expect(running).toMatchObject({ running: true, text: "gepostet T100 in #kara-do · DMs 4/25 …" });

        const off = lib.publishHint(publish({ posted: { messageUrl: "u", version: 1, postedAt: 100, editedAt: 200 }, outdated: true }), true, time);
        expect(off).toMatchObject({ tone: "mid", text: "aktualisiert T200 in #kara-do · DMs aus" });
        expect(off.sub).toContain("Stand 1");
    });

    it("names an error, a missing post and a cancelled event", () => {
        expect(lib.publishHint(publish({ error: "Bot nicht verbunden.", errorAt: 50 }), true, time)).toMatchObject({ tone: "bad", text: "Setup nicht gepostet: Bot nicht verbunden.", canPost: true });
        expect(lib.publishHint(publish(), true, time)).toMatchObject({ tone: "mid", text: "Noch nicht in #kara-do gepostet" });
        expect(lib.publishHint(publish({ cancelled: true }), true, time)).toMatchObject({ canPost: false, text: "Abgesagt – kein Setup im Kanal" });
    });

    it("speaks English when the page does", () => {
        expect(libEn.publishHint(publish(), false, time).text).toBe("On approval: posts the setup in #kara-do · DMs to 25 raiders (off)");
        const done = publish({ posted: { messageUrl: "u", version: 1, postedAt: 100, editedAt: 0 }, dmsEnabled: true, dms: { status: "done", version: 1, at: 1, total: 1, sent: 1, failed: [], unchanged: 0 } });
        expect(libEn.publishHint(done, true, time).text).toBe("posted T100 in #kara-do · 1 DM");
        expect(libEn.moveRaider(lib.toInput(setup()), "w", { group: 1 }, lib.peopleOf(setup()), 25).error).toBe("Group 1 is full — drag onto a raider to swap.");
    });
});

describe("„nicht zusammen“ in the editor", () => {
    const page = read("pages", "raid-detail", "SetupEditor.tsx");
    const de = makeT("de");

    it("asks once per event before a proposal, only when such pairs stand among the signups", () => {
        expect(page).toMatch(/if \(!shown\?\.avoidPairs \|\| typeof shown\.setup\?\.options\?\.avoid === "boolean"\) return undefined;/);
        expect(page).toMatch(/const avoid = await avoidAnswer\(\);/);
        expect(page).toMatch(/\.\.\.\(avoid === undefined \? \{\} : \{ avoid \}\)/);
        expect(de("setup.avoid.askText", { count: 2 })).toMatch(/2 Raider-Paare/);
        expect(de("setup.avoid.askNo")).toBe("Nicht berücksichtigen");
    });

    it("shows a switch and counts in the side column — never who named whom", () => {
        expect(page).toMatch(/\{avoidTotal > 0 && \(/);
        expect(page).toContain("onAvoid={(on) => save(toInput(current.current?.setup || setup), { avoid: on })}");
        expect(de("setup.summary.avoidSub", { count: 1 })).toMatch(/Wer wen genannt hat, sieht niemand/);
    });
});

describe("ping text (Ping-Nachricht) inline field", () => {
    const editor = read("pages", "raid-detail", "SetupEditor.tsx");
    const api = read("api.ts");
    const de = makeT("de");
    const en = makeT("en");

    it("decides what to send on commit: the trimmed draft, or nothing when unchanged", () => {
        expect(lib.pingTextToSave("  Los geht's, Raid!  ", "Hallo Welt")).toBe("Los geht's, Raid!");
        expect(lib.pingTextToSave("Hallo Welt", "Hallo Welt")).toBeNull();
        expect(lib.pingTextToSave("  Hallo Welt  ", "Hallo Welt")).toBeNull();
        // an emptied field is a real change (clears back to the server default)
        expect(lib.pingTextToSave("", "Hallo Welt")).toBe("");
        expect(lib.pingTextToSave("", "")).toBeNull();
    });

    it("the API layer carries the effective ping text and saves it to the dedicated endpoint", () => {
        expect(api).toContain("pingText?: string;");
        expect(api).toContain("export function saveSetupPingText(csrfToken: string | null, eventId: string, text: string): Promise<SetupEditorData> {");
        expect(api).toContain("send(\"POST\", \"/api/raids/setup/ping-text\", csrfToken, { event: eventId, text })");
    });

    it("shows an editable field beside the publish status, committing on blur or Enter — never per keystroke", () => {
        expect(editor).toContain("<PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} />");
        expect(editor).toContain("<PingTextField value={data.pingText || \"\"} disabled={busy} onSave={savePingText} />");
        // local draft state, committed via the pure helper on blur, Enter just blurs
        expect(editor).toMatch(/const \[draft, setDraft\] = useState\(value\);[\s\S]*?pingTextToSave\(draft, value\)/);
        expect(editor).toContain("onBlur={commit}");
        expect(editor).toMatch(/e\.key === "Enter"/);
        expect(editor).toContain("saveSetupPingText(ctx.csrfToken, ctx.eventId, text)");
    });

    it("labels it in German and English, making clear that this is what gets posted", () => {
        expect(de("setup.pingText.label")).toMatch(/Ping-Nachricht.*Ping everyone/);
        expect(en("setup.pingText.label")).toMatch(/Ping message.*Ping everyone/);
    });
});

describe("the raider tooltip and the drag glow", () => {
    const de = makeT("de");
    const en = makeT("en");
    const groups = () => [
        { index: 1, slots: [person("a", "Warrior-Arms", "melee"), person("b", "Warrior-Fury", "melee")] },
        { index: 2, slots: ["c", "d", "e", "f", "g"].map((id) => person(id, "Mage-Fire", "ranged")) },
        { index: 3, slots: [] },
    ];

    it("glows the free group where the dragged raider helps most, never a full or their own group", () => {
        const sham = person("sham", "Shaman-Enhancement", "melee", { fit: { 1: 2, 2: 9, 3: 1 } });
        // group 2 would help most but is full
        expect(lib.suggestGroup(sham, groups())).toBe(1);
        const inOne = person("a", "Warrior-Arms", "melee", { fit: { 1: 5, 3: 2 } });
        expect(lib.suggestGroup(inOne, groups())).toBe(3);
    });

    it("suggests nothing when the raider's buffs help nowhere", () => {
        expect(lib.suggestGroup(person("x", "Mage-Fire", "ranged"), groups())).toBeNull();
        expect(lib.suggestGroup(person("x", "Mage-Fire", "ranged", { fit: {} }), groups())).toBeNull();
    });

    it("drops the proposal's attendance reason — the tooltip has its own attendance row for everyone", () => {
        expect(lib.tipReasons(["Von der Orga fixiert", "Anwesenheit 82 %", "Kommt später"])).toEqual(["Von der Orga fixiert", "Kommt später"]);
        expect(lib.tipReasons(undefined)).toEqual([]);
    });

    it("draws the tooltip itself (icons, attendance with check or auto badge, brings) instead of a text block", () => {
        const src = read("pages", "raid-detail", "SetupEditor.tsx");
        expect(src).toContain("function SlotTip");
        // a box of the top row — never a floating layer that could cover a group
        expect(src).not.toContain("createPortal");
        expect(src).toMatch(/\{inspectedPerson \? <SlotTip p=\{inspectedPerson\}/);
        // the old text tooltip is gone from the line
        expect(src).not.toContain("data-tip-sub={personTip(p)}");
        expect(src).toMatch(/a\.link === "manual"[\s\S]*?<CheckIcon \/>[\s\S]*?setup\.person\.tip\.autoBadge/);
        // it shows the raider touched last (pointer or focus), and the read-only lineup has no panel at all
        expect(src).toContain("onMouseEnter={inspect}");
        expect(src).toContain("onFocus={inspect}");
        const css = read("styles", "setup-editor.css");
        // the glow rides on the group card
        expect(src).toContain("se-suggest");
    });

    describe("im Setup als — a raider who plays several specs (the third tank, an extra healer)", () => {
        const prot = { key: "Paladin-Protection", role: "tank" };
        const input = lib.toInput(setup());

        it("changes the slot's spec and role, keeps its place and locks it, without touching the request it came from", () => {
            const out = lib.respecRaider(input, "h", prot).input;
            const slot = out.groups[0].slots.find((x) => x.userId === "h");
            expect(slot).toMatchObject({ spec: "Paladin-Protection", role: "tank", locked: true, pos: 2 });
            expect(input.groups[0].slots.find((x) => x.userId === "h")).toMatchObject({ spec: "Priest-Holy", role: "healer", locked: false });
        });

        it("does nothing for the spec already played and locked, and refuses somebody on the bench", () => {
            const again = lib.respecRaider(lib.respecRaider(input, "h", prot).input, "h", prot);
            expect(again).toEqual({ input: null });
            expect(lib.respecRaider(input, "b", prot).error).toMatch(/Bank/);
        });

        it("offers the specs in the panel's last column, as icon buttons, and saves through the usual request", () => {
            const src = read("pages", "raid-detail", "SetupEditor.tsx");
            expect(src).toContain("const respec = (userId: string, specKey: string) => {");
            expect(src).toContain("respecRaider(toInput(shown.setup), userId, spec)");
            expect(src).toMatch(/onSpec && \(p\.classSpecs \|\| \[\]\)\.length > 1/);
            // never for somebody on the bench, and not while a save is running
            expect(src).toContain("onSpec={busy || inspectedIsBench ? undefined :");
            expect(read("styles", "setup-editor.css")).toMatch(/\.se-tip-spec\.is-on \{[^}]*border-color: var\(--accent\)/);
            expect(makeT("de")("setup.person.tip.playsAs")).toBe("Im Setup als");
        });
    });

    describe("Suche — the classes and specs the raid still needs", () => {
        const buff = (key, specs, required = false) => ({ key, label: key, icon: "i", required, specs });

        it("makes one row per set of specs that brings a buff — six blessings of the same paladin specs are one row", () => {
            const paladin = ["Paladin-Holy", "Paladin-Protection", "Paladin-Retribution"];
            const groups = lib.groupSearchBuffs([buff("kings", paladin), buff("might", paladin), buff("windfury", ["Shaman-Enhancement"], true), buff("wisdom", paladin)]);
            expect(groups.map((g) => [g.required, g.buffs.map((b) => b.key)])).toEqual([[false, ["kings", "might", "wisdom"]], [true, ["windfury"]]]);
            // the same specs but one buff required and one not are two rows: what is required must stay visible as such
            expect(lib.groupSearchBuffs([buff("a", ["X-Y"], true), buff("b", ["X-Y"], false)])).toHaveLength(2);
            expect(lib.groupSearchBuffs([])).toEqual([]);
        });

        it("has a Suche button in the bar, a dialog with the editable message and a post button, in both languages", () => {
            const src = read("pages", "raid-detail", "SetupEditor.tsx");
            expect(src).toContain('setDialog("search")');
            expect(src).toContain("function SearchModal(");
            expect(src).toContain("postRaidSearch(ctx.csrfToken, ctx.eventId, text)");
            expect(src).toContain("previewRaidSearch(ctx.csrfToken, ctx.eventId,");
            for (const fn of ["stepRole(", "toggleSpec(", "addRole(", "removeBuffs("]) expect(src).toContain(fn);
            // the message is posted as edited, never empty, never over Discord's limit, not while it is being written
            expect(src).toContain("disabled={!search || !text.trim() || text.length > 2000 || writing}");
            expect(src).not.toMatch(/\{r\.missing\}×/);
            for (const key of ["kicker", "title", "hint", "open", "required", "helps", "buffCount", "message", "post", "posted", "failed", "none", "fewer", "more", "drop", "dropSub", "add", "regenerate", "writing"]) {
                expect(makeT("de")(`setup.search.${key}`)).not.toBe(`setup.search.${key}`);
                expect(makeT("en")(`setup.search.${key}`)).not.toBe(`setup.search.${key}`);
            }
            expect(makeT("de")("setup.editor.search")).toBe("Suche");
        });

        it("edits the needs without touching the suggestion: count 1-40, a role at 0 drops out, specs in and out, a role added once, buffs dropped", () => {
            const search = { roles: [{ role: "tank", missing: 1, specs: ["A-Tank"] }], buffs: [buff("kings", ["P-Holy"]), buff("wf", ["S-Enh"], true)] };
            const needs = lib.searchNeedsFrom(search);
            expect(needs).toEqual({ roles: search.roles, buffs: search.buffs });
            expect(needs.roles[0]).not.toBe(search.roles[0]);
            expect(lib.stepRole(needs, "tank", 2).roles[0].missing).toBe(3);
            expect(lib.stepRole(needs, "tank", 100).roles[0].missing).toBe(40);
            expect(lib.stepRole(needs, "tank", -1).roles).toEqual([]);
            expect(lib.toggleSpec(needs, "tank", "B-Tank").roles[0].specs).toEqual(["A-Tank", "B-Tank"]);
            expect(lib.toggleSpec(needs, "tank", "A-Tank").roles[0].specs).toEqual([]);
            const added = lib.addRole(needs, "healer", ["H-1", "H-2"]);
            expect(added.roles[1]).toEqual({ role: "healer", missing: 1, specs: ["H-1", "H-2"] });
            expect(lib.addRole(added, "healer", ["H-1"])).toBe(added);
            expect(lib.removeBuffs(needs, ["kings"]).buffs.map((b) => b.key)).toEqual(["wf"]);
            expect(search.roles[0].missing).toBe(1);
        });
    });

    it("keeps the raider panel compact when the top area is stacked: two columns, the details in one row, buffs two by two on a phone", () => {
        const css = read("styles", "setup-editor.css");
        const stacked = css.slice(css.indexOf("@media (max-width: 1360px)"));
        expect(stacked).toMatch(/\.se-tip \{ grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 1fr\); min-height: 430px; \}/);
        expect(stacked).toMatch(/\.se-tip-col:last-child \{ grid-column: 1 \/ -1; \}/);
        expect(stacked).toMatch(/\.se-tip-col:last-child \.se-tip-body \{ flex-direction: row; flex-wrap: wrap;/);
        // a phone: one column, the buffs in a grid of two — with a reserved height, so hovering never moves the groups under the pointer
        expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.se-tip \{ grid-template-columns: minmax\(0, 1fr\); padding: 14px 14px; min-height: 500px; \}/);
        expect(css).toMatch(/\.se-tip-buffs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
        expect(read("pages", "raid-detail", "SetupEditor.tsx")).toContain('<div className="se-tip-buffs">');
    });

    it("draws the lock as an overlay that takes no width from the raider's name", () => {
        const css = read("styles", "setup-editor.css");
        expect(css).toMatch(/\.se-slot \{ position: relative;/);
        expect(css).toMatch(/\.se-lock \{ position: absolute;/);
        // locked: a small icon in the corner, no flex column of its own
        expect(css).toMatch(/\.se-lock\.is-on \{[^}]*opacity: 1;[^}]*width: 14px/);
        expect(css).not.toMatch(/\.se-lock \{[^}]*flex: 0 0 auto/);
    });

    it("says in the attendance block when the raider last signed up but stood on the bench — or that they did not, in the nights looked at", () => {
        const src = read("pages", "raid-detail", "SetupEditor.tsx");
        expect(src).toContain("function benchText(");
        // the row is an icon and the date ("–" for never); the sentence is the tooltip
        expect(src).toContain('t("setup.person.tip.lastBench", { date: bench })');
        expect(src).toContain('t("setup.person.tip.benchNever", { count: a.benchNights })');
        expect(src).toContain("<BenchIcon />{bench}");
        // the character link is the Auto badge or the check mark, with the sentence as its tooltip, not a line of text
        expect(src).toContain('data-tip={t("setup.person.tip.linkAuto")}>{t("setup.person.tip.autoBadge")}');
        expect(src).not.toContain('<span className="se-tip-sub">{a.link === "manual"');
        // nothing to say without an earlier night
        expect(src).toMatch(/if \(!a \|\| !a\.benchNights\) return "";/);
        expect(makeT("de")("setup.person.tip.lastBench", { date: "12.09.2026" })).toBe("Zuletzt auf der Bank: 12.09.2026");
        expect(makeT("en")("setup.person.tip.benchNever", { count: 10 })).toBe("Not on the bench in the last 10 raids");
    });

    it("shows the spec tile only (no role icon), the name in full and the auto badge not in capitals", () => {
        const src = read("pages", "raid-detail", "SetupEditor.tsx");
        expect(src).not.toContain("ROLE_ICONS");
        const css = read("styles", "setup-editor.css");
        // the name is never wrapped and never cut off: the header across the panel gives it the width
        expect(css).toMatch(/\.se-tip-name \{[^}]*white-space: nowrap/);
        expect(css).not.toMatch(/\.se-tip-name \{[^}]*text-overflow/);
        expect(css).not.toMatch(/\.se-tip-auto \{[^}]*text-transform: uppercase/);
        expect(de("setup.person.tip.autoBadge")).toBe("Auto");
    });

    it("has the tooltip's texts in German and English", () => {
        for (const key of ["attendance", "attendanceNone", "attendanceCount", "linkManual", "linkAuto", "autoBadge", "brings", "bringsGroup", "bringsRaid", "why"]) {
            expect(de(`setup.person.tip.${key}`)).not.toBe(`setup.person.tip.${key}`);
            expect(en(`setup.person.tip.${key}`)).not.toBe(`setup.person.tip.${key}`);
        }
    });

    describe("Extra tank / healer", () => {
        it("has a toggle per role the class can take besides the setup's, a pill on the tile, and texts in both languages", () => {
            const src = read("pages", "raid-detail", "SetupEditor.tsx");
            expect(src).toContain("saveSetupExtraRole(ctx.csrfToken, ctx.eventId, userId, role, on)");
            expect(src).toContain('(["tank", "healer"] as const).filter((r) => r !== p.role');
            expect(src).toContain("ui.extraRoles[p.userId]");
            expect(src).toContain("aria-pressed={on}");
            // the bench is not marked: only a raider in the setup can be an extra
            expect(src).toContain("onExtra={inspectedIsBench ? undefined");
            for (const key of ["setup.person.tip.extra", "setup.person.tip.extraSub", "setup.extra.tip", "setup.extra.short.tank", "setup.extra.short.healer"]) {
                expect(makeT("de")(key, { role: "Tank" })).not.toBe(key);
                expect(makeT("en")(key, { role: "Tank" })).not.toBe(key);
            }
        });
    });
});
