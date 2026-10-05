// The stage bar of the sheet (/p/<token>): the open section with its arrows, "Alle N Abschnitte" with the visitor's own sections
// (#503) and the log's kills (#534) spelled out, "Nur für mich", the groups and the "Automatisch mitgehen" switch. Replaces the
// test of the old chip row (SheetBossNav).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanPublicBoss } from "../../../../api";
import StageBar from "./StageBar";

const boss = (key: string, name: string) => ({ key, name, instanceName: "Hyjal", iconUrl: "", trash: false, general: false }) as unknown as RaidplanPublicBoss;
const BOSSES = [boss("winterchill", "Rage Winterchill"), boss("anetheron", "Anetheron"), boss("kazrogal", "Kaz'rogal"), boss("azgalor", "Azgalor"), boss("archimonde", "Archimonde")];

function show(over: Partial<Parameters<typeof StageBar>[0]> = {}) {
    const onPick = vi.fn();
    const onFocusGroup = vi.fn();
    const toggle = vi.fn();
    const setStrip = vi.fn();
    const r = render(
        <StageBar
            boss={BOSSES[1]} sections={BOSSES} mineKeys={new Set(["winterchill", "azgalor"])} label={(b) => b.name} head="Hyjal · So 19:00"
            onPick={onPick} groups={[]} focusGroup={0} onFocusGroup={onFocusGroup} onlyMine={{ on: false, toggle }} strip={{ mode: "off", set: setStrip }} allTasks={null} updated={false} {...over}
        />,
    );
    const menu = () => { fireEvent.click(screen.getByRole("button", { name: /Alle 5 Abschnitte/ })); return screen.getByRole("dialog", { name: "Abschnitte" }); };
    return { ...r, onPick, onFocusGroup, toggle, setStrip, menu };
}

describe("StageBar", () => {
    it("names the open section with its place and steps to its neighbours", () => {
        const { onPick } = show();
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Anetheron");
        expect(screen.getByText("Hyjal · Boss 2 von 5")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Vorheriger Abschnitt: Rage Winterchill" }));
        fireEvent.click(screen.getByRole("button", { name: "Nächster Abschnitt: Kaz'rogal" }));
        expect(onPick.mock.calls).toEqual([["winterchill"], ["kazrogal"]]);
    });

    it("marks exactly the sections with a personal assignment in the menu, the open one current", () => {
        const { menu } = show();
        const list = menu();
        const marked = within(list).getAllByText("Aufgabe für dich").map((tag) => tag.closest("button")!.querySelector(".rp-sheet-menu-name")!.textContent);
        expect(marked).toEqual(["Rage Winterchill", "Azgalor"]);
        expect(within(list).getByRole("button", { name: /Anetheron/ })).toHaveAttribute("aria-current", "true");
        expect(within(list).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "true")).toHaveLength(1);
    });

    it("says which bosses the log shows killed; a killed boss drops its task note", () => {
        const { menu } = show({ killedKeys: new Set(["winterchill", "anetheron"]) });
        const list = menu();
        const killed = within(list).getAllByText("besiegt").map((tag) => tag.closest("button")!.querySelector(".rp-sheet-menu-name")!.textContent);
        expect(killed).toEqual(["Rage Winterchill", "Anetheron"]);
        expect(within(list).getAllByText("Aufgabe für dich")).toHaveLength(1);
    });

    it("picks a section from the menu and closes it", () => {
        const { menu, onPick } = show();
        fireEvent.click(within(menu()).getByRole("button", { name: /Kaz'rogal/ }));
        expect(onPick).toHaveBeenCalledWith("kazrogal");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("offers 'Nur für mich' only to a visitor in the plan", () => {
        const { menu, toggle, unmount } = show();
        fireEvent.click(within(menu()).getByRole("switch", { name: "Nur für mich" }));
        expect(toggle).toHaveBeenCalled();
        unmount();
        show({ onlyMine: null, mineKeys: new Set() }).menu();
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.queryByText("Aufgabe für dich")).toBeNull();
    });

    it("highlights a group and a second click ends it", () => {
        const { onFocusGroup, unmount } = show({ groups: [1, 2] });
        fireEvent.click(screen.getByRole("button", { name: "Gruppe 2 hervorheben" }));
        expect(onFocusGroup).toHaveBeenLastCalledWith(2);
        unmount();
        const again = show({ groups: [1, 2], focusGroup: 2 });
        expect(screen.getByRole("button", { name: "Gruppe 2 hervorheben" })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(screen.getByRole("button", { name: "Gruppe 2 hervorheben" }));
        expect(again.onFocusGroup).toHaveBeenLastCalledWith(0);
    });

    // #534: the "Automatisch mitgehen" switch, now at the bar's end
    it("shows the follow switch only while a log is read, pressed while it follows", () => {
        expect(show().container.querySelector(".rp-autofollow")).toBeNull();
    });
    it("presses and pauses the follow switch", () => {
        const onToggle = vi.fn();
        const { container, unmount } = show({ follow: { on: true, onToggle } });
        const sw = container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(sw.getAttribute("aria-pressed")).toBe("true");
        expect(sw.textContent).toBe("Automatisch mitgehen");
        fireEvent.click(sw);
        expect(onToggle).toHaveBeenCalled();
        unmount();
        const off = show({ follow: { on: false, onToggle: vi.fn() } }).container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(off.getAttribute("aria-pressed")).toBe("false");
        expect(off.getAttribute("data-tip")).toMatch(/Angehalten/);
    });
    it("shows a waiting chip without a readable log, inert, with the reason in its tooltip", () => {
        const onToggle = vi.fn();
        const { container, unmount } = show({ follow: { on: false, onToggle, waiting: "no_log" } });
        const chip = container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(chip.classList.contains("is-waiting")).toBe(true);
        expect(chip.getAttribute("aria-disabled")).toBe("true");
        expect(chip.textContent).toBe("Wartet auf Log");
        expect(chip.getAttribute("data-tip-sub")).toMatch(/kein Warcraft Log verknüpft/);
        fireEvent.click(chip);
        expect(onToggle).not.toHaveBeenCalled();
        unmount();
        const err = show({ follow: { on: false, onToggle, waiting: "wcl_error" } }).container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(err.getAttribute("data-tip-sub")).toMatch(/nicht lesen/);
    });

    it("shows the live note only right after an update", () => {
        const { unmount } = show();
        expect(screen.getByRole("status")).toHaveTextContent("");
        unmount();
        show({ updated: true });
        expect(screen.getByRole("status")).toHaveTextContent("Aktualisiert");
    });

    it("switches the boss strip in the menu: off, top, left", () => {
        const { menu, setStrip } = show();
        const group = within(menu()).getByRole("radiogroup", { name: "Boss-Leiste" });
        expect(within(group).getByRole("radio", { name: "Aus" })).toHaveAttribute("aria-checked", "true");
        fireEvent.click(within(group).getByRole("radio", { name: "Links" }));
        expect(setStrip).toHaveBeenCalledWith("left");
    });

    it("'Alle Einteilungen' is a pressed switch while the panel is open, and missing without a map", () => {
        const toggleAll = vi.fn();
        const { unmount } = show({ allTasks: { on: true, toggle: toggleAll } });
        const sw = screen.getByRole("button", { name: /Alle Einteilungen/ });
        expect(sw).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(sw);
        expect(toggleAll).toHaveBeenCalled();
        unmount();
        show();
        expect(screen.queryByRole("button", { name: /Alle Einteilungen/ })).toBeNull();
    });
});