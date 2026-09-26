// "Aus Raid-Helper laden" on the Raid-Vorlagen page: the Raid-Helper templates
// the create dialog offers come from here (#266).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderPage } from "../test/render";
import RaidTemplatesPage from "./RaidTemplatesPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidTemplates: vi.fn(),
    getGameVersions: vi.fn(),
    importRaidTemplates: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(api.getRaidTemplates).mockReset().mockResolvedValue({ templates: [], categoryNames: {} });
    vi.mocked(api.getGameVersions).mockReset().mockResolvedValue({ versions: [], defaultVersion: "tbc" });
    vi.mocked(api.importRaidTemplates).mockReset().mockResolvedValue({ added: 2, updated: 1, templates: [] });
});

describe("Raid-Vorlagen import", () => {
    it("imports the Raid-Helper templates, reports it and reloads the list", async () => {
        const user = userEvent.setup();
        renderPage(<RaidTemplatesPage />, { route: "/raids/raid-templates" });
        await user.click(await screen.findByRole("button", { name: "Aus Raid-Helper laden" }));

        expect(api.importRaidTemplates).toHaveBeenCalledTimes(1);
        expect(await screen.findByText("2 neu, 1 schon vorhanden.")).toBeInTheDocument();
        await waitFor(() => expect(api.getRaidTemplates).toHaveBeenCalledTimes(2));
    });
});
