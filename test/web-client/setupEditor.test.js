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
        expect(input.groups[0].slots[0]).toEqual({ userId: "t", character: "t", spec: "Warrior-Protection", role: "tank", locked: true });
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
        expect(out.input.groups.find((g) => g.index === 3).slots).toEqual([{ userId: "b", character: "b", spec: "Hunter-BeastMastery", role: "ranged", locked: false }]);
        expect(out.input.bench).toEqual([]);
    });

    it("refuses a full group and a full raid, but swaps onto a raider", () => {
        expect(lib.moveRaider(input, "w", { group: 1 }, people, 25).error).toMatch(/Gruppe 1 ist voll/);
        expect(lib.moveRaider(input, "b", { group: 2 }, people, 6).error).toMatch(/Raid ist voll/);
        const swap = lib.moveRaider(input, "b", { userId: "h" }, people, 6);
        expect(swap.input.groups[0].slots.map((x) => x.userId)).toEqual(["t", "m1", "m2", "r", "b"]);
        expect(swap.input.bench.map((x) => x.userId)).toEqual(["h"]);
        const across = lib.moveRaider(input, "w", { userId: "t" }, people, 25);
        expect(across.input.groups[0].slots.map((x) => x.userId)).toContain("w");
        expect(across.input.groups[1].slots).toEqual([{ userId: "t", character: "t", spec: "Warrior-Protection", role: "tank", locked: true }]);
    });

    it("does nothing where nothing would change", () => {
        expect(lib.moveRaider(input, "m1", { group: 1 }, people, 25)).toEqual({ input: null });
        expect(lib.moveRaider(input, "m1", { userId: "m2" }, people, 25)).toEqual({ input: null });
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
        expect(editor).toContain("className=\"se-here\"");
        expect(editor).toMatch(/e\.key === "Escape"/);
        // no drag-and-drop library
        expect(editor).not.toMatch(/from "(react-dnd|@dnd-kit|react-beautiful-dnd)/);
    });

    it("keeps one line per raider — reasons only in the tooltip", () => {
        expect(editor).toContain("data-tip-sub={personTip(p)}");
        expect(editor).toContain("...(p.reasons || []),");
        // the reasons are never rendered as text of their own
        expect(editor).not.toMatch(/\.reasons\.map\(/);
        expect(editor).toContain("<span className={`se-name ${color.className || \"\"}`} style={color.style}>{p.character}</span>");
        expect(editor).toContain("icon={p.locked ? <LockIcon /> : <UnlockIcon />}");
    });

    it("keeps the side column to roles, buffs, fairness and wishes — weights and the explanation in dialogs", () => {
        const summary = editor.match(/function Summary\([\s\S]*?\n}\n/)[0];
        for (const label of ["label={rolePluralLabel(\"tank\")}", "label={rolePluralLabel(\"healer\")}", "label={t(\"setup.summary.dps\")}", "{t(\"setup.summary.buffs\")}<", "{t(\"setup.summary.fairness\")}<", "{t(\"setup.summary.wishes\")}<", "{t(\"setup.summary.weights\")}"]) {
            expect({ label, found: summary.includes(label) }).toEqual({ label, found: true });
        }
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
