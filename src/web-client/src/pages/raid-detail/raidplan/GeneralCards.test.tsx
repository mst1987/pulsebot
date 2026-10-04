// The "Allgemein" section's cards (#536): soulstone, blessings, totems, curses, debuffs and the warrior's shouts are there even when empty,
// a debuff row shows its spell, and "Aufgabe hinzufügen" (was "Karte hinzufügen") offers the rest (auras, battle res, fear ward, buffs).
import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Besetzung, RaidplanAssignment, RaidplanBoard, RaidplanBoss, RaidplanPlayer } from "../../../api";
import { JobsProvider } from "../../../components/Jobs";
import { ConfirmProvider } from "../../../components/ui/Modal";
import { boardOf, emptyBoard, ensureBesetzung } from "../../../lib/raidplan";
import BoardWorkspace from "./BoardWorkspace";
import { useDraftHistory } from "./useDraftHistory";

const GENERAL: RaidplanBoss = { key: "general", instanceId: "", instanceName: "", name: "Allgemein", iconUrl: "", mapUrl: "", mapSource: "", ownMap: false, instanceMap: false, general: true } as RaidplanBoss;
const BES: Besetzung = { size: 10, counts: { tank: 2, healer: 3, dps: 5, melee: 0, ranged: 0 }, groups: 2, split: false };
const player = (userId: string, character: string, classId: string, role: string, group = 1): RaidplanPlayer => ({
    userId, character, classId, className: classId, classColor: "", spec: "", specLabel: "", role, iconUrl: "", group,
});
const ROSTER = [player("t1", "Bollwerk", "Warrior", "tank"), player("p1", "Lichtblick", "Paladin", "healer"), player("s1", "Wellenruf", "Shaman", "melee", 2)];
const SUNDER: RaidplanAssignment = {
    id: "d1", type: "debuff", title: "", spell: { id: "d:sunder-armor", name: "Sunder Armor", icon: "ability_warrior_sunder" }, assignees: ["user:t1"], targets: [],
    note: "", suggested: false, preferredClasses: [], allowOthers: false,
} as RaidplanAssignment;

function Harness({ initial }: { initial: Record<string, RaidplanBoard> }) {
    const h = useDraftHistory();
    useEffect(() => { h.reset(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const board = ensureBesetzung(boardOf(h.draft, GENERAL.key), BES, ROSTER);
    return (
        <BoardWorkspace
            mode="event" eventId="e1" besetzung={BES} catalog={null} boss={GENERAL} allBosses={[GENERAL]} board={board}
            edit={(fn, coalesce) => h.edit(GENERAL.key, (b) => fn(ensureBesetzung(b, BES, ROSTER)), coalesce)} roster={ROSTER} canWrite
            limits={{ targetsPerBoss: 10, title: 60, notes: 500 }} profileName="" onPickProfile={() => undefined}
            history={{ undo: h.undo, redo: h.redo, canUndo: h.canUndo, canRedo: h.canRedo }}
            bossNav={null} mapRows={[]} onMapsChanged={() => undefined}
        />
    );
}

function setup(assignments: RaidplanAssignment[] = []) {
    return render(
        <JobsProvider>
            <ConfirmProvider>
                <Harness initial={{ [GENERAL.key]: { ...emptyBoard(), assignments } }} />
            </ConfirmProvider>
        </JobsProvider>,
    );
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("the Allgemein section (#536)", () => {
    it("shows the default cards even when empty, in the fixed order", () => {
        setup();
        for (const name of ["Seelenstein", "Segen", "Totems", "Fluch", "Debuffs", "Donnerknall", "Demoralisierender Ruf"]) expect(screen.getByRole("region", { name })).toBeTruthy();
        expect(screen.queryByRole("region", { name: "Auren" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Battle-Rez" })).toBeNull();
    });
    it("a debuff row shows its spell and its raider", () => {
        setup([SUNDER]);
        const card = screen.getByRole("region", { name: "Debuffs" });
        expect(within(card).getAllByText(/Sunder Armor/).length).toBeGreaterThan(0);
        expect(within(card).getAllByText(/Bollwerk/).length).toBeGreaterThan(0);
    });
    it("offers the other types of the section as cards to add", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: /Aufgabe hinzufügen/ }));
        for (const name of ["Auren", "Battle-Rez", "Furchtschutz", "Buff"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    });
});
