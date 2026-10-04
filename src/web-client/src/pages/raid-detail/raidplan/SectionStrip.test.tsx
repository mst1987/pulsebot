// The editor's section strip (Oct 2026, replaces the chip rows of BossNav): "◀ [icon] Supremus · Boss 2 von 3 ▾ ▶", the open
// assignments of this section as a badge, the list of every section with the states the chips had (#534 killed, sheet in / out,
// unsaved, open assignments), and "Automatisch mitgehen" while a log is read.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanBoss } from "../../../api";
import SectionStrip from "./SectionStrip";
import { sectionPosition } from "./planView";

const boss = (key: string, name: string, extra: Partial<RaidplanBoss> = {}) => ({ key, name, iconUrl: "", instanceId: "bt", instanceName: "Black Temple", ...extra }) as unknown as RaidplanBoss;
const BOSSES = [
    boss("__defaults", "Standard", { defaults: true }), boss("__general", "Allgemein", { general: true }),
    boss("bt/high-warlord-najentus", "High Warlord Naj'entus"), boss("bt/supremus", "Supremus"), boss("bt/shade-of-akama", "Shade of Akama"),
    boss("bt/trash", "Trash", { trash: true }),
];

const openList = () => fireEvent.click(screen.getByRole("button", { name: /Abschnitt wählen/ }));

describe("SectionStrip", () => {
    it("names the section and where it stands: bosses as 'Boss n von m', the rest as a section", () => {
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} />);
        const pick = screen.getByRole("button", { name: /Abschnitt wählen/ });
        expect(pick).toHaveTextContent("Supremus");
        expect(pick).toHaveTextContent("Boss 2 von 3");
        expect(sectionPosition(BOSSES, "__general")).toEqual({ boss: false, n: 2, of: 6 });
        expect(sectionPosition(BOSSES, "bt/trash")).toEqual({ boss: false, n: 6, of: 6 });
    });

    it("steps to the previous and next section, and says where the list ends", () => {
        const onSelect = vi.fn();
        const { rerender } = render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole("button", { name: "Voriger Abschnitt: High Warlord Naj'entus" }));
        fireEvent.click(screen.getByRole("button", { name: "Nächster Abschnitt: Shade of Akama" }));
        expect(onSelect.mock.calls).toEqual([["bt/high-warlord-najentus"], ["bt/shade-of-akama"]]);
        rerender(<SectionStrip bosses={BOSSES} selected="__defaults" draft={{}} onSelect={onSelect} />);
        expect(screen.getByRole("button", { name: "Das ist der erste Abschnitt" })).toBeDisabled();
    });

    it("lists every section; a click chooses it and closes the list", () => {
        const onSelect = vi.fn();
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={onSelect} />);
        openList();
        const list = screen.getByRole("dialog", { name: "Abschnitt wählen" });
        expect(within(list).getAllByRole("listitem")).toHaveLength(6);
        // the chosen one is marked and gets the focus
        const chosen = list.querySelector(".rp-strip-item[aria-current]") as HTMLElement;
        expect(chosen).toHaveTextContent("Supremus");
        expect(document.activeElement).toBe(chosen);
        fireEvent.click(within(list).getByRole("button", { name: "Shade of Akama" }));
        expect(onSelect).toHaveBeenCalledWith("bt/shade-of-akama");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("moves through the list with the arrow keys and closes it with Escape", () => {
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} />);
        openList();
        const list = screen.getByRole("dialog");
        fireEvent.keyDown(list, { key: "ArrowDown" });
        expect(document.activeElement).toHaveTextContent("Shade of Akama");
        fireEvent.keyDown(list, { key: "Home" });
        expect(document.activeElement).toHaveTextContent("Standard");
        fireEvent.keyDown(list, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: /Abschnitt wählen/ }));
    });

    it("shows this section's open assignments as a badge and each section's in the list", () => {
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} openCounts={{ "bt/supremus": 2, "bt/trash": 1 }} />);
        expect(document.querySelector(".rp-strip-nav > .badge")).toHaveTextContent("2 offen");
        openList();
        expect(screen.getByRole("button", { name: "Trash, 1 offen" })).toBeTruthy();
    });

    it("marks killed bosses (#534) and keeps the others as they were; no follow switch without a log", () => {
        const { container } = render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} killedKeys={new Set(["bt/high-warlord-najentus"])} />);
        expect(container.querySelector(".rp-autofollow")).toBeNull();
        openList();
        const killed = Array.from(document.querySelectorAll(".rp-strip-item.is-killed"));
        expect(killed.map((b) => b.querySelector(".rp-bosschip-name")!.textContent)).toEqual(["High Warlord Naj'entus"]);
        expect(killed[0].getAttribute("data-tip")).toBe("Im Log getötet");
        expect(screen.getByRole("button", { name: "Supremus" }).getAttribute("data-tip")).toBeNull();
    });

    it("hands the follow switch to its toggle", () => {
        const onToggle = vi.fn();
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} follow={{ on: false, onToggle }} />);
        const sw = screen.getByRole("button", { name: "Automatisch mitgehen" });
        expect(sw.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(sw);
        expect(onToggle).toHaveBeenCalled();
    });

    it("switches a section in or out of the sheet with the eye; a section out of it is dimmed; Standard has no eye", () => {
        const onSheet = vi.fn();
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{ "bt/trash": { inSheet: false } }} onSelect={vi.fn()} onSheet={onSheet} />);
        openList();
        expect(screen.queryByRole("button", { name: /^Standard: / })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Supremus: Aus dem Sheet ausklammern" }));
        expect(onSheet).toHaveBeenCalledWith("bt/supremus", false);
        expect(screen.getByRole("button", { name: /^Trash \(/ })).toHaveClass("is-out");
    });

    it("marks unsaved sections in the list and on the strip", () => {
        render(<SectionStrip bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} dirtyKeys={["bt/supremus", "bt/trash"]} />);
        expect(screen.getByRole("button", { name: /Abschnitt wählen/ })).toHaveClass("is-unsaved");
        openList();
        expect(document.querySelectorAll(".rp-strip-item.is-unsaved")).toHaveLength(2);
    });
});
