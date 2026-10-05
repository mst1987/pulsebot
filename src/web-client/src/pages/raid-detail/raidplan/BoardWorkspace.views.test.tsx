// The working area's two views (Oct 2026): "Aufgaben" (Besetzung as one line, the cards, no drawing tools) and "Karte" (one labelled
// tool row, the board in the full width, the players not placed in a slim column, the properties behind "Eigenschaften") - never
// the board and the cards at once. Standard and Allgemein have no map: "Karte" is there but disabled, with the reason.
import { useEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import { JobsProvider } from "../../../components/Jobs";
import { ConfirmProvider } from "../../../components/ui/Modal";
import { boardOf, emptyBoard } from "../../../lib/raidplan";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";

const BOSS: RaidplanBoss = {
    key: "b1", instanceId: "ssc", instanceName: "SSC", name: "Hydross", iconUrl: "", mapUrl: "",
    mapSource: "", ownMap: false, instanceMap: false,
};
const GENERAL = { ...BOSS, key: "__general", name: "Allgemein", general: true } as RaidplanBoss;
const BES: Besetzung = { size: 25, counts: { tank: 3, healer: 6, dps: 16, melee: 8, ranged: 8 }, groups: 5, split: false };
const player = (userId: string, character: string): RaidplanPlayer => ({
    userId, character, classId: "warrior", className: "Warrior", classColor: "#c79c6e", spec: "Warrior-Arms", specLabel: "Arms", role: "melee", iconUrl: "", group: 1,
});
const ROSTER = [player("u1", "Klinge"), player("u2", "Schild")];
const row = (id: string, type: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
    id, type, title: "", spell: null, assignees, targets: [], note: "", suggested: false, preferredClasses: [], allowOthers: false, ...extra,
}) as RaidplanBoard["assignments"][number];

function Harness({ boss, initial }: { boss: RaidplanBoss; initial: RaidplanBoard }) {
    const h = useDraftHistory();
    useEffect(() => { h.reset({ [boss.key]: initial }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <BoardWorkspace
            mode="event" eventId="e1" besetzung={BES} catalog={null} boss={boss} allBosses={[boss]} board={boardOf(h.draft, boss.key)}
            edit={(fn, coalesce) => h.edit(boss.key, fn, coalesce)} roster={ROSTER} canWrite
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={<span>Abschnitte</span>} mapRows={[]} onMapsChanged={() => undefined}
            besetzungTools={<span className="probe-groups">Gruppen im Plan</span>}
        />
    );
}

function setup(over: Partial<RaidplanBoard> = {}, boss: RaidplanBoss = BOSS) {
    return render(
        <JobsProvider>
            <ConfirmProvider>
                <Harness boss={boss} initial={{ ...emptyBoard(), ...over }} />
            </ConfirmProvider>
        </JobsProvider>,
    );
}

const radio = (name: string) => screen.getByRole("radio", { name });
const board = () => document.querySelector("[data-rp-board]");

beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the view 'Aufgaben'", () => {
    it("is where the editor opens: the Besetzung as one line and the cards, no board and no drawing tools", () => {
        setup();
        expect(radio("Aufgaben")).toHaveAttribute("aria-checked", "true");
        expect(radio("Karte")).toHaveAttribute("aria-checked", "false");
        expect(board()).toBeNull();
        expect(screen.queryByRole("toolbar", { name: "Werkzeuge" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Zeichnen" })).toBeNull();
        expect(document.querySelector(".rp-bes.is-line")).not.toBeNull();
        expect(screen.getByRole("region", { name: "Aufgaben" })).toBeTruthy();
        // undo / redo sit in the cards' head (there is no tool row here)
        expect(screen.getByRole("button", { name: /Rückgängig/ })).toBeDisabled();
    });

    it("opens the Besetzung with 'Ändern', and only then the plan's group setting", () => {
        setup();
        expect(document.querySelector(".probe-groups")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Besetzung: Ändern/ }));
        expect(document.querySelector(".probe-groups")).not.toBeNull();
        expect(document.querySelector(".rp-bes-blocks")).not.toBeNull();
    });

    it("counts the tasks without a player, shows only them on 'Anzeigen' and all again on 'Alle zeigen'", () => {
        setup({ assignments: [row("k1", "kick", ["user:u1"], { targets: [{ kind: "text", ref: "Boss" }] }), row("k2", "kick", [], { targets: [{ kind: "text", ref: "Add" }] })] });
        const panel = screen.getByRole("region", { name: "Aufgaben" });
        expect(within(panel).getByText("1 Aufgabe ohne Spieler")).toBeTruthy();
        // the row without anybody shows the one dashed mark, its card counts it as open
        expect(panel.querySelectorAll(".rp-lc.is-nobody")).toHaveLength(1);
        expect(panel.querySelector(".rp-lc.is-nobody")).toHaveTextContent("Spieler fehlt");
        expect(within(panel).getByRole("region", { name: "Unterbrecher" }).querySelector(".rp-acard-open")).toHaveTextContent("1 offen");
        const kickRows = () => within(panel).getByRole("region", { name: "Unterbrecher" }).querySelectorAll(".rp-line");
        expect(kickRows()).toHaveLength(2);
        fireEvent.click(within(panel).getByRole("button", { name: "Anzeigen" }));
        expect(kickRows()).toHaveLength(1);
        // the other cards (empty or complete) are not shown meanwhile
        expect(within(panel).queryByRole("region", { name: "Heilen" })).toBeNull();
        fireEvent.click(within(panel).getByRole("button", { name: "Alle zeigen" }));
        expect(kickRows()).toHaveLength(2);
    });

    it("names the add button so it is not taken for the map view", () => {
        setup();
        expect(screen.getByRole("button", { name: "Aufgabe hinzufügen …" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Karte hinzufügen/ })).toBeNull();
    });
});

describe("the view 'Karte'", () => {
    it("shows the board and ONE labelled tool row instead of the cards; the choice is remembered", () => {
        const first = setup();
        fireEvent.click(radio("Karte"));
        expect(board()).not.toBeNull();
        expect(screen.queryByRole("region", { name: "Aufgaben" })).toBeNull();
        const tools = screen.getByRole("toolbar", { name: "Werkzeuge" });
        for (const name of ["Zeichnen", "Formen", "Ansicht", "Eigenschaften"]) expect(within(tools).getByRole("button", { name })).toBeTruthy();
        expect(within(tools).getByRole("group", { name: "Zoom" })).toBeTruthy();
        expect(within(tools).getByRole("group", { name: "Größe der Map" })).toBeTruthy();
        expect(within(tools).getByRole("button", { name: /Rückgängig/ })).toBeTruthy();
        expect(window.localStorage.getItem("eh.raidplan.view")).toBe("map");
        first.unmount();
        setup();
        expect(radio("Karte")).toHaveAttribute("aria-checked", "true");
        expect(board()).not.toBeNull();
    });

    it("keeps every tool of the old icon strip: shapes in 'Formen', the switches in 'Ansicht'", () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        setup();
        fireEvent.click(screen.getByRole("button", { name: "Formen" }));
        const shapes = screen.getByRole("menu", { name: "Formen" });
        expect(within(shapes).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Rechteck", "Ellipse", "Melees", "Ranged"]);
        fireEvent.click(within(shapes).getByRole("menuitem", { name: "Ellipse" }));
        expect(screen.queryByRole("menu")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
        const view = screen.getByRole("dialog", { name: "Ansicht" });
        for (const label of [/Elemente zum Ziehen/, /Besetzung über der Karte/, /Auswahlmodus/, /Sheet-Vorschau/, /Karte für diesen Abschnitt/, /Namen zeigen/]) {
            expect(within(view).getByRole("switch", { name: label })).toBeTruthy();
        }
        expect(within(view).getByRole("button", { name: /Besetzung zuweisen/ })).toBeTruthy();
        // the Besetzung band above the map comes with its switch
        expect(document.querySelector(".rp-bes")).toBeNull();
        fireEvent.click(within(view).getByRole("switch", { name: /Besetzung über der Karte/ }));
        expect(document.querySelector(".rp-bes")).not.toBeNull();
    });

    it("opens the menus from the keyboard: the first entry gets the focus, the arrows move, Escape goes back to the button", () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        setup();
        const btn = screen.getByRole("button", { name: "Zeichnen" });
        fireEvent.click(btn);
        const menu = screen.getByRole("menu", { name: "Zeichnen" });
        expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Pfeil" }));
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Linie" }));
        fireEvent.keyDown(menu, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(btn);
    });

    it("puts properties, layers and background behind 'Eigenschaften'", () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        setup();
        expect(screen.queryByRole("tab", { name: "Ebenen" })).toBeNull();
        const props = screen.getByRole("button", { name: "Eigenschaften" });
        expect(props).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(props);
        expect(props).toHaveAttribute("aria-pressed", "true");
        for (const name of ["Eigenschaften", "Ebenen", "Hintergrund"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Eigenschaften schließen" }));
        expect(screen.queryByRole("tab", { name: "Ebenen" })).toBeNull();
    });

    it("folds 'Nicht platziert' to a slim strip that is still the drop target, and remembers it", () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        const first = setup();
        const tray = screen.getByRole("region", { name: "Nicht platziert" });
        expect(tray).toHaveAttribute("data-rp-tray");
        expect(within(tray).getByText("Klinge")).toBeTruthy();
        fireEvent.click(within(tray).getByRole("button", { name: "Liste einklappen" }));
        const slim = screen.getByRole("region", { name: "Nicht platziert" });
        expect(slim).toHaveAttribute("data-rp-tray");
        expect(within(slim).queryByText("Klinge")).toBeNull();
        expect(document.querySelector(".rp-side.is-folded")).not.toBeNull();
        first.unmount();
        setup();
        const again = screen.getByRole("region", { name: "Nicht platziert" });
        fireEvent.click(within(again).getByRole("button", { name: /Nicht platzierte Spieler zeigen/ }));
        expect(within(screen.getByRole("region", { name: "Nicht platziert" })).getByText("Klinge")).toBeTruthy();
    });

    it("opens a row's dialog from the map ('Zeile bearbeiten …') without the cards, and not again after a view switch", async () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 625, width: 1000, height: 625, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        setup({ assignments: [row("k1", "kick", ["user:u1"], { onMap: true })] });
        const token = document.querySelector('[data-obj="auto:t:k1:1"]') as HTMLElement;
        fireEvent.contextMenu(token, { clientX: 500, clientY: 300 });
        await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: /Zeile bearbeiten/ })); });
        const dialog = document.querySelector("dialog.rp-amb") as HTMLDialogElement;
        expect(dialog).not.toBeNull();
        expect(screen.queryByRole("region", { name: "Aufgaben" })).toBeNull();
        fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
        fireEvent.click(radio("Aufgaben"));
        expect(document.querySelector("dialog.rp-amb")).toBeNull();
        vi.restoreAllMocks();
    });
});

describe("Standard and Allgemein have no map", () => {
    it("offer 'Karte' disabled with the reason, and stay on the tasks whatever was chosen", () => {
        window.localStorage.setItem("eh.raidplan.view", "map");
        setup({}, GENERAL);
        const map = radio("Karte");
        expect(map).toHaveAttribute("aria-disabled", "true");
        expect(map.getAttribute("data-tip")).toContain("keine Karte");
        expect(radio("Aufgaben")).toHaveAttribute("aria-checked", "true");
        fireEvent.click(map);
        expect(board()).toBeNull();
        expect(screen.getByRole("region", { name: "Aufgaben" })).toBeTruthy();
        // the stored choice stays for the bosses
        expect(window.localStorage.getItem("eh.raidplan.view")).toBe("map");
    });
});
