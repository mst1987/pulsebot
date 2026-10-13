// Einstellungen → Addons (#818): the list of addons, one editor at a time,
// saved whole; the hint when private addons have no GitHub token.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import AddonsSection from "./AddonsSection";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    updateSettings: vi.fn(),
}));

const LEVELHELPER: api.AddonSetting = {
    id: "levelhelper", name: "LevelHelper", description: "Leveling-Helfer.", repo: "mst1987/levelhelper", private: true,
    assets: ["LevelHelper-*.zip"], versions: ["forever"], install: "", icon: "inv_misc_map02", enabled: true,
};
const SYNC: api.AddonSetting = {
    id: "eventhelper-sync", name: "EventHelper Sync", description: "", repo: "mst1987/eventhelper-addon", private: false,
    assets: [], versions: ["tbc", "forever"], install: "", icon: "inv_gizmo_01", enabled: false,
};

function data(over: Partial<api.AdminConfig> = {}): api.SettingsData {
    return {
        config: { addonDownloads: [LEVELHELPER, SYNC], github: { hasToken: false }, ...over },
        gameVersions: [
            { id: "tbc", label: "WoW TBC", short: "TBC" },
            { id: "classic", label: "WoW Classic", short: "Classic" },
            { id: "forever", label: "WoW Forever", short: "Forever" },
        ],
    } as unknown as api.SettingsData;
}

/** The table row of an addon. */
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => {
    localStorage.removeItem("addons-sort");
    vi.mocked(api.updateSettings).mockImplementation(async (partial) => ({ config: { ...data().config, ...partial } as api.AdminConfig }));
});
afterEach(() => switchLang("de"));

describe("AddonsSection", () => {
    it("lists the addons with repo, versions, files and whether they are shown", () => {
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(screen.getByText("LevelHelper")).toBeInTheDocument();
        expect(screen.getByText("mst1987/levelhelper · privat")).toBeInTheDocument();
        expect(screen.getByText("TBC, Forever")).toBeInTheDocument();
        expect(screen.getByText("alle Dateien")).toBeInTheDocument();
        expect(screen.getByText("Sichtbar")).toBeInTheDocument();
        expect(screen.getByText("Ausgeblendet")).toBeInTheDocument();
    });

    it("says that the private addons need the token, and links to the connections", () => {
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(screen.getByText("Private Addons brauchen den GitHub-Token.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zu den Verbindungen" })).toHaveAttribute("href", "/settings?section=verbindungen");
    });

    it("has no token hint once the token is set", () => {
        renderPage(<AddonsSection data={data({ github: { hasToken: true } })} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(screen.queryByText("Private Addons brauchen den GitHub-Token.")).toBeNull();
    });

    it("adds an addon and saves the whole list", async () => {
        const user = userEvent.setup();
        const onConfig = vi.fn();
        renderPage(<AddonsSection data={data()} onConfig={onConfig} />, { route: "/settings?section=addons" });
        await user.click(screen.getByRole("button", { name: "Addon hinzufügen" }));
        await user.type(screen.getByLabelText("Name"), "ProfessionKit");
        await user.type(screen.getByPlaceholderText("mst1987/levelhelper"), "mst1987/professionkit");
        await user.type(screen.getByPlaceholderText("LevelHelper-*.zip"), "ProfessionKit-*.zip");
        await user.click(screen.getByRole("button", { name: "WoW Forever" }));
        await user.click(screen.getByRole("switch", { name: "Privates Repo" }));
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        const sent = vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads!;
        expect(sent.map((a) => a.name)).toEqual(["LevelHelper", "EventHelper Sync", "ProfessionKit"]);
        expect(sent[2]).toMatchObject({ repo: "mst1987/professionkit", assets: ["ProfessionKit-*.zip"], versions: ["forever"], private: true, enabled: true });
        expect(onConfig).toHaveBeenCalled();
        expect(await screen.findByText("ProfessionKit hinzugefügt.")).toBeInTheDocument();
    });

    it("edits an addon in place, keeping its id", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(within(rowOf("LevelHelper")).getByRole("button", { name: "Bearbeiten" }));
        const name = screen.getByLabelText("Name");
        await user.clear(name);
        await user.type(name, "Level Helper");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        const sent = vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads!;
        expect(sent[0]).toMatchObject({ id: "levelhelper", name: "Level Helper" });
        expect(sent).toHaveLength(2);
    });

    it("removes an addon after asking", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(within(rowOf("EventHelper Sync")).getByRole("button", { name: "Löschen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("EventHelper Sync entfernen?")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /Löschen/ }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads!.map((a) => a.id)).toEqual(["levelhelper"]);
    });

    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(screen.getByRole("button", { name: "Add addon" })).toBeInTheDocument();
        expect(screen.getByText("Private addons need the GitHub token.")).toBeInTheDocument();
    });
});
