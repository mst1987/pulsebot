// Raidplan-Katalog per game version (#544): the menu's content switch (#563) decides the version, the page shows
// only that version's entries, and a new entry is made for the version shown (its chips can add others).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { CatalogAdmin, GameVersionsData } from "../api";
import { CONTENT_ARIA, renderPage, twoVersions } from "../test/render";
import { t } from "../i18n";
import RaidplanCatalogPage from "./RaidplanCatalogPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidplanCatalog: vi.fn(),
    getGameVersions: vi.fn(),
    saveCatalogEntry: vi.fn(),
}));

const version = (id: string, short: string, instances: { id: string; name: string }[]) => ({ id, short, label: short, instances }) as unknown as GameVersionsData["versions"][number];
const VERSIONS: GameVersionsData = {
    defaultVersion: "tbc",
    versions: [version("tbc", "TBC", [{ id: "bt", name: "Black Temple" }]), version("classic", "Classic", []), version("forever", "Forever", [{ id: "forever-ony", name: "Onyxias Hort (Forever)" }])],
};
const CATALOG: CatalogAdmin = {
    mobs: [
        { id: "d:gathios", name: "Gathios the Shatterer", kind: "add", instanceId: "bt", bossKey: "", icon: "", note: "", versions: ["tbc"], source: "default" },
        { id: "c:whelp", name: "Onyxian Whelp", kind: "add", instanceId: "forever-ony", bossKey: "", icon: "", note: "", versions: ["forever"], source: "custom" },
    ],
    spells: [{ id: "d:kick", name: "Kick", nameEn: "", icon: "ability_kick", type: "kick", classes: ["Rogue"], note: "", versions: ["tbc"], source: "default" }],
    hidden: { mobs: [], spells: [] },
    iconChoices: {}, kinds: ["boss", "add", "trash", "other"], classes: ["Rogue"], types: ["kick"],
    instances: [
        { id: "bt", name: "Black Temple", short: "BT", versionId: "tbc", bosses: [] },
        { id: "forever-ony", name: "Onyxias Hort (Forever)", short: "Ony F", versionId: "forever", bosses: [] },
    ],
    limits: { mobs: 400, spells: 300, name: 60, note: 200 },
};

beforeEach(() => {
    localStorage.removeItem("eh-content-version");
    vi.mocked(api.getRaidplanCatalog).mockReset().mockResolvedValue(CATALOG);
    vi.mocked(api.getGameVersions).mockReset().mockResolvedValue(VERSIONS);
    vi.mocked(api.saveCatalogEntry).mockReset().mockResolvedValue(CATALOG);
});

describe("Raidplan-Katalog per game version", () => {
    it("shows the entries of the menu's content version, the main one first", async () => {
        const user = userEvent.setup();
        renderPage(<RaidplanCatalogPage />, { route: "/raids/plan-catalog", content: twoVersions() });
        expect(await screen.findByText("Gathios the Shatterer")).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: "Spielversion des Katalogs" })).not.toBeInTheDocument();
        const sw = screen.getAllByRole("radiogroup", { name: t(CONTENT_ARIA) })[0];
        expect(screen.queryByText("Onyxian Whelp")).not.toBeInTheDocument();

        await user.click(within(sw).getByRole("radio", { name: /Forever/ }));
        expect(screen.getByText("Onyxian Whelp")).toBeInTheDocument();
        expect(screen.queryByText("Gathios the Shatterer")).not.toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: /Spells/ }));
        expect(screen.getByText(/In Forever gibt es noch keine Einträge/)).toBeInTheDocument();
        expect(screen.queryByText("Kick")).not.toBeInTheDocument();
    });

    it("a new mob is made for the version shown, offers that version's instances and needs a version", async () => {
        const user = userEvent.setup();
        renderPage(<RaidplanCatalogPage />, { route: "/raids/plan-catalog", content: twoVersions() });
        await screen.findByText("Gathios the Shatterer");
        const sw = screen.getAllByRole("radiogroup", { name: t(CONTENT_ARIA) })[0];
        await user.click(within(sw).getByRole("radio", { name: /Forever/ }));
        await user.click(screen.getByRole("button", { name: /Neuer Mob/ }));
        const dialog = await screen.findByRole("dialog");
        const chips = within(dialog).getByRole("group", { name: "Spielversion" });
        expect(within(chips).getByRole("button", { name: "Forever" })).toHaveAttribute("aria-pressed", "true");
        expect(within(chips).getByRole("button", { name: "TBC" })).toHaveAttribute("aria-pressed", "false");
        const instance = within(dialog).getByRole("combobox", { name: "Instanz" });
        expect(within(instance).getAllByRole("option").map((o) => o.textContent)).toEqual(["Ohne Instanz", "Onyxias Hort (Forever)"]);

        await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Onyxian Warder");
        const save = within(dialog).getByRole("button", { name: "Speichern" });
        // no version, no save
        await user.click(within(chips).getByRole("button", { name: "Forever" }));
        expect(save).toBeDisabled();
        await user.click(within(chips).getByRole("button", { name: "Forever" }));
        await user.click(save);
        expect(api.saveCatalogEntry).toHaveBeenCalledWith("mobs", expect.objectContaining({ name: "Onyxian Warder", versions: ["forever"] }));
    });
});
