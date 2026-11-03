// WoW Forever characters are "first name last name": a raider line in the setup (groups,
// bench and "Angemeldet" all draw `Slot`) and the loot list read "Konstantinos M.". The
// whole name stays reachable: in the editor through the raider panel (peek), elsewhere
// as a tooltip. Without `shortNames` (every other version) nothing changes.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SetupLootCheck, SetupLootStatus, SetupPerson } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import { MAGE, PRIEST } from "../../../../test/fixtures/setupEditor";
import { Slot, type Interaction } from "../Board";
import { LootPanel } from "../LootPanel";
import { PoolPanel } from "../PoolPanel";

const LONG = "Konstantinos Morgenstern";
const SHORT = "Konstantinos M.";

const readOnly = (over: Partial<Interaction> = {}): Interaction => ({
    editable: false, selected: null, dragging: null, attendance: {}, suggest: null, extraRoles: {},
    onInspect: vi.fn(), onPick: vi.fn(), onDrop: vi.fn(), onDrag: vi.fn(), ...over,
});
const long: SetupPerson = { ...MAGE, character: LONG };

describe("a raider line", () => {
    it("Forever, without a peek: shortened, the whole name as a tooltip", () => {
        renderPage(<Slot p={long} ui={readOnly({ shortNames: true })} />);
        expect(screen.getByText(SHORT)).toHaveAttribute("data-tip", LONG);
    });

    it("Forever, in the editor: shortened, the peek shows the whole name, so no second tooltip", () => {
        renderPage(<Slot p={long} ui={readOnly({ shortNames: true, onLeave: vi.fn() })} />);
        expect(screen.getByText(SHORT)).not.toHaveAttribute("data-tip");
    });

    it("Forever: a short name stays whole, no tooltip", () => {
        renderPage(<Slot p={{ ...MAGE, character: "Aldric Sturmwind" }} ui={readOnly({ shortNames: true })} />);
        expect(screen.getByText("Aldric Sturmwind")).not.toHaveAttribute("data-tip");
    });

    it("another version: the whole name", () => {
        renderPage(<Slot p={long} ui={readOnly()} />);
        expect(screen.getByText(LONG)).not.toHaveAttribute("data-tip");
    });
});

describe("\"Angemeldet\"", () => {
    const owner: SetupPerson = {
        ...MAGE,
        character: LONG,
        characters: [
            { character: LONG, role: "ranged", priority: 0 },
            { character: "Lumen Licht", role: "healer", priority: 1, classId: PRIEST.classId, spec: PRIEST.spec, classLabel: PRIEST.classLabel, specLabel: PRIEST.specLabel, classColor: PRIEST.classColor },
        ] as SetupPerson["characters"],
    };

    it("Forever: the line and the note of a further character are shortened", () => {
        renderPage(<PoolPanel pool={[owner]} ui={readOnly({ shortNames: true })} />);
        expect(screen.getByText(SHORT)).toBeInTheDocument();
        expect(screen.getByText(t("setup.poolPanel.altOf", { n: 2, character: SHORT }))).toHaveAttribute("data-tip", t("setup.poolPanel.altOf", { n: 2, character: LONG }));
    });

    it("Forever, in the editor: the note keeps its tooltip, the peek shows the further character, not the owner", () => {
        renderPage(<PoolPanel pool={[owner]} ui={readOnly({ shortNames: true, onLeave: vi.fn() })} />);
        expect(screen.getByText(t("setup.poolPanel.altOf", { n: 2, character: SHORT }))).toHaveAttribute("data-tip", t("setup.poolPanel.altOf", { n: 2, character: LONG }));
    });

    it("Forever: a note with a short name needs no tooltip", () => {
        const short: SetupPerson = { ...owner, character: "Aldric Sturmwind", characters: [{ ...owner.characters![0], character: "Aldric Sturmwind" }, owner.characters![1]] };
        renderPage(<PoolPanel pool={[short]} ui={readOnly({ shortNames: true })} />);
        expect(screen.getByText(t("setup.poolPanel.altOf", { n: 2, character: "Aldric Sturmwind" }))).not.toHaveAttribute("data-tip");
    });

    it("another version: both whole, no tooltip", () => {
        renderPage(<PoolPanel pool={[owner]} ui={readOnly()} />);
        expect(screen.getByText(LONG)).toBeInTheDocument();
        expect(screen.getByText(t("setup.poolPanel.altOf", { n: 2, character: LONG }))).not.toHaveAttribute("data-tip");
    });
});

describe("the loot list", () => {
    const STATUS: SetupLootStatus = { job: null, progress: null, counts: { signups: 2, gear: 1, softres: 1, bis: 0, spec: 0 }, at: Date.now(), wowheadPath: "" };
    const CHECK: SetupLootCheck = {
        on: true,
        conflicts: 1,
        sources: { softres: 2, bis: 0, spec: 0, none: 0 },
        items: [{
            // invented id and name: the test checks the rendering, not the game data
            itemId: 900001, name: "Testklinge", icon: "", quality: 4, count: 2, eventIds: ["e1"], conflictIn: ["e1"],
            raids: [{ eventId: "e1", title: "Raid 1", raiders: [{ userId: "u1", character: LONG, source: "softres" }, { userId: "u2", character: "Lumen", source: "" }] }],
        }],
    };

    it("Forever: shortened, the whole name as a tooltip; a short name has none", () => {
        render(<LootPanel status={STATUS} check={CHECK} busy={false} onLoad={() => {}} shortNames />);
        expect(screen.getByLabelText(t("setup.loot.raidsAria"))).toHaveTextContent(`Raid 1: ${SHORT} ${t("setup.loot.source.softres")}, Lumen`);
        expect(screen.getByText(SHORT)).toHaveAttribute("data-tip", LONG);
        expect(screen.getByText("Lumen")).not.toHaveAttribute("data-tip");
    });

    it("another version: the whole name, no tooltip", () => {
        render(<LootPanel status={STATUS} check={CHECK} busy={false} onLoad={() => {}} />);
        expect(screen.getByText(LONG)).not.toHaveAttribute("data-tip");
        expect(screen.queryByText(SHORT)).not.toBeInTheDocument();
    });
});
