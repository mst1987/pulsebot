// The editor's view "Animation" (docs/raidplan/animation.md): a scene is created, frames are added, an object dragged on the map
// moves in the chosen frame, the panel sets caption, timing and a debuff icon, "Vorschau" plays the scene, and the scene is deleted
// after asking. Everything goes through the board's `edit`, like the rest of the editor.
import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanBoss } from "../../../api";
import { JobsProvider } from "../../shell/Jobs";
import { ConfirmProvider } from "../../ui/Modal";
import { boardOf, emptyBoard } from "../../../lib/raidplan";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";
import { VIEW_KEY } from "./planView";

const BOSS: RaidplanBoss = { key: "b1", instanceId: "bt", instanceName: "BT", name: "Gurtogg", iconUrl: "", mapUrl: "", mapSource: "", ownMap: false, instanceMap: false };
const BES: Besetzung = { size: 25, counts: { tank: 3, healer: 6, dps: 16, melee: 8, ranged: 8 }, groups: 5, split: false };
const MARK = { id: "m1", mark: "skull" as const, x: 0.2, y: 0.5, size: 34, opacity: 1, lock: false, hidden: false };
let latest: RaidplanBoard | null = null;

function Harness({ initial }: { initial: RaidplanBoard }) {
    const h = useDraftHistory();
    useEffect(() => { h.reset({ [BOSS.key]: initial }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const board = boardOf(h.draft, BOSS.key);
    latest = board;
    return (
        <BoardWorkspace
            mode="template" eventId="" besetzung={BES} catalog={null} boss={BOSS} allBosses={[BOSS]} board={board}
            edit={(fn, coalesce) => h.edit(BOSS.key, fn, coalesce)} roster={[]} canWrite
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={<span>Abschnitte</span>} mapRows={[]} onMapsChanged={() => undefined}
        />
    );
}
function setup(over: Partial<RaidplanBoard> = {}) {
    return render(<JobsProvider><ConfirmProvider><Harness initial={{ ...emptyBoard(), marks: [MARK], ...over }} /></ConfirmProvider></JobsProvider>);
}
const mark = () => document.querySelector("[data-obj=\"mark:m1\"]") as HTMLElement;
const grip = () => mark().querySelector("button") as HTMLElement;
/** jsdom has no PointerEvent: a MouseEvent that carries the pointer fields the drag reads. */
class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
const scenes = () => latest!.scenes || [];
const strip = () => screen.getByRole("listbox", { name: "Takte der Animation" });

beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(VIEW_KEY, "anim");
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("PointerEvent", FakePointerEvent);
    // the canvas is 1000 x 500 px from the top-left corner: a drag of 100 px is a tenth of the board
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); latest = null; });

describe("the view 'Animation'", () => {
    it("is the third view and explains itself before the first scene", () => {
        setup();
        expect(screen.getByRole("radio", { name: "Animation" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("Noch keine Animation")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        expect(scenes()).toHaveLength(1);
        expect(screen.getByRole("tab", { name: /Animation 1/ })).toHaveAttribute("aria-selected", "true");
        expect(within(strip()).getByRole("option", { name: /Ausgangsstellung/ })).toHaveAttribute("aria-selected", "true");
    });

    it("adds a frame, moves the dragged object in it and shows its dotted way", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Takt$/ }));
        expect(within(strip()).getAllByRole("option")).toHaveLength(2);
        expect(screen.getByRole("heading", { name: /Takt 2 von 2/ })).toBeTruthy();

        fireEvent.pointerDown(grip(), { clientX: 200, clientY: 250, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 500, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(scenes()[0].frames[1].changes).toEqual([{ obj: "mark:m1", x: 0.5, y: 0.2, delay: 0, dur: 1, ease: "inout" }]);
        expect(mark().style.getPropertyValue("--rp-x")).toBe("50%");
        expect(document.querySelectorAll(".rp-trail.is-hint").length).toBeGreaterThan(5);
        expect(screen.getByText("Ändert sich in diesem Takt")).toBeTruthy();
        // the board itself stays where it was: only the scene moved the mark
        expect(latest!.marks[0]).toMatchObject({ x: 0.2, y: 0.5 });

        // the first frame shows the starting position again
        fireEvent.click(within(strip()).getByRole("option", { name: /Ausgangsstellung/ }));
        expect(mark().style.getPropertyValue("--rp-x")).toBe("20%");
    });

    it("sets caption, timing, motion and a debuff icon of the picked object", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Takt$/ }));
        fireEvent.change(screen.getByRole("textbox", { name: "Untertitel des Takts" }), { target: { value: "Totenkopf läuft" } });
        expect(within(strip()).getByRole("option", { selected: true })).toHaveTextContent("Totenkopf läuft");

        fireEvent.pointerDown(grip(), { clientX: 200, clientY: 250, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 300, clientY: 250, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        fireEvent.click(screen.getByRole("button", { name: "Startet nach erhöhen" }));
        fireEvent.click(screen.getByRole("button", { name: "Dauert erhöhen" }));
        fireEvent.click(screen.getByRole("radio", { name: "Gleichmäßig" }));
        fireEvent.click(screen.getByRole("button", { name: "Bloodboil" }));
        fireEvent.click(screen.getByRole("switch", { name: "Pulsieren" }));
        const [c] = scenes()[0].frames[1].changes;
        expect(c).toMatchObject({ obj: "mark:m1", delay: 0.1, dur: 1.1, ease: "linear", badge: "spell_shadow_bloodboil", pulse: true });
        expect(scenes()[0].frames[1].caption).toBe("Totenkopf läuft");
        expect(document.querySelector(".rp-fx-badge")).not.toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /Alles in diesem Takt zurücksetzen/ }));
        expect(scenes()[0].frames[1].changes).toEqual([]);
    });

    it("lengthens a frame, previews the scene and deletes it after asking", async () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Takt$/ }));
        fireEvent.click(screen.getByRole("button", { name: "Dauer des Takts erhöhen" }));
        expect(scenes()[0].length).toBe(4.5);

        fireEvent.click(screen.getByRole("button", { name: /Vorschau/ }));
        expect(screen.getByRole("group", { name: "Animation abspielen" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Vorschau beenden/ }));
        expect(screen.queryByRole("group", { name: "Animation abspielen" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /Animation löschen/ }));
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
        await screen.findByText("Noch keine Animation");
        expect(scenes()).toEqual([]);
    });

    it("draws a movement's way and a loop on the map (#712)", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Takt$/ }));
        fireEvent.pointerDown(grip(), { clientX: 200, clientY: 250, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 500, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        const wrap = document.querySelector(".rp-anim-boardwrap") as HTMLElement;

        // the way of the movement: a click adds a point, a double click on its grip removes it, Esc ends the drawing
        fireEvent.click(screen.getByRole("button", { name: "Weg zeichnen" }));
        expect(wrap.classList.contains("is-drawing")).toBe(true);
        fireEvent.pointerDown(wrap, { clientX: 350, clientY: 300, pointerId: 2 });
        expect(scenes()[0].frames[1].changes[0].path).toEqual([[0.35, 0.6]]);
        expect(document.querySelectorAll(".rp-path-pt")).toHaveLength(1);
        fireEvent.doubleClick(document.querySelector(".rp-path-pt")!);
        expect(scenes()[0].frames[1].changes[0].path).toBeUndefined();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(wrap.classList.contains("is-drawing")).toBe(false);

        // a loop starts where the mark stands after this frame and is drawn at once
        fireEvent.click(screen.getByRole("button", { name: /^Dauerbewegung$/ }));
        expect(scenes()[0].loops[0]).toMatchObject({ obj: "mark:m1", path: [[0.5, 0.2]], from: 2, closed: true });
        fireEvent.pointerDown(wrap, { clientX: 800, clientY: 200, pointerId: 3 });
        fireEvent.pointerDown(wrap, { clientX: 700, clientY: 400, pointerId: 4 });
        expect(scenes()[0].loops[0].path).toHaveLength(3);
        expect(document.querySelectorAll(".rp-path-pt")).toHaveLength(3);
        fireEvent.click(screen.getByRole("switch", { name: "Spur zeigen" }));
        fireEvent.click(screen.getByRole("switch", { name: "Rundweg" }));
        expect(scenes()[0].loops[0]).toMatchObject({ trail: true, closed: false });
        fireEvent.click(screen.getByRole("button", { name: "Dauerbewegung 1 entfernen" }));
        expect(scenes()[0].loops).toEqual([]);
    });

    it("links a scene to a tactic step and marks the step in the task view (#713)", () => {
        const step = { id: "st1", action: "kite", participants: ["slot:tank:2"], sentence: "kitet die Flamme", targets: [], timing: { kind: "" as const, from: null, to: null, text: "" } };
        setup({ steps: [step] });
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        fireEvent.change(screen.getByRole("combobox", { name: /Gehört zum Taktik-Schritt/ }), { target: { value: "st1" } });
        expect(scenes()[0].stepId).toBe("st1");
        fireEvent.click(screen.getByRole("radio", { name: "Aufgaben" }));
        expect(screen.getByLabelText("Hat eine Animation")).toBeTruthy();
    });
});
