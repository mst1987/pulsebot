// Das Raid-Cockpit (#319) im Client: die reinen Texte von
// src/web-client/src/lib/raidSteps.ts wirklich ausgeführt (mit dem echten
// `t`, Deutsch) und gegen die Server-Regel (src/web/raidDetailSteps.js)
// gehalten. Die gezeichnete Leiste: pages/raid-detail/StepBar.test.tsx, ihre
// Verdrahtung in der Seite: pages/RaidDetailPage.steps.test.tsx.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as lib from "./raidSteps";
import { t } from "../i18n";
import { BACKEND_SRC, requireBackend } from "../test/backend";
import { inLang } from "../test/i18n";

const { eventSteps, STEP_IDS, STEP_STATES } = requireBackend("web/raidDetailSteps");

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const inHours = (h: number) => Math.floor((NOW + h * 3600 * 1000) / 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a partial server input, shaped per test
function progress(overrides: Record<string, any> = {}) {
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


// The step names and deed labels come from the server in German next to a
// fixed id; the client shows them in the menu language by that id (#i18n).
describe("the cockpit in the menu language", () => {
    // every deed the server can send, read off its deed("id", "Label", …) calls
    const server = fs.readFileSync(path.join(BACKEND_SRC, "web", "raidDetailSteps.js"), "utf8");
    const deeds = [...server.matchAll(/deed\("(\w+)", "([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
    // "CLA auswerten" carries the analysis' name and stays as the server sends it
    const named = deeds.filter((d) => d.id !== "evaluate");

    it("knows every step and every deed the server can send, in both languages", async () => {
        expect(named.length).toBeGreaterThan(5);
        const unknown = () => [
            ...STEP_IDS.filter((id: string) => t(`raidDetail.steps.title.${id}`) === `raidDetail.steps.title.${id}`),
            ...named.filter((d) => t(`raidDetail.steps.deed.${d.id}`) === `raidDetail.steps.deed.${d.id}`).map((d) => d.id),
        ];
        expect(unknown()).toEqual([]);
        expect(await inLang("en", unknown)).toEqual([]);
    });

    it("keeps the server's German where the dictionary has the same text", () => {
        for (const d of named) expect({ id: d.id, text: t(`raidDetail.steps.deed.${d.id}`) }).toEqual({ id: d.id, text: d.label });
    });

    it("names steps and deeds by id, the server's text only as fallback", () => {
        const step = { id: "approval", label: "Freigabe" };
        expect(lib.stepTitle(step)).toBe("Freigabe");
        expect(lib.stepTitle({ id: "future", label: "Neu" })).toBe("Neu");
        expect(lib.deedLabel({ id: "evaluate", label: "CLA auswerten" })).toBe("CLA auswerten");
        expect(lib.deedLabel({ id: "approve", label: "egal" })).toBe("Setup freigeben");
    });
});
