// The sheet's section chips (SheetBossNav, issue #503): the sections where the visitor is personally assigned carry the dot, a tooltip
// and a label that says so; the chosen chip stays the filled one.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanPublicBoss } from "../../../api";
import SheetBossNav from "./SheetBossNav";

const boss = (key: string, name: string) => ({ key, name, iconUrl: "" }) as unknown as RaidplanPublicBoss;
const BOSSES = [boss("winterchill", "Rage Winterchill"), boss("anetheron", "Anetheron"), boss("kazrogal", "Kaz'rogal"), boss("azgalor", "Azgalor"), boss("archimonde", "Archimonde")];

function show(over: Partial<Parameters<typeof SheetBossNav>[0]> = {}) {
    const onSelect = vi.fn();
    const onToggleOnlyMine = vi.fn();
    const r = render(<SheetBossNav bosses={BOSSES} selectedKey="anetheron" mineKeys={new Set(["winterchill", "azgalor"])} label={(b) => b.name} showOnlyMine onlyMine={false} onToggleOnlyMine={onToggleOnlyMine} onSelect={onSelect} {...over} />);
    return { ...r, onSelect, onToggleOnlyMine };
}

describe("SheetBossNav", () => {
    it("marks exactly the sections with a personal assignment (two of five)", () => {
        const { container } = show();
        const marked = Array.from(container.querySelectorAll(".rp-bosschip.has-mine"));
        expect(marked.map((b) => b.textContent)).toEqual(["Rage Winterchill", "Azgalor"]);
        expect(container.querySelectorAll(".rp-bosschip-mine")).toHaveLength(2);
        expect(marked[0].getAttribute("data-tip")).toBe("Du hast hier Einteilungen");
        expect(screen.getByRole("button", { name: "Rage Winterchill (Du hast hier Einteilungen)" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Anetheron" }).getAttribute("data-tip")).toBeNull();
    });
    it("keeps the chosen chip filled, marked or not", () => {
        const { container } = show({ selectedKey: "azgalor" });
        const on = container.querySelectorAll(".rp-bosschip.is-on");
        expect(on).toHaveLength(1);
        expect(on[0].classList.contains("has-mine")).toBe(true);
        expect(on[0].getAttribute("aria-current")).toBe("true");
    });
    it("marks nothing without a visitor, and hides 'Only for me' then", () => {
        const { container } = show({ mineKeys: new Set(), showOnlyMine: false });
        expect(container.querySelectorAll(".rp-bosschip-mine")).toHaveLength(0);
        expect(screen.queryByRole("button", { name: "Nur für mich" })).toBeNull();
    });
    it("selects a section and toggles 'Only for me'", () => {
        const { onSelect, onToggleOnlyMine } = show();
        fireEvent.click(screen.getByRole("button", { name: "Kaz'rogal" }));
        expect(onSelect).toHaveBeenCalledWith("kazrogal");
        fireEvent.click(screen.getByRole("button", { name: "Nur für mich" }));
        expect(onToggleOnlyMine).toHaveBeenCalled();
    });

    // #534: the linked log's kills and the "Automatisch mitgehen" switch
    it("marks the bosses the log shows killed, beside the #503 dot", () => {
        const { container } = show({ killedKeys: new Set(["winterchill", "anetheron"]) });
        const killed = Array.from(container.querySelectorAll(".rp-bosschip.is-killed"));
        expect(killed.map((b) => b.textContent)).toEqual(["Rage Winterchill", "Anetheron"]);
        expect(container.querySelectorAll(".rp-bosschip-done")).toHaveLength(2);
        // both marks on one chip: both said in tooltip and label
        expect(killed[0].getAttribute("data-tip")).toBe("Du hast hier Einteilungen · Im Log getötet");
        expect(screen.getByRole("button", { name: "Rage Winterchill (Du hast hier Einteilungen, Im Log getötet)" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Anetheron (Im Log getötet)" }).classList.contains("is-on")).toBe(true);
    });
    it("shows the follow switch only while a log is read, pressed while it follows", () => {
        expect(show().container.querySelector(".rp-autofollow")).toBeNull();
        const onToggle = vi.fn();
        const { container } = show({ follow: { on: true, onToggle } });
        const sw = container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(sw.getAttribute("aria-pressed")).toBe("true");
        expect(sw.textContent).toBe("Automatisch mitgehen");
        fireEvent.click(sw);
        expect(onToggle).toHaveBeenCalled();
    });
    it("says the switch is paused when it is off", () => {
        const { container } = show({ follow: { on: false, onToggle: vi.fn() } });
        const sw = container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(sw.getAttribute("aria-pressed")).toBe("false");
        expect(sw.getAttribute("data-tip")).toMatch(/Angehalten/);
    });
    it("shows a waiting chip without a readable log, inert, with the reason in its tooltip", () => {
        const onToggle = vi.fn();
        const { container, unmount } = show({ follow: { on: false, onToggle, waiting: "no_log" } });
        const chip = container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(chip.classList.contains("is-waiting")).toBe(true);
        expect(chip.getAttribute("aria-disabled")).toBe("true");
        expect(chip.hasAttribute("aria-pressed")).toBe(false);
        expect(chip.textContent).toBe("Wartet auf Log");
        expect(chip.getAttribute("data-tip-sub")).toMatch(/kein Warcraft Log verknüpft/);
        fireEvent.click(chip);
        expect(onToggle).not.toHaveBeenCalled();
        unmount();
        const err = show({ follow: { on: false, onToggle, waiting: "wcl_error" } }).container.querySelector(".rp-autofollow") as HTMLButtonElement;
        expect(err.getAttribute("data-tip-sub")).toMatch(/nicht lesen/);
    });
});
