// The read view /p/<token> plays a section's animations (docs/raidplan/animation.md): a button opens the player, the caption shows
// the frame that is on, the frame buttons and the time line move the objects, closing goes back to the plan as it is.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RaidplanIcon, RaidplanPublic, RaidplanPublicBoss, RaidplanScene } from "../../api";
import PlanPublicPage from "./PlanPublicPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRaidplanPublic: vi.fn(),
}));
class NoResize { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoResize);

const icon = (id: string, x: number, y: number): RaidplanIcon => ({ id, iconKey: "bosspos", label: "", showLabel: false, x, y, size: 48, rotation: 0, mobId: "", autoFace: false, opacity: 1, lock: false, hidden: false });
const change = (obj: string, over: object) => ({ obj, delay: 0, dur: 1, ease: "linear" as const, ...over });
const rotation: RaidplanScene = {
    id: "s1", title: "Bloodboil-Rotation", loop: false, length: 6, stepId: "",
    frames: [
        { id: "f0", at: 0, caption: "Ausgangsstellung", changes: [] },
        { id: "f1", at: 2, caption: "Gruppe 1 hat Bloodboil", changes: [change("icon:g1", { badge: "spell_shadow_bloodboil", dur: 0 })] },
        { id: "f2", at: 3, caption: "Tauschen", changes: [change("icon:g1", { x: 0.2, y: 0.2 }), change("icon:g2", { x: 0.2, y: 0.8 })] },
    ],
    loops: [],
};
function section(extra: Partial<RaidplanPublicBoss> = {}): RaidplanPublicBoss {
    return {
        key: "bt/gurtogg", name: "Gurtogg", instanceName: "Black Temple", iconUrl: "", mapUrl: "", trash: false, general: false,
        tokens: [], slots: [], marks: [], icons: [icon("g1", 0.2, 0.8), icon("g2", 0.2, 0.2)], zones: [], lines: [], texts: [], targets: [], assignments: [],
        notes: "", profileName: "", mapOpacity: 1, objectScale: 1, scenes: [rotation, { ...rotation, id: "s2", title: "Zweite" }], ...extra,
    };
}
function plan(boss: RaidplanPublicBoss): RaidplanPublic {
    return { event: { title: "BT", startTime: 0 }, bosses: [boss], roster: [], me: "", meIds: [], catalog: { mobs: [], spells: [] }, loggedIn: false };
}
async function open(boss = section()) {
    window.history.replaceState(null, "", "/p/abc#boss=bt/gurtogg");
    vi.mocked(api.getRaidplanPublic).mockResolvedValue({ data: plan(boss), etag: "" });
    render(<PlanPublicPage token="abc" />);
    await screen.findByRole("heading", { level: 1 });
}
const y = (id: string) => (document.querySelector(`[data-obj="icon:${id}"]`) as HTMLElement).style.getPropertyValue("--rp-y");

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getRaidplanPublic).mockReset();
});

describe("animations in the sheet", () => {
    it("opens the player, steps through the frames and moves the objects; closing shows the plan again", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Animationen \(2\)/ }));
        await userEvent.click(screen.getByRole("button", { name: "Anhalten" }));
        expect(screen.getByText("Takt 1 von 3")).toBeInTheDocument();
        expect(screen.getByText("Ausgangsstellung")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Bloodboil-Rotation" })).toHaveAttribute("aria-selected", "true");

        await userEvent.click(screen.getByRole("button", { name: "Nächster Takt" }));
        expect(screen.getByText("Gruppe 1 hat Bloodboil", { selector: "strong" })).toBeInTheDocument();
        expect(document.querySelector(".rp-fx-badge")).not.toBeNull();
        expect(y("g1")).toBe("80%");

        // half way through the swap, then at its end
        fireEvent.change(screen.getByRole("slider", { name: "Zeit in der Animation" }), { target: { value: "3.5" } });
        expect(y("g1")).toBe("50%");
        fireEvent.change(screen.getByRole("slider", { name: "Zeit in der Animation" }), { target: { value: "6" } });
        expect(y("g1")).toBe("20%");
        expect(y("g2")).toBe("80%");
        expect(screen.getByText("Takt 3 von 3")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Animation schließen/ }));
        expect(y("g1")).toBe("80%");
        expect(document.querySelector(".rp-fx-badge")).toBeNull();
        expect(screen.getByRole("button", { name: /Animationen \(2\)/ })).toBeInTheDocument();
    });

    it("switches the scene, the speed and the loop", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Animationen/ }));
        await userEvent.click(screen.getByRole("tab", { name: "Zweite" }));
        expect(screen.getByRole("tab", { name: "Zweite" })).toHaveAttribute("aria-selected", "true");
        await userEvent.click(screen.getByRole("button", { name: "Tempo 1-fach" }));
        expect(screen.getByRole("button", { name: "Tempo 2-fach" })).toBeInTheDocument();
        const loop = screen.getByRole("button", { name: "Wiederholen" });
        expect(loop).toHaveAttribute("aria-pressed", "false");
        await userEvent.click(loop);
        expect(loop).toHaveAttribute("aria-pressed", "true");
    });

    it("offers nothing without a playable scene or without the map", async () => {
        await open(section({ scenes: [{ ...rotation, frames: rotation.frames.slice(0, 1) }] }));
        expect(screen.queryByRole("button", { name: /Animation/ })).toBeNull();
    });
});
