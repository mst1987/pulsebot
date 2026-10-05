// "Alle Aufgaben" of the read view's stage: its head carries "Karte daneben" (the map narrower beside the panel, or the panel over it)
// only when the page offers it, and the close button only over a map.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanPublicBoss } from "../../../../api";
import TasksPanel from "./TasksPanel";

const BOSS: RaidplanPublicBoss = {
    key: "bt/council", name: "The Illidari Council", instanceName: "Black Temple", iconUrl: "", mapUrl: "", trash: false, general: false,
    tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], notes: "", profileName: "", mapOpacity: 1, objectScale: 1,
};
const CTX = { slots: [], players: new Map(), catalog: { mobs: [], spells: [] }, roles: {}, icons: [] } as never;

function panel(extra: Partial<Parameters<typeof TasksPanel>[0]> = {}) {
    return render(<TasksPanel boss={BOSS} title="The Illidari Council" ctx={CTX} meIds={[]} names={[]} loggedIn={false} loginHref="/auth/login" focusGroup={0} onFocusGroup={() => undefined} {...extra} />);
}

describe("TasksPanel", () => {
    it("switches 'Karte daneben' when the page offers it", async () => {
        const toggle = vi.fn();
        panel({ onClose: () => undefined, push: { on: true, toggle } });
        const sw = screen.getByRole("switch", { name: "Karte daneben" });
        expect(sw).toBeChecked();
        await userEvent.click(sw);
        expect(toggle).toHaveBeenCalledTimes(1);
    });

    it("has no such switch where the window has no room for both, nor in the page's flow", () => {
        panel({ onClose: () => undefined, push: null });
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
    });
});
