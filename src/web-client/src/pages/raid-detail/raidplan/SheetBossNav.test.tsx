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
});
