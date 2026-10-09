// The Standard of an EVENT plan (#524): the heal card of the user's screenshot entered once under "Standard", inherited by every boss
// (dimmed, "Standard"), a change of the Standard reaching every boss that did not deviate, and the pencil making a row the boss's own.
// Rendered in a small parent that keeps the plan's draft like RaidplanTab does (useDraftHistory, `defaultRows` from the Standard's board).
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import { JobsProvider } from "../../shell/Jobs";
import { ConfirmProvider } from "../../ui/Modal";
import { boardOf, emptyBoard, ensureBesetzung } from "../../../lib/raidplan";
import { DEFAULTS_KEY } from "../../../lib/raidplan/inherit";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";

const section = (key: string, name: string, extra: Partial<RaidplanBoss> = {}): RaidplanBoss => ({
    key, instanceId: "bt", instanceName: "Black Temple", name, iconUrl: "", mapUrl: "", mapSource: "", ownMap: false, instanceMap: false, ...extra,
});
const STANDARD = section(DEFAULTS_KEY, "Standard", { defaults: true, instanceId: "" });
const SUPREMUS = section("bt/supremus", "Supremus");
const AKAMA = section("bt/shade-of-akama", "Shade of Akama");
const BES: Besetzung = { size: 10, counts: { tank: 2, healer: 3, dps: 5, melee: 0, ranged: 0 }, groups: 2, split: false };

const player = (userId: string, character: string, classId: string, role: string, group = 1): RaidplanPlayer => ({
    userId, character, classId, className: classId, classColor: "", spec: "", specLabel: "", role, iconUrl: "", group,
});
const ROSTER = [
    player("t1", "Bollwerk", "Warrior", "tank"), player("t2", "Eisenhaut", "Paladin", "tank"),
    player("h1", "Lichtblick", "Paladin", "healer"), player("h2", "Wellenruf", "Shaman", "healer"), player("h3", "Sanftmut", "Priest", "healer", 2),
];
const heal = (id: string, assignees: string[], targets: RaidplanAssignment["targets"]): RaidplanAssignment => ({
    id, type: "heal", title: "", spell: null, assignees, targets, note: "", suggested: false, preferredClasses: [], allowOthers: false,
}) as RaidplanAssignment;
// the heal card of the screenshot: class references on tanks and groups
const HEAL_CARD = [
    heal("d1", ["class:Paladin:1"], [{ kind: "slot", ref: "tank:1" }]),
    heal("d2", ["class:Shaman:1"], [{ kind: "slot", ref: "tank:2" }, { kind: "slot", ref: "tank:1" }]),
    heal("d3", ["user:h3"], [{ kind: "group", ref: "1" }, { kind: "group", ref: "2" }]),
];

let api: { draft: Record<string, RaidplanBoard>; edit: (key: string, fn: (b: RaidplanBoard) => RaidplanBoard) => void; select: (key: string) => void } | null = null;

function Harness({ initial, start }: { initial: Record<string, RaidplanBoard>; start: string }) {
    const h = useDraftHistory();
    const [selected, setSelected] = useState(start);
    useEffect(() => { h.reset(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const boss = [STANDARD, SUPREMUS, AKAMA].find((b) => b.key === selected) || SUPREMUS;
    const board = ensureBesetzung(boardOf(h.draft, selected), BES, ROSTER);
    api = { draft: h.draft as Record<string, RaidplanBoard>, edit: (key, fn) => h.edit(key, fn), select: setSelected };
    return (
        <BoardWorkspace
            mode="event" eventId="e1" besetzung={BES} catalog={null} boss={boss} allBosses={[STANDARD, SUPREMUS, AKAMA]} board={board}
            edit={(fn, coalesce) => h.edit(selected, (b) => fn(ensureBesetzung(b, BES, ROSTER)), coalesce)} roster={ROSTER} canWrite
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={null} mapRows={[]} onMapsChanged={() => undefined}
            defaultRows={boardOf(h.draft, DEFAULTS_KEY).assignments}
        />
    );
}

function setup(start: string, initial: Record<string, RaidplanBoard>) {
    return render(
        <JobsProvider>
            <ConfirmProvider>
                <Harness initial={initial} start={start} />
            </ConfirmProvider>
        </JobsProvider>,
    );
}

const plan = (): Record<string, RaidplanBoard> => ({ [DEFAULTS_KEY]: { ...emptyBoard(), assignments: HEAL_CARD } });
const healCard = () => screen.getByRole("region", { name: "Heilen" });
const lines = () => within(healCard()).getAllByRole("listitem");

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    api = null;
});

describe("the Standard of an event plan (#524)", () => {
    it("the Standard section shows the heal card once, with the explanation, and no map", () => {
        const { container } = setup(DEFAULTS_KEY, plan());
        expect(lines()).toHaveLength(3);
        expect(container.querySelector(".rp-defaults-explain")).not.toBeNull();
        expect(container.querySelector(".rp-board-wrap")).toBeNull();
        // the Standard's own rows are its own: edited in place, no lock
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(0);
        // resolved against the setup: Paladin 1 -> Lichtblick
        expect(healCard().textContent).toContain("Lichtblick");
    });

    it("every boss inherits the rows, dimmed and marked 'Standard'; a healer swapped in the Standard shows in every boss", () => {
        const { container } = setup(SUPREMUS.key, plan());
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(3);
        // no "Standard" label under every row any more (#559): the lock lives in the row's "..." menu
        expect(within(healCard()).queryAllByText("Standard")).toHaveLength(0);
        expect(within(healCard()).getAllByRole("button", { name: /Weitere Aktionen/ })).toHaveLength(3);
        expect(healCard().textContent).toContain("Sanftmut");
        // the Standard's third row goes to another healer: Supremus and Akama both follow
        act(() => { api!.edit(DEFAULTS_KEY, (b) => ({ ...b, assignments: b.assignments.map((a) => (a.id === "d3" ? { ...a, assignees: ["user:h2"] } : a)) })); });
        expect(healCard().textContent).not.toContain("Sanftmut");
        act(() => { api!.select(AKAMA.key); });
        expect(healCard().textContent).not.toContain("Sanftmut");
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(3);
    });

    it("the pencil makes a row the boss's own (a deviation); a later change of the Standard leaves it alone, the other bosses follow", () => {
        const { container } = setup(SUPREMUS.key, plan());
        const pencil = within(healCard()).getAllByRole("button", { name: /Für diesen Boss abweichen/ })[2];
        fireEvent.click(pencil);
        // the row dialog opens on the boss's own copy; close it
        fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
        const sup = api!.draft[SUPREMUS.key];
        expect(sup.inheritOff).toEqual(["d3"]);
        expect(sup.assignments).toEqual([expect.objectContaining({ origin: "d3", assignees: ["user:h3"] })]);
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(2);
        act(() => { api!.edit(DEFAULTS_KEY, (b) => ({ ...b, assignments: b.assignments.map((a) => (a.id === "d3" ? { ...a, assignees: ["user:h2"] } : a)) })); });
        // Supremus keeps Sanftmut (its own row), Akama follows the Standard
        expect(healCard().textContent).toContain("Sanftmut");
        act(() => { api!.select(AKAMA.key); });
        expect(healCard().textContent).not.toContain("Sanftmut");
    });

    it("hides an inherited row for one boss and restores it with the card's 'Standard wiederherstellen'", () => {
        const { container } = setup(SUPREMUS.key, plan());
        fireEvent.click(within(healCard()).getAllByRole("button", { name: /Weitere Aktionen/ })[0]);
        fireEvent.click(screen.getByRole("menuitem", { name: /Für diesen Boss ausblenden/ }));
        expect(api!.draft[SUPREMUS.key].inheritOff).toEqual(["d1"]);
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(2);
        fireEvent.click(within(healCard()).getByRole("button", { name: /Standard wiederherstellen/ }));
        expect(api!.draft[SUPREMUS.key].inheritOff).toEqual([]);
        expect(container.querySelectorAll(".rp-line.is-lock")).toHaveLength(3);
    });
});

describe("the map of a boss follows the rows it inherits (#524: auto tokens and lines)", () => {
    beforeEach(() => {
        // the board is in the view "Karte" (Oct 2026)
        window.localStorage.setItem("eh.raidplan.view", "map");
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(625);
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });
    it("'Tank 1 -> boss of this section' puts the boss and the tank on every boss's map; a heal row on the map draws its line", () => {
        const tank = { ...heal("d0", ["user:t1"], [{ kind: "mob", ref: "b:this", name: "", icon: "" }]), type: "tank" } as RaidplanAssignment;
        const onMap = { ...heal("d4", ["user:h1"], [{ kind: "player", ref: "t1" }]), onMap: true } as RaidplanAssignment;
        const { container } = setup(SUPREMUS.key, { [DEFAULTS_KEY]: { ...emptyBoard(), assignments: [tank, onMap] } });
        // the inherited rows are keyed by the Standard's row id (a moved tank keeps its place in every boss)
        expect(container.querySelector('[data-obj="auto:t:d0:1"]')).not.toBeNull();
        expect(container.querySelector('[data-obj="auto:m:b:bt/supremus#1"]')).not.toBeNull();
        const svg = container.querySelector(".rp-links");
        expect(svg).not.toBeNull();
        expect([...svg!.querySelectorAll("line")].map((l) => l.getAttribute("class"))).toContain("rp-link--heal");
    });
});
