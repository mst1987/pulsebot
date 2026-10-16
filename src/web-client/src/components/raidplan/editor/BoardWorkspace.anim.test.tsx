// The editor's view "Animation" (docs/raidplan/animation.md, design B "Aktionen als Sätze", #722): who is picked is always visible
// (the map lights them, a label names them, "Wer?" marks them), a frame's actions read as sentences, and the assistant adds an action
// Wer → Was → Wohin. A click on a group's raider picks the group, Alt + click (or "Einzeln" in "Wer?") only him. Everything goes
// through the board's `edit`, like the rest of the editor.
import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import { JobsProvider } from "../../shell/Jobs";
import { ConfirmProvider } from "../../ui/Modal";
import { boardOf, emptyBoard } from "../../../lib/raidplan";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";
import { VIEW_KEY } from "./planView";

const BOSS: RaidplanBoss = { key: "b1", instanceId: "bt", instanceName: "BT", name: "Gurtogg", iconUrl: "", mapUrl: "", mapSource: "", ownMap: false, instanceMap: false };
const BES: Besetzung = { size: 25, counts: { tank: 3, healer: 6, dps: 16, melee: 8, ranged: 8 }, groups: 5, split: false };
const look = { opacity: 1, lock: false, hidden: false };
const MARK = { id: "m1", mark: "skull" as const, x: 0.2, y: 0.5, size: 34, ...look };
const GROUP = { id: "g1", kind: "group" as const, n: 1, label: "", x: 0.5, y: 0.5, userId: "", size: 38, hideMembers: false, split: true, offsets: {}, ...look };
const raider = (userId: string, character: string): RaidplanPlayer => ({ userId, character, classId: "Priest", className: "Priest", classColor: "#e8e8e8", spec: "", specLabel: "Holy", role: "healer", iconUrl: "", group: 1 });
const ROSTER = [raider("u1", "Heilbert"), raider("u2", "Disziplin"), raider("u3", "Segenreich")];
let latest: RaidplanBoard | null = null;

function Harness({ initial, event }: { initial: RaidplanBoard; event: boolean }) {
    const h = useDraftHistory();
    useEffect(() => { h.reset({ [BOSS.key]: initial }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const board = boardOf(h.draft, BOSS.key);
    latest = board;
    return (
        <BoardWorkspace
            mode={event ? "event" : "template"} eventId={event ? "e1" : ""} besetzung={BES} catalog={null} boss={BOSS} allBosses={[BOSS]} board={board}
            edit={(fn, coalesce) => h.edit(BOSS.key, fn, coalesce)} roster={event ? ROSTER : []} canWrite
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={<span>Abschnitte</span>} mapRows={[]} onMapsChanged={() => undefined}
        />
    );
}
function setup(over: Partial<RaidplanBoard> = {}, event = false) {
    return render(<JobsProvider><ConfirmProvider><Harness initial={{ ...emptyBoard(), marks: [MARK], ...over }} event={event} /></ConfirmProvider></JobsProvider>);
}
const obj = (key: string) => document.querySelector(`[data-obj="${key}"]`) as HTMLElement;
const grip = (key: string) => obj(key).querySelector("button") as HTMLElement;
const scenes = () => latest!.scenes || [];
const strip = () => screen.getByRole("listbox", { name: "Takte der Animation" });
const who = () => screen.getByRole("region", { name: "Wer?" });
const wrap = () => document.querySelector(".rp-anim-boardwrap") as HTMLElement;
const changes = () => scenes()[0].frames[1].changes;
/** a new scene with a second frame, which is then the one edited */
function sceneWithFrame() {
    fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
    fireEvent.click(within(strip()).getByRole("button", { name: /^Takt$/ }));
}
/** jsdom has no PointerEvent: a MouseEvent that carries the pointer fields the drag reads. */
class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}

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
    it("is the third view, explains itself before the first scene and starts at the starting position", () => {
        setup();
        expect(screen.getByRole("radio", { name: "Animation" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("Noch keine Animation")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Neue Animation/ }));
        expect(scenes()).toHaveLength(1);
        expect(screen.getByRole("tab", { name: /Animation 1/ })).toHaveAttribute("aria-selected", "true");
        expect(within(strip()).getByRole("option", { name: /Ausgangsstellung/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText(/Hier ändert sich noch nichts/)).toBeTruthy();
    });

    it("a drag moves the object in this frame; the frame reads it as a sentence and the map names who is picked", () => {
        setup();
        sceneWithFrame();
        expect(screen.getByRole("heading", { name: /Takt 2 von 2/ })).toBeTruthy();
        fireEvent.pointerDown(grip("mark:m1"), { clientX: 200, clientY: 250, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 500, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(changes()).toEqual([{ obj: "mark:m1", x: 0.5, y: 0.2, delay: 0, dur: 1, ease: "inout" }]);
        expect(obj("mark:m1").style.getPropertyValue("--rp-x")).toBe("50%");
        expect(document.querySelectorAll(".rp-trail.is-hint").length).toBeGreaterThan(5);
        expect(screen.getByRole("button", { name: "Totenkopf bewegt sich nach rechts oben" })).toBeTruthy();
        expect(document.querySelector(".rp-anim-sellabel")).toHaveTextContent("Totenkopf");
        expect(obj("mark:m1").className).toContain("rp-lit");
        // the strip names who acts in the frame; the board itself never changes
        expect(within(strip()).getByRole("option", { selected: true })).toHaveTextContent("Totenkopf");
        expect(latest!.marks[0]).toMatchObject({ x: 0.2, y: 0.5 });
    });

    it("the assistant asks Wer, then Was: a debuff for the picked, with a pulse", () => {
        setup();
        sceneWithFrame();
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        expect(screen.getByText(/Wähle unten bei „Wer\?“/)).toBeTruthy();
        expect(who().className).toContain("is-active");
        expect(screen.getByRole("button", { name: "Weiter: Was?" })).toBeDisabled();
        fireEvent.click(within(who()).getByRole("button", { name: /Totenkopf/ }));
        fireEvent.click(screen.getByRole("button", { name: "Weiter: Was?" }));
        fireEvent.click(screen.getByRole("radio", { name: /^Debuff/ }));
        fireEvent.click(screen.getByRole("button", { name: "Bloodboil" }));
        fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
        expect(changes()[0]).toMatchObject({ obj: "mark:m1", badge: "spell_shadow_bloodboil", pulse: true });
        expect(screen.getByRole("button", { name: "Totenkopf bekommt Bloodboil" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Totenkopf pulsiert" })).toBeTruthy();
        expect(screen.queryByRole("region", { name: "Neue Aktion" })).toBeNull();
    });

    it("a debuff is taken off again in a later frame, its pulse with it", () => {
        setup();
        sceneWithFrame();
        fireEvent.click(within(who()).getByRole("button", { name: /Totenkopf/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        fireEvent.click(screen.getByRole("radio", { name: /^Debuff/ }));
        fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
        expect(document.querySelectorAll(".rp-fx-badge")).toHaveLength(1);

        // frame 3: Totenkopf loses it
        fireEvent.click(within(strip()).getByRole("button", { name: /^Takt$/ }));
        expect(screen.getByRole("heading", { name: /Takt 3 von 3/ })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        fireEvent.click(screen.getByRole("radio", { name: /^Debuff/ }));
        fireEvent.click(screen.getByRole("radio", { name: "Verlieren" }));
        expect(screen.getByText("Totenkopf verliert den Debuff ab diesem Takt.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Bloodboil" })).toBeNull();
        expect(screen.getByRole("switch", { name: "Pulsieren auch beenden" })).toBeChecked();
        fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
        expect(scenes()[0].frames[2].changes[0]).toMatchObject({ obj: "mark:m1", badge: "", pulse: false });
        expect(screen.getByRole("button", { name: "Totenkopf verliert Bloodboil" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Totenkopf hört auf zu pulsieren" })).toBeTruthy();
        // gone in frame 3 (badge and pulse), still there in frame 2
        expect(document.querySelectorAll(".rp-fx-badge, .rp-fx-pulse")).toHaveLength(0);
        fireEvent.click(within(strip()).getAllByRole("option")[1]);
        expect(document.querySelectorAll(".rp-fx-badge")).toHaveLength(1);
    });

    it("walking goes Wer → Was → Wohin: a click on the map is the target", () => {
        setup();
        sceneWithFrame();
        fireEvent.click(within(who()).getByRole("button", { name: /Totenkopf/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        fireEvent.click(screen.getByRole("radio", { name: /Laufen/ }));
        fireEvent.click(screen.getByRole("button", { name: "Weiter: Wohin?" }));
        expect(screen.getAllByText("Klicke auf die Karte, wohin Totenkopf laufen soll.").length).toBeGreaterThan(0);
        expect(wrap().className).toContain("is-drawing");
        fireEvent.pointerDown(wrap(), { clientX: 800, clientY: 400, pointerId: 2 });
        expect(changes()[0]).toMatchObject({ obj: "mark:m1", x: 0.8, y: 0.8 });
        expect(wrap().className).not.toContain("is-drawing");
    });

    it("a click on a raider picks his whole group, Alt + click only him, 'Einzeln' in 'Wer?' too", () => {
        setup({ marks: [], slots: [GROUP] }, true);
        sceneWithFrame();
        fireEvent.pointerDown(grip("member:g1~u2"), { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(document.querySelector(".rp-anim-sellabel")).toHaveTextContent("Gruppe 1 · 3 Spieler");
        expect(document.querySelector(".rp-anim-sellabel")).toHaveTextContent("Heilbert, Disziplin, Segenreich");
        for (const u of ["u1", "u2", "u3"]) expect(obj(`member:g1~${u}`).className).toContain("rp-lit");
        // the picked group opens its raiders in "Wer?"
        expect(within(who()).getByRole("group", { name: "Spieler von Gruppe 1" })).toBeTruthy();

        fireEvent.pointerDown(grip("member:g1~u2"), { clientX: 10, clientY: 10, pointerId: 1, altKey: true });
        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(document.querySelector(".rp-anim-sellabel")).toHaveTextContent("Disziplin");
        expect(obj("member:g1~u2").className).toContain("rp-lit");
        expect(obj("member:g1~u1").className).toContain("rp-unlit");

        fireEvent.click(within(within(who()).getByRole("group", { name: "Spieler von Gruppe 1" })).getByRole("button", { name: /Heilbert/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        expect(screen.getByRole("radio", { name: /Ausblenden/ })).toBeDisabled();
        fireEvent.click(screen.getByRole("radio", { name: /Pulsieren/ }));
        fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
        expect(changes()[0]).toMatchObject({ obj: "member:g1~u1", pulse: true });
        expect(screen.getByRole("button", { name: "Heilbert pulsiert" })).toBeTruthy();
    });

    it("an action is changed and taken off right in its sentence", () => {
        setup();
        sceneWithFrame();
        fireEvent.pointerDown(grip("mark:m1"), { clientX: 200, clientY: 250, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 500, clientY: 100, pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        fireEvent.click(screen.getByRole("button", { name: "Ändern: Totenkopf bewegt sich nach rechts oben" }));
        fireEvent.click(screen.getByRole("button", { name: "Startet nach erhöhen" }));
        fireEvent.click(screen.getByRole("radio", { name: "Gleichmäßig" }));
        expect(changes()[0]).toMatchObject({ delay: 0.1, ease: "linear" });
        expect(screen.getByText("nach 0,1 s")).toBeTruthy();
        // its way: a click on the map while drawing puts a point on it
        fireEvent.click(screen.getByRole("button", { name: "Weg zeichnen" }));
        fireEvent.pointerDown(wrap(), { clientX: 350, clientY: 300, pointerId: 2 });
        expect(changes()[0].path).toEqual([[0.35, 0.6]]);
        expect(screen.getByText("über 1 Wegpunkte")).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        fireEvent.click(screen.getByRole("button", { name: "Entfernen: Totenkopf bewegt sich nach rechts oben" }));
        expect(changes()).toEqual([]);
    });

    it("a loop of the assistant runs along the clicked points from this frame on", () => {
        setup();
        sceneWithFrame();
        fireEvent.click(within(who()).getByRole("button", { name: /Totenkopf/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Aktion$/ }));
        fireEvent.click(screen.getByRole("radio", { name: /Rundweg/ }));
        fireEvent.click(screen.getByRole("button", { name: "Weiter: Wohin?" }));
        expect(screen.getByRole("button", { name: "Fertig" })).toBeDisabled();
        fireEvent.pointerDown(wrap(), { clientX: 800, clientY: 100, pointerId: 2 });
        fireEvent.pointerDown(wrap(), { clientX: 700, clientY: 400, pointerId: 3 });
        fireEvent.click(screen.getByRole("button", { name: "Fertig" }));
        const [loop] = scenes()[0].loops;
        expect(loop).toMatchObject({ obj: "mark:m1", from: 2, closed: true, path: [[0.2, 0.5], [0.8, 0.2], [0.7, 0.8]] });
        expect(screen.getByRole("button", { name: "Totenkopf läuft einen Rundweg" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Ändern: Totenkopf läuft einen Rundweg" }));
        fireEvent.click(screen.getByRole("switch", { name: "Spur zeigen" }));
        expect(scenes()[0].loops[0].trail).toBe(true);
    });

    it("lengthens a frame, previews, links a tactic step and deletes the scene after asking", async () => {
        const step = { id: "st1", action: "kite", participants: ["slot:tank:2"], sentence: "kitet die Flamme", targets: [], timing: { kind: "" as const, from: null, to: null, text: "" } };
        setup({ steps: [step] });
        sceneWithFrame();
        fireEvent.click(screen.getByRole("button", { name: "Dauer des Takts erhöhen" }));
        expect(scenes()[0].length).toBe(4.5);
        fireEvent.click(screen.getByRole("button", { name: /^Vorschau$/ }));
        expect(screen.getByRole("group", { name: "Animation abspielen" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Vorschau beenden/ }));
        fireEvent.change(screen.getByRole("combobox", { name: /Gehört zum Taktik-Schritt/ }), { target: { value: "st1" } });
        expect(scenes()[0].stepId).toBe("st1");
        fireEvent.click(screen.getByRole("radio", { name: "Aufgaben" }));
        expect(screen.getByLabelText("Hat eine Animation")).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", { name: "Animation" }));
        fireEvent.click(screen.getByRole("button", { name: /Animation löschen/ }));
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Löschen" }));
        await screen.findByText("Noch keine Animation");
        expect(scenes()).toEqual([]);
    });
});
