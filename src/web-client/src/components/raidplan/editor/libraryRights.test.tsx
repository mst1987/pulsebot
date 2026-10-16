// The shared raid plan library inside an event's editor (#726): the orga of a category edits their raid's plan,
// but the default room maps and the tactic library ("Als Taktik speichern", "Verwalten") stay with `raidplan`
// write - no button whose route would refuse them.
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanBoss } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import MapPanel, { type MapRow } from "./MapPanel";
import { LibraryModal } from "./ProfileModals";

const BOSS: RaidplanBoss = {
    key: "bt/supremus", instanceId: "bt", instanceName: "Der Schwarze Tempel", name: "Supremus", iconUrl: "", mapUrl: "",
    mapSource: "", ownMap: true, instanceMap: false,
};

describe("MapPanel: a locked row", () => {
    it("shows the map's state but no upload or remove button", () => {
        const rows: MapRow[] = [
            { key: "e/eh-1/bt/supremus", label: "Karte dieses Plans", has: true, override: true },
            { key: "bt/supremus", label: "Standard: Supremus", has: true, override: false, locked: true },
        ];
        renderPage(<MapPanel rows={rows} canWrite onChanged={vi.fn()} />);
        const own = screen.getByText("Karte dieses Plans").closest(".rp-map-row") as HTMLElement;
        const locked = screen.getByText("Standard: Supremus").closest(".rp-map-row") as HTMLElement;
        expect(within(own).getByRole("button", { name: t("raidBoard.board.mapReplace") })).toBeInTheDocument();
        expect(within(locked).queryByRole("button")).not.toBeInTheDocument();
        expect(within(locked).getByText(t("raidBoard.board.mapHas"))).toBeInTheDocument();
    });
});

describe("LibraryModal: without the library's right", () => {
    const base = { open: true, onClose: vi.fn(), profiles: [], bosses: [BOSS], bossKey: BOSS.key, bossName: BOSS.name, onPick: vi.fn(), canSave: true };

    it("offers saving and managing with the right", () => {
        renderPage(<LibraryModal {...base} onSaveAs={vi.fn()} onManage={vi.fn()} />);
        expect(screen.getByRole("button", { name: t("raidBoard.steps.library.saveAs") })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("raidBoard.steps.library.manage") })).toBeInTheDocument();
    });

    it("leaves both out without it, picking and closing stay", () => {
        renderPage(<LibraryModal {...base} />);
        expect(screen.queryByRole("button", { name: t("raidBoard.steps.library.saveAs") })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("raidBoard.steps.library.manage") })).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: t("raidBoard.steps.library.close") }).length).toBeGreaterThan(0);
    });
});
