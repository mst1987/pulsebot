// "Die Tankreihenfolge im Raidplan sollte nachfragen, wenn ich den Standard anpasse, ob das auf die anderen Bosse auch
// angepasst werden soll": a new tank order in the Standard asks on leaving it (or saving on it) whether the bosses follow.
// Rendered in a small parent that keeps the draft like RaidplanTab does (useDraftHistory, the Besetzung filled by ensureBesetzung).
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Besetzung, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { ConfirmProvider } from "../../ui/Modal";
import { boardOf, ensureBesetzung } from "../../../lib/raidplan";
import { DEFAULTS_KEY } from "../../../lib/raidplan/inherit";
import { assignOrSwap } from "../../../lib/raidplan/rosterAssign";
import { roleOrder } from "../../../lib/raidplan/tankOrder";
import { useDraftHistory } from "./useDraftHistory";
import { useTankOrderFollow } from "./useTankOrderFollow";

const BES: Besetzung = { size: 10, counts: { tank: 2, healer: 2, dps: 6, melee: 0, ranged: 0 }, groups: 2, split: false };
const player = (userId: string, character: string, role: string): RaidplanPlayer => ({
    userId, character, classId: "Warrior", className: "Warrior", classColor: "", spec: "", specLabel: "", role, iconUrl: "", group: 1,
});
const ROSTER = [player("t1", "Bollwerk", "tank"), player("t2", "Eisenhaut", "tank"), player("h1", "Lichtblick", "healer")];
const SECTIONS = [{ key: "bt/supremus", name: "Supremus" }, { key: "bt/akama", name: "Shade of Akama" }, { key: "bt/trash", name: "Trash" }];
const fill = (b: RaidplanBoard) => ensureBesetzung(b, BES, ROSTER);
/** Tank 1 <-> Tank 2, as "Besetzung zuweisen" does it */
const swapTanks = (b: RaidplanBoard) => { const f = fill(b); return assignOrSwap(f, f.slots.find((s) => s.kind === "tank" && s.n === 1)!.id, "t2"); };

type Bosses = Record<string, Partial<RaidplanBoard>>;
let api: {
    draft: Bosses;
    select: (k: string) => void;
    swapStandard: () => void;
    save: () => Promise<Bosses | null>;
    undo: () => void;
    saved: () => void;
} | null = null;

function Harness({ initial = {}, canWrite = true }: { initial?: Bosses; canWrite?: boolean }) {
    const h = useDraftHistory();
    const [selected, setSelected] = useState(DEFAULTS_KEY);
    const [version, setVersion] = useState(1);
    const [ready, setReady] = useState(false);
    if (!ready) { h.reset(initial); setReady(true); }
    const follow = useTankOrderFollow({ draft: h.draft, selected, version, sections: SECTIONS, fill, editAll: h.editAll, roster: ROSTER, canWrite });
    api = {
        draft: h.draft,
        select: (k) => { follow.leaving(k); setSelected(k); },
        swapStandard: () => h.edit(DEFAULTS_KEY, swapTanks),
        save: () => follow.beforeSave(),
        undo: h.undo,
        saved: () => setVersion((v) => v + 1),
    };
    return null;
}

const setup = (props: { initial?: Bosses; canWrite?: boolean } = {}) => render(<ConfirmProvider><Harness {...props} /></ConfirmProvider>);
const tanksOf = (k: string) => roleOrder(fill(boardOf(api!.draft, k)));
const dialog = () => screen.queryByRole("dialog");

beforeEach(() => { api = null; });

describe("the Standard's tank order for the other bosses", () => {
    it("asks on leaving the Standard and, on yes, gives every boss and trash the Standard's order in one undo step", async () => {
        setup();
        act(() => api!.swapStandard());
        expect(tanksOf(DEFAULTS_KEY)).toEqual(["t2", "t1"]);
        expect(dialog()).toBeNull(); // not while still working in the Standard
        act(() => api!.select("bt/supremus"));
        expect(await screen.findByText("Tank-Reihenfolge auch für die anderen Bosse?")).toBeInTheDocument();
        expect(screen.getByText(/1\. Eisenhaut, 2\. Bollwerk/)).toHaveTextContent("Bei 3 Abschnitten ist die Reihenfolge noch anders (Supremus, Shade of Akama, Trash)");
        fireEvent.click(screen.getByRole("button", { name: "Für alle übernehmen" }));
        await act(async () => {});
        for (const s of SECTIONS) expect(tanksOf(s.key)).toEqual(["t2", "t1"]);
        act(() => api!.undo());
        for (const s of SECTIONS) expect(tanksOf(s.key)).toEqual(["t1", "t2"]);
        expect(tanksOf(DEFAULTS_KEY)).toEqual(["t2", "t1"]);
    });

    it("leaves the bosses as they are on 'Nur im Standard' and does not ask again for the same change", async () => {
        setup();
        act(() => api!.swapStandard());
        act(() => api!.select("bt/supremus"));
        fireEvent.click(await screen.findByRole("button", { name: "Nur im Standard" }));
        await act(async () => {});
        expect(tanksOf("bt/supremus")).toEqual(["t1", "t2"]);
        act(() => api!.select(DEFAULTS_KEY));
        act(() => api!.select("bt/akama"));
        await act(async () => {});
        expect(dialog()).toBeNull();
    });

    it("does not ask when the order did not change, or when every section already has it", async () => {
        const first = setup();
        act(() => api!.select("bt/supremus"));
        await act(async () => {});
        expect(dialog()).toBeNull();
        first.unmount();

        // every boss already in the new order: nothing to follow
        setup({ initial: Object.fromEntries(SECTIONS.map((s) => [s.key, swapTanks(boardOf({}, s.key))])) });
        act(() => api!.swapStandard());
        act(() => api!.select("bt/supremus"));
        await act(async () => {});
        expect(dialog()).toBeNull();
    });

    it("on saving in the Standard asks first and hands back the plan with the order followed", async () => {
        setup();
        act(() => api!.swapStandard());
        let result: Bosses | null = null;
        act(() => { void api!.save().then((r) => { result = r; }); });
        fireEvent.click(await screen.findByRole("button", { name: "Für alle übernehmen" }));
        await act(async () => {});
        expect(result).not.toBeNull();
        expect(roleOrder(boardOf(result!, "bt/akama"))).toEqual(["t2", "t1"]);
        expect(roleOrder(boardOf(result!, DEFAULTS_KEY))).toEqual(["t2", "t1"]);
    });

    it("compares against the saved order after a save, and never asks without write access", async () => {
        const first = setup();
        act(() => api!.swapStandard());
        act(() => api!.saved()); // saved as it is: the new order is the starting point now
        act(() => api!.select("bt/supremus"));
        await act(async () => {});
        expect(dialog()).toBeNull();
        first.unmount();

        setup({ canWrite: false });
        act(() => api!.swapStandard());
        await expect(api!.save()).resolves.toBeNull();
        expect(dialog()).toBeNull();
    });
});
