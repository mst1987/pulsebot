// Das Raid-Cockpit (#319) im Client: die reinen Texte von
// src/web-client/src/lib/raidSteps.ts wirklich ausgeführt, gegen die Server-Regel
// (src/web/raidDetailSteps.js) gehalten, und der Seitenaufbau an der Quelle
// geprüft — eine Leiste nur für eigene Events, ein auffälliger Knopf, keine
// zweite Haupt-Tat im Kopf, auf dem Handy eine Zeile statt waagerechtem Scrollen.
const fs = require("fs");
const path = require("path");
const { eventSteps, STEP_IDS, STEP_STATES } = require("../../src/web/raidDetailSteps");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

/** The lib without its TypeScript: `import type`, `export type` and one-line signatures only. */
function load() {
    const lines = read("lib", "raidSteps.ts").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) {
            let depth = 0;
            for (; i < lines.length; i++) {
                for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
                if (depth === 0 && /;\s*$/.test(lines[i])) break;
            }
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const lib = load();
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const inHours = (h) => Math.floor((NOW + h * 3600 * 1000) / 1000);

function progress(overrides = {}) {
    const { event, ...rest } = overrides;
    return eventSteps({
        event: {
            id: "eh-1", source: "eventhelper", title: "SSC + TK", channelName: "mi-23-09",
            startTime: inHours(48), size: 25, signupDeadline: inHours(24), isPast: false, status: "active",
            ...(event || {}),
        },
        ownSignups: [{ status: "signed" }],
        attendance: { responded: [], missing: [] },
        signupTarget: 25, lootItems: [], eventLogs: [],
        ...rest,
    }, { now: NOW });
}

describe("the step bar's words", () => {
    it("names every state the server can send", () => {
        for (const state of STEP_STATES) expect(lib.stepStateLabel(state).length).toBeGreaterThan(4);
        expect(STEP_STATES.map(lib.stepStateLabel)).toEqual(["erledigt", "jetzt dran", "später", "übersprungen", "abgesagt"]);
    });

    it("keeps „übersprungen“ out of the error colours", () => {
        expect(lib.stepStateTone("skipped")).toBeUndefined();
        expect(lib.stepStateTone("todo")).toBeUndefined();
        expect(lib.stepStateTone("done")).toBe("ok");
        expect(lib.stepStateTone("current")).toBe("accent");
        expect(lib.stepStateTone("cancelled")).toBe("bad");
        // and no state reads like a fault
        for (const state of STEP_STATES) expect(lib.stepStateLabel(state)).not.toMatch(/fehlt|Fehler|kaputt/i);
    });

    it("counts a step's place in the route the server sent", () => {
        const p = progress();
        expect(lib.stepPosition(p.steps, "setup")).toBe(`Schritt 3 von ${STEP_IDS.length}`);
        expect(lib.stepPosition(p.steps, "after")).toBe("Schritt 5 von 5");
        expect(lib.stepPosition(p.steps, "nope")).toBe("");
    });

    it("falls to one line: „Schritt n von 5 · Label“", () => {
        expect(lib.stepSummary(progress())).toBe("Schritt 2 von 5 · Anmeldung");
        const done = progress({ event: { signupsClosed: true, startTime: inHours(0.2) } });
        expect(done.current).toBe("");
        expect(lib.stepSummary(done)).toBe(done.note);
        const cancelled = progress({ event: { status: "cancelled", cancelReason: "Zu wenig Heiler" } });
        expect(lib.stepSummary(cancelled)).toBe("Abgesagt: Zu wenig Heiler");
    });

    it("puts the clipped note and the deed into the tooltip, and the figure into one string", () => {
        const p = progress({ ownSignups: [{ status: "signed" }, { status: "bench" }] });
        const created = p.steps[0];
        expect(lib.stepTipSub(created, true)).toBe(`${created.hint} · Klick: Bearbeiten`);
        expect(lib.stepFigure(created)).toBe("#mi-23-09");
        // the note is the part the narrow cell cuts off, so it leads the tooltip
        const signup = p.steps[1];
        expect(signup.note).toBe("1 auf der Warteliste");
        expect(lib.stepTipSub(signup, false)).toBe(`${signup.note} · ${signup.hint}`);
        expect(lib.stepFigure(signup)).toBe("1 / 25 1 auf der Warteliste");
        // a step without a deed says only what it is
        expect(lib.stepTipSub({ ...created, action: null }, true)).toBe(created.hint);
    });

    it("hands a reader the same bar without a single deed", () => {
        const p = progress();
        expect(p.action).not.toBeNull();
        const read = lib.withoutDeeds(p);
        expect(read.action).toBeNull();
        expect(read.steps.every((s) => s.action === null)).toBe(true);
        // and nothing else changes
        expect(read.steps.map((s) => [s.id, s.state, s.value])).toEqual(p.steps.map((s) => [s.id, s.state, s.value]));
        expect(p.steps.some((s) => s.action)).toBe(true);
    });
});

describe("the step bar in the page", () => {
    const bar = read("pages", "raid-detail", "StepBar.tsx");
    const page = read("pages", "RaidDetailPage.tsx");
    const hero = read("pages", "raid-detail", "RaidDetailHero.tsx");
    const css = read("styles", "raid-detail.css");

    it("draws the route the server sent, never one of its own", () => {
        expect(bar).toContain("progress.steps.map(");
        // no step list, label or rule in the TSX
        expect(bar).not.toMatch(/"Angelegt"|"Nachbereitung"|"Freigabe"/);
        expect(bar).not.toMatch(/signupDeadline|autoSuggest|ownSetup/);
    });

    it("marks the open step and gives only it a loud button", () => {
        expect(bar).toContain("step.state === \"current\"");
        expect((bar.match(/<Button\b/g) || []).length).toBe(2); // the open step, plus the way back of a cancelled raid
        expect(bar).toMatch(/variant="ghost"[^>]*onClick=\{\(\) => onDeed\(progress\.action!\)\}/);
        expect(css).toMatch(/\n\.rd-ck\.current \{/);
    });

    it("says „übersprungen“ quietly — no red, no strike-through", () => {
        const skipped = css.match(/\.rd-ck\.state-skipped \{([^}]*)\}/)[1];
        expect(skipped).toMatch(/opacity/);
        expect(skipped).not.toMatch(/line-through|--bad|red/);
    });

    it("only an own event gets the bar, and then the head's old primary stays away", () => {
        expect(page).toContain("const cockpit: RaidEventSteps | null = data.steps ?");
        expect(page).toContain("withoutDeeds(data.steps)");
        expect(hero).toContain("const primary = cancelled || cockpit ? null : data.progress?.primary || null;");
        // a Raid-Helper event keeps the bar of #219
        expect(hero).toContain("{cockpit || (!!data.progress?.steps?.length && (");
    });

    it("turns a deed into exactly one thing, in one place", () => {
        const deed = page.match(/const runDeed = \(deed: RaidStepDeed\) => \{([\s\S]*?)\n {4}\};/)[1];
        expect(deed).toContain("if (deed.manage) runManage(deed.manage);");
        expect(deed).toContain("else if (deed.modal) setModal(deed.modal);");
        expect(deed).toContain("else if (deed.tab) switchTab(deed.tab);");
        expect(deed).toContain("deed.evaluate");
    });

    it("collapses to one line on a phone instead of scrolling sideways", () => {
        const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
        expect(narrow).toContain(".rd-ck-sum { display: block; }");
        expect(narrow).toContain(".rd-ck-steps { grid-template-columns: 1fr; }");
        expect(narrow).toContain(".rd-ck-steps:has(> li.is-current) > li:not(.is-current) { display: none; }");
        // nothing in the bar may scroll horizontally
        expect(css).not.toMatch(/\.rd-c[k]?[a-z-]*\s*\{[^}]*overflow-x/);
    });

    it("carries no native title and no glyph icons", () => {
        expect(/<[a-z][a-z0-9]*\s[^<>]*\btitle=/.test(bar)).toBe(false);
        expect(/[✕×↗✓✗○🎉]/u.test(bar)).toBe(false);
    });
});
