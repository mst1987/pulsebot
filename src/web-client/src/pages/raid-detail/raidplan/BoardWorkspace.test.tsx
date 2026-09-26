// The raid plan's working area (BoardWorkspace): selecting, moving, deleting,
// undo / redo and what reaches the parent's save. Rendered in a small parent
// that keeps the draft like the real ones do (useDraftHistory), so an edit, its
// undo step and the board that would be saved are the real thing.
import { useEffect, useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanBoss, RaidplanZone } from "../../../api";
import { JobsProvider } from "../../../components/Jobs";
import { ConfirmProvider } from "../../../components/ui/Modal";
import { boardOf, emptyBoard } from "../../../lib/raidplan";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";

const BOSS: RaidplanBoss = {
    key: "b1", instanceId: "ssc", instanceName: "SSC", name: "Hydross", iconUrl: "", mapUrl: "",
    mapSource: "", ownMap: false, instanceMap: false,
};
const BES: Besetzung = { size: 25, counts: { tank: 3, healer: 6, dps: 16, melee: 8, ranged: 8 }, groups: 5, split: false };

const zone = (id: string, x: number, y: number): RaidplanZone => ({ id, shape: "rect", type: "neutral", label: "", color: "", x, y, w: 0.1, h: 0.1 });

function start(over: Partial<RaidplanBoard> = {}): RaidplanBoard {
    return { ...emptyBoard(), zones: [zone("z1", 0.1, 0.1), zone("z2", 0.5, 0.5)], ...over };
}

/** A parent like the raid plan tab: the draft with its history, and a "Speichern" that hands over the board. */
function Harness({ initial, onSave, canWrite = true }: { initial: RaidplanBoard; onSave: (b: RaidplanBoard) => void; canWrite?: boolean }) {
    const h = useDraftHistory();
    const ready = useRef(false);
    useEffect(() => { h.reset({ b1: initial }); ready.current = true; }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const board = boardOf(h.draft, "b1");
    return (
        <BoardWorkspace
            mode="template" eventId="" besetzung={BES} catalog={null} boss={BOSS} allBosses={[BOSS]} board={board}
            edit={(fn, coalesce) => h.edit("b1", fn, coalesce)} roster={[]} canWrite={canWrite}
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={null} mapRows={[]} onMapsChanged={() => undefined}
            actions={<button type="button" onClick={() => onSave(board)}>Speichern</button>}
        />
    );
}

function setup(over: Partial<RaidplanBoard> = {}, canWrite = true) {
    const saved: RaidplanBoard[] = [];
    const view = render(
        <JobsProvider>
            <ConfirmProvider>
                <Harness initial={start(over)} onSave={(b) => saved.push(b)} canWrite={canWrite} />
            </ConfirmProvider>
        </JobsProvider>,
    );
    const obj = (key: string) => view.container.querySelector<HTMLElement>(`[data-obj="${key}"]`);
    /** What "Speichern" would hand over now. */
    const save = () => { fireEvent.click(screen.getByRole("button", { name: "Speichern" })); return saved[saved.length - 1]; };
    return { ...view, obj, save };
}

const down = (el: Element, init: Record<string, unknown> = {}) => fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 60, ...init });
const up = (x = 100, y = 60) => fireEvent.pointerUp(window, { clientX: x, clientY: y });
const winKey = (key: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key, ...init });

/** jsdom has no PointerEvent: a MouseEvent that carries the pointer fields the workspace reads. */
class FakePointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
    }
}

beforeEach(() => {
    // jsdom lays nothing out: the board is 1000 x 625 px at the top left, and nothing is under the pointer
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("PointerEvent", FakePointerEvent);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    document.elementFromPoint = () => null;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("BoardWorkspace: selection", () => {
    it("selects an object on pointer down and lets it go with Escape", () => {
        const { obj } = setup();
        down(obj("zone:z1")!);
        up();
        expect(obj("zone:z1")).toHaveClass("is-selected");
        expect(obj("zone:z2")).not.toHaveClass("is-selected");
        winKey("Escape");
        expect(obj("zone:z1")).not.toHaveClass("is-selected");
    });

    it("adds a second object with Ctrl and takes it out again", () => {
        const { obj } = setup();
        down(obj("zone:z1")!);
        up();
        down(obj("zone:z2")!, { ctrlKey: true });
        expect(obj("zone:z1")).toHaveClass("is-multi");
        expect(obj("zone:z2")).toHaveClass("is-multi");
        down(obj("zone:z2")!, { ctrlKey: true });
        expect(obj("zone:z2")).not.toHaveClass("is-multi");
        expect(obj("zone:z1")).toHaveClass("is-selected");
    });

    it("selects everything with Ctrl+A", () => {
        const { obj } = setup();
        winKey("a", { ctrlKey: true });
        expect(obj("zone:z1")).toHaveClass("is-multi");
        expect(obj("zone:z2")).toHaveClass("is-multi");
    });

    it("selects what a rubber band on empty ground touches", () => {
        const { container, obj } = setup();
        const wrap = container.querySelector(".rp-board-wrap")!;
        down(wrap, { clientX: 10, clientY: 10 });
        fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
        up(400, 300);
        // z1 (100..200 x 62..125 px) is inside the band, z2 (from 500 x 312) is not: one object is a plain selection
        expect(obj("zone:z1")).toHaveClass("is-selected");
        expect(obj("zone:z2")).not.toHaveClass("is-selected");
        down(wrap, { clientX: 10, clientY: 10 });
        fireEvent.pointerMove(window, { clientX: 990, clientY: 620 });
        up(990, 620);
        expect(obj("zone:z1")).toHaveClass("is-multi");
        expect(obj("zone:z2")).toHaveClass("is-multi");
    });

    it("selects nothing when the plan is read only", () => {
        const { obj } = setup({}, false);
        down(obj("zone:z1")!);
        up();
        expect(obj("zone:z1")).not.toHaveClass("is-selected");
    });
});

describe("BoardWorkspace: editing and undo / redo", () => {
    it("nudges the selected object with the arrow keys, all presses one undo step", () => {
        const { obj, save } = setup();
        down(obj("zone:z1")!);
        up();
        fireEvent.keyDown(obj("zone:z1")!, { key: "ArrowRight" });
        fireEvent.keyDown(obj("zone:z1")!, { key: "ArrowRight", shiftKey: true });
        expect(save().zones[0].x).toBeCloseTo(0.16);
        fireEvent.click(screen.getByRole("button", { name: /Rückgängig/ }));
        expect(save().zones[0].x).toBeCloseTo(0.1);
        winKey("y", { ctrlKey: true });
        expect(save().zones[0].x).toBeCloseTo(0.16);
    });

    it("moves an object by dragging it, and one undo puts it back", () => {
        const { obj, save } = setup();
        down(obj("zone:z1")!, { clientX: 100, clientY: 60 });
        fireEvent.pointerMove(window, { clientX: 150, clientY: 60 });
        fireEvent.pointerMove(window, { clientX: 200, clientY: 60 });
        up(200, 60);
        expect(save().zones[0].x).toBeCloseTo(0.2);
        expect(save().zones[0].y).toBeCloseTo(0.1);
        winKey("z", { ctrlKey: true });
        expect(save().zones[0].x).toBeCloseTo(0.1);
    });

    it("moves the whole selection together", () => {
        const { save } = setup();
        winKey("a", { ctrlKey: true });
        winKey("ArrowDown");
        const b = save();
        expect(b.zones.map((z) => z.y)).toEqual([expect.closeTo(0.11), expect.closeTo(0.51)]);
    });

    it("deletes the selection with Delete and brings it back with undo / redo", () => {
        const { obj, save } = setup();
        winKey("a", { ctrlKey: true });
        fireEvent.keyDown(obj("zone:z1")!, { key: "Delete" });
        expect(save().zones).toHaveLength(0);
        expect(obj("zone:z1")).toBeNull();
        winKey("z", { ctrlKey: true });
        expect(save().zones.map((z) => z.id)).toEqual(["z1", "z2"]);
        winKey("z", { ctrlKey: true, shiftKey: true });
        expect(save().zones).toHaveLength(0);
    });

    it("duplicates, copies and pastes a selection", () => {
        const { obj, save } = setup();
        down(obj("zone:z1")!);
        up();
        winKey("d", { ctrlKey: true });
        expect(save().zones).toHaveLength(3);
        winKey("c", { ctrlKey: true });
        winKey("v", { ctrlKey: true });
        expect(save().zones).toHaveLength(4);
    });

    it("puts a quick insert on the board as one undo step", () => {
        const { save } = setup({ zones: [] });
        fireEvent.click(screen.getByRole("button", { name: "Pfeil" }));
        const b = save();
        expect(b.lines).toHaveLength(1);
        expect(b.lines[0].kind).toBe("arrow");
        fireEvent.click(screen.getByRole("button", { name: /Rückgängig/ }));
        expect(save().lines).toHaveLength(0);
    });

    it("keeps undo and redo off until there is something to take back", () => {
        setup();
        expect(screen.getByRole("button", { name: /Rückgängig/ })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Wiederholen/ })).toBeDisabled();
    });
});

describe("BoardWorkspace: the board's own menu", () => {
    it("opens on a right click and deletes the object from there", async () => {
        const { obj, save } = setup();
        fireEvent.contextMenu(obj("zone:z2")!, { clientX: 500, clientY: 300 });
        expect(obj("zone:z2")).toHaveClass("is-selected");
        await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "Löschen" })); });
        expect(save().zones.map((z) => z.id)).toEqual(["z1"]);
    });

    it("acts on the whole selection when one of several selected objects is right clicked", async () => {
        const { obj, save } = setup();
        winKey("a", { ctrlKey: true });
        fireEvent.contextMenu(obj("zone:z1")!, { clientX: 150, clientY: 90 });
        expect(obj("zone:z2")).toHaveClass("is-multi");
        const items = await screen.findAllByRole("menuitem");
        expect(items.length).toBeGreaterThan(10);
        await act(async () => { fireEvent.click(items[items.length - 1]); });
        expect(save().zones).toHaveLength(0);
    });
});
