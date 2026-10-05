// The raid plan's working area (BoardWorkspace): selecting, moving, deleting,
// undo / redo and what reaches the parent's save. Rendered in a small parent
// that keeps the draft like the real ones do (useDraftHistory), so an edit, its
// undo step and the board that would be saved are the real thing.
import { useEffect, useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanBoss, RaidplanPlayer, RaidplanSlot, RaidplanZone } from "../../../api";
import { JobsProvider } from "../../../components/Jobs";
import { ConfirmProvider } from "../../../components/ui/Modal";
import { boardOf, emptyBoard } from "../../../lib/raidplan";
import { badgeMetrics } from "../../../lib/raidplan/labelScale";
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
function Harness({ initial, onSave, canWrite = true, roster = [] }: { initial: RaidplanBoard; onSave: (b: RaidplanBoard) => void; canWrite?: boolean; roster?: RaidplanPlayer[] }) {
    const h = useDraftHistory();
    const ready = useRef(false);
    useEffect(() => { h.reset({ b1: initial }); ready.current = true; }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const board = boardOf(h.draft, "b1");
    return (
        <BoardWorkspace
            mode={roster.length > 0 ? "event" : "template"} eventId={roster.length > 0 ? "e1" : ""} besetzung={BES} catalog={null} boss={BOSS} allBosses={[BOSS]} board={board}
            edit={(fn, coalesce) => h.edit("b1", fn, coalesce)} roster={roster} canWrite={canWrite}
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={null} mapRows={[]} onMapsChanged={() => undefined}
            actions={<button type="button" onClick={() => onSave(board)}>Speichern</button>}
        />
    );
}

function setup(over: Partial<RaidplanBoard> = {}, canWrite = true, roster: RaidplanPlayer[] = []) {
    const saved: RaidplanBoard[] = [];
    const view = render(
        <JobsProvider>
            <ConfirmProvider>
                <Harness initial={start(over)} onSave={(b) => saved.push(b)} canWrite={canWrite} roster={roster} />
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

/** The two views (Oct 2026): the board is only in "Karte", the assignment cards only in "Aufgaben". */
const toTasks = () => fireEvent.click(screen.getByRole("radio", { name: "Aufgaben" }));
const toMap = () => fireEvent.click(screen.getByRole("radio", { name: "Karte" }));

beforeEach(() => {
    // the board's tests start in the view "Karte" (the editor opens on "Aufgaben" until one is chosen)
    window.localStorage.clear();
    window.localStorage.setItem("eh.raidplan.view", "map");
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
        // the tool row's "Zeichnen ▾" holds arrow, line and text
        fireEvent.click(screen.getByRole("button", { name: "Zeichnen" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Pfeil" }));
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

// #496: after a group marker is split, each of its raiders is dragged on his own (his place is stored relative to the marker)
const player = (userId: string, character: string): RaidplanPlayer => ({
    userId, character, classId: "warrior", className: "Warrior", classColor: "#c79c6e", spec: "Warrior-Arms", specLabel: "Arms", role: "melee", iconUrl: "", group: 1,
});
const ROSTER = [player("u1", "Klinge"), player("u2", "Schild"), player("u3", "Axt")];
const groupSlot = (split: boolean): RaidplanSlot => ({
    id: "g1", kind: "group", n: 1, label: "", x: 0.5, y: 0.5, userId: "", size: 38, hideMembers: false, split, offsets: {}, placed: true,
    opacity: 1, lock: false, hidden: false,
});

describe("BoardWorkspace: a split group", () => {
    it("splits a group marker from its menu, then drags one raider on his own, one undo puts him back", async () => {
        const { obj, save } = setup({ zones: [], slots: [groupSlot(false)] }, true, ROSTER);
        expect(obj("member:g1~u1")).toBeNull();
        fireEvent.contextMenu(obj("slot:g1")!, { clientX: 500, clientY: 312 });
        await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "Aufsplitten" })); });
        expect(save().slots[0].split).toBe(true);
        const member = obj("member:g1~u1")!;
        expect(member).not.toBeNull();
        // every box in jsdom is the board (1000 x 625 at 0 / 0): the member is taken 400 / 252.5 px off its middle, so the pointer at
        // 100 / 60 means the member's middle at 0.5 / 0.5, 100 px to the right and 62.5 px down -> 0.6 / 0.6 on the board
        down(member.querySelector(".rp-token-btn")!, { clientX: 100, clientY: 60 });
        fireEvent.pointerMove(window, { clientX: 150, clientY: 90 });
        fireEvent.pointerMove(window, { clientX: 200, clientY: 122.5 });
        up(200, 122.5);
        const off = save().slots[0].offsets.u1;
        expect(off.dx).toBeCloseTo(0.1);
        expect(off.dy).toBeCloseTo(0.1);
        // only he moved, the marker and the others stay
        expect(save().slots[0]).toMatchObject({ x: 0.5, y: 0.5 });
        expect(save().slots[0].offsets.u2).toBeUndefined();
        expect(obj("member:g1~u1")).toHaveClass("is-selected");
        winKey("z", { ctrlKey: true });
        expect(save().slots[0].offsets.u1).toBeUndefined();
    });

    it("drags a raider of a group that was saved split, twice in a row", () => {
        const { obj, save } = setup({ zones: [], slots: [{ ...groupSlot(true), offsets: { u2: { dx: 0.05, dy: 0, size: 38 } } }] }, true, ROSTER);
        const drag = (dx: number, dy: number) => {
            down(obj("member:g1~u2")!.querySelector(".rp-token-btn")!, { clientX: 100, clientY: 60 });
            fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 60 + dy });
            up(100 + dx, 60 + dy);
        };
        drag(-100, 0);
        expect(save().slots[0].offsets.u2).toMatchObject({ dx: expect.closeTo(0.4 - 0.5), dy: expect.closeTo(0), size: 38 });
        drag(0, 62.5);
        expect(save().slots[0].offsets.u2.dy).toBeCloseTo(0.1);
    });
});

// #498: every task row with named raiders can put them on the map ("Auf Map setzen"), like the tanks of a tank row
const taskRow = (id: string, type: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
    id, type, title: "", spell: null, assignees, targets: [], note: "", suggested: false, preferredClasses: [], allowOthers: false, ...extra,
}) as RaidplanBoard["assignments"][number];

describe("BoardWorkspace: a task row on the map", () => {
    it("puts the raiders of a kick row on the map, drags one, and the row deleted takes them along", () => {
        const { obj, save, container } = setup({ zones: [], assignments: [taskRow("k1", "kick", ["user:u1", "user:u2"])] }, true, ROSTER);
        expect(obj("auto:t:k1:1")).toBeNull();
        toTasks();
        fireEvent.click(screen.getByRole("button", { name: "Auf Map setzen" }));
        expect(save().assignments[0].onMap).toBe(true);
        toMap();
        expect(obj("auto:t:k1:1")).not.toBeNull();
        expect(obj("auto:t:k1:2")).not.toBeNull();
        // the tooltip names the task, never a mob
        expect(obj("auto:t:k1:1")!.querySelector(".rp-token-btn")!.getAttribute("data-tip")).toContain("Unterbrecher");
        expect(container.querySelectorAll(".rp-autotank.is-task")).toHaveLength(2);
        down(obj("auto:t:k1:1")!.querySelector(".rp-token-btn")!, { clientX: 100, clientY: 60 });
        fireEvent.pointerMove(window, { clientX: 150, clientY: 90 });
        up(150, 90);
        expect(save().autoPos["t:k1:1"]).toBeDefined();
        toTasks();
        fireEvent.click(screen.getByRole("button", { name: "Einteilung löschen" }));
        expect(save().assignments).toHaveLength(0);
        toMap();
        expect(obj("auto:t:k1:1")).toBeNull();
        expect(obj("auto:t:k1:2")).toBeNull();
    });

    it("takes the pin off again: the tokens go, the row stays", () => {
        const { obj, save } = setup({ zones: [], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        expect(obj("auto:t:k1:1")).not.toBeNull();
        toTasks();
        fireEvent.click(screen.getByRole("button", { name: "Von der Map nehmen" }));
        expect(save().assignments).toHaveLength(1);
        expect(save().assignments[0].onMap).toBeUndefined();
        toMap();
        expect(obj("auto:t:k1:1")).toBeNull();
    });

    it("a raider who tanks and kicks stands once: at his tank place", () => {
        const { obj } = setup({ zones: [], assignments: [taskRow("t1", "tank", ["user:u1"]), taskRow("k1", "kick", ["user:u1", "user:u2"], { onMap: true })] }, true, ROSTER);
        expect(obj("auto:t:t1:1")).not.toBeNull();
        expect(obj("auto:t:k1:1")).toBeNull();
        expect(obj("auto:t:k1:2")).not.toBeNull();
    });

    it("a member of a group that is not split gets a token of his own with the group badge; the group stays", () => {
        const { obj } = setup({ zones: [], slots: [groupSlot(false)], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        const tok = obj("auto:t:k1:1")!;
        expect(tok).not.toBeNull();
        expect(tok.querySelector(".rp-token-gbadge")!.textContent).toBe("1");
        expect(obj("slot:g1")).not.toBeNull();
    });

    it("the right-click menu of such a token offers its row and taking it off the map, never tanking", async () => {
        const { obj, save } = setup({ zones: [], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        fireEvent.contextMenu(obj("auto:t:k1:1")!, { clientX: 500, clientY: 300 });
        expect(await screen.findByRole("menuitem", { name: /Zeile bearbeiten/ })).toBeTruthy();
        expect(screen.queryByRole("menuitem", { name: /Tankt/ })).toBeNull();
        await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "Von der Map nehmen" })); });
        expect(save().assignments[0].onMap).toBeUndefined();
    });

    it("a row of a whole role group has no pin (nobody to put on the map), a tank row neither", () => {
        setup({ zones: [], assignments: [taskRow("k1", "kick", ["role:melee"]), taskRow("t1", "tank", ["user:u1"])] }, true, ROSTER);
        toTasks();
        expect(screen.getAllByRole("button", { name: /Zeile bearbeiten/ })).toHaveLength(2);
        expect(screen.queryByRole("button", { name: "Auf Map setzen" })).toBeNull();
    });
});

// #507: the lines of the rows (heal -> tank, tank -> mob, kick -> mob) are drawn between the auto tokens and mobs, one class per row type
describe("BoardWorkspace: the lines of the rows", () => {
    const mob = { kind: "mob" as const, ref: "b:hydross", name: "Hydross", icon: "" };
    const rows = [
        taskRow("t1", "tank", ["user:u1"], { targets: [mob] }),
        taskRow("h1", "heal", ["user:u2"], { targets: [{ kind: "player", ref: "u1" }], onMap: true }),
        taskRow("k1", "kick", ["user:u3"], { targets: [mob], onMap: true }),
    ];
    // jsdom has no layout: the board reads its size from clientWidth / clientHeight, the lines need one
    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(625);
    });
    afterEach(() => { vi.restoreAllMocks(); });
    it("draws a heal, a tank and a kick line, each coloured by its type and nothing that hides it", () => {
        const { container } = setup({ zones: [], assignments: rows }, true, ROSTER);
        const svg = container.querySelector(".rp-links")!;
        expect(svg).not.toBeNull();
        expect(svg.getAttribute("style")).toBeNull();
        const lines = [...svg.querySelectorAll("line")];
        expect(lines.map((l) => l.getAttribute("class"))).toEqual(["rp-link--tank", "rp-link--heal", "rp-link--kick"]);
        for (const l of lines) {
            // the colour comes from the class (tokens.css), never a stroke of its own that could be empty or hidden
            expect(l.getAttribute("stroke")).toBeNull();
            expect(l.getAttribute("style")).toBeNull();
            expect(l.getAttribute("x1") === l.getAttribute("x2") && l.getAttribute("y1") === l.getAttribute("y2")).toBe(false);
        }
    });
    it("draws nothing when the lines are switched off, and a board without rows has no line layer", () => {
        const { container } = setup({ zones: [], assignments: rows }, true, ROSTER);
        toTasks();
        fireEvent.click(screen.getByRole("switch", { name: "Verbindungen zeigen" }));
        toMap();
        expect(container.querySelector(".rp-links")).toBeNull();
        const empty = setup({ zones: [] }, true, ROSTER);
        expect(empty.container.querySelector(".rp-links")).toBeNull();
    });
});

// #511: the group badge grows with its icon (lib/raidplan/labelScale.ts badgeMetrics) and sits the same way on every kind of token
describe("BoardWorkspace: the group badge", () => {
    const badgeOf = (tok: HTMLElement) => {
        const badge = tok.querySelector<HTMLElement>(":scope > .rp-token-gbadge");
        expect(badge).not.toBeNull();
        // a child of the token's anchor, never inside the icon's button, and sized only through the variables
        expect(tok.querySelector(".rp-token-btn .rp-token-gbadge")).toBeNull();
        for (const prop of ["width", "height", "min-width", "font-size", "line-height", "left", "top"]) expect(badge!.style.getPropertyValue(prop)).toBe("");
        return badge!;
    };

    it("a member of a split group: the badge variables follow the member's icon", () => {
        const { obj } = setup({ zones: [], slots: [groupSlot(true)] }, true, ROSTER);
        const member = obj("member:g1~u1")!;
        expect(badgeOf(member).textContent).toBe("1");
        const px = parseFloat(member.style.getPropertyValue("--rp-s"));
        expect(px).toBeGreaterThan(0);
        expect(member.style.getPropertyValue("--rp-badge")).toBe(`${badgeMetrics(px).size}px`);
        expect(member.style.getPropertyValue("--rp-bf")).toBe(`${badgeMetrics(px).font}px`);
        expect(member.style.getPropertyValue("--rp-bb")).toBe(`${badgeMetrics(px).border}px`);
    });

    // #528: the group's own switch and size
    it("a group with its badge off: no badge on its members, nor on a task token of its raiders", () => {
        const split = setup({ zones: [], slots: [{ ...groupSlot(true), showBadge: false }] }, true, ROSTER);
        expect(split.obj("member:g1~u1")).not.toBeNull();
        expect(split.container.querySelectorAll(".rp-token-gbadge")).toHaveLength(0);
        split.unmount();
        const chip = setup({ zones: [], slots: [{ ...groupSlot(false), showBadge: false }], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        expect(chip.obj("auto:t:k1:1")).not.toBeNull();
        expect(chip.obj("auto:t:k1:1")!.querySelector(".rp-token-gbadge")).toBeNull();
    });

    it("a group's badge size: the members' variables and a task token's badge follow it", () => {
        const split = setup({ zones: [], slots: [{ ...groupSlot(true), badgeScale: 0.5 }] }, true, ROSTER);
        const member = split.obj("member:g1~u1")!;
        const px = parseFloat(member.style.getPropertyValue("--rp-s"));
        expect(member.style.getPropertyValue("--rp-badge")).toBe(`${badgeMetrics(px, 0.5).size}px`);
        expect(badgeOf(member).textContent).toBe("1");
        split.unmount();
        const { obj } = setup({ zones: [], slots: [{ ...groupSlot(false), badgeScale: 1.5 }], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        const tok = obj("auto:t:k1:1")!;
        const tpx = parseFloat(tok.style.getPropertyValue("--rp-s"));
        const badge = badgeOf(tok);
        expect(badge.style.getPropertyValue("--rp-badge")).toBe(`${badgeMetrics(tpx, 1.5).size}px`);
        expect(badge.style.getPropertyValue("--rp-bf")).toBe(`${badgeMetrics(tpx, 1.5).font}px`);
    });

    it("a task token on the map: the same badge, the same variables", () => {
        const { obj } = setup({ zones: [], slots: [groupSlot(false)], assignments: [taskRow("k1", "kick", ["user:u1"], { onMap: true })] }, true, ROSTER);
        const tok = obj("auto:t:k1:1")!;
        expect(badgeOf(tok).textContent).toBe("1");
        const px = parseFloat(tok.style.getPropertyValue("--rp-s"));
        expect(tok.style.getPropertyValue("--rp-badge")).toBe(`${badgeMetrics(px).size}px`);
    });
});
