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
    // the download centre under the list loads on its own (AddonCenterCard.test.tsx)
    getAddonCenter: vi.fn(() => new Promise(() => {})),
}));

const LEVELHELPER: api.AddonSetting = {
    id: "levelhelper", name: "LevelHelper", description: "Leveling-Helfer.", repo: "mst1987/levelhelper", private: true,
    assets: ["LevelHelper-*.zip"], versions: ["forever"], install: "", icon: "inv_misc_map02", enabled: true, orgaOnly: false, curseforge: "",
};
const SYNC: api.AddonSetting = {
    id: "eventhelper-sync", name: "EventHelper Sync", description: "", repo: "mst1987/eventhelper-addon", private: false,
    assets: [], versions: ["tbc", "forever"], install: "", icon: "inv_gizmo_01", enabled: false, orgaOnly: true, curseforge: "",
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

    it("shows the orga-only mark in the list and saves the toggle \"Nur Orga\"", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(within(rowOf("EventHelper Sync")).getByText(/nur Orga/)).toBeInTheDocument();
        expect(within(rowOf("LevelHelper")).queryByText(/nur Orga/)).toBeNull();
        await user.click(within(rowOf("LevelHelper")).getByRole("button", { name: "Bearbeiten" }));
        const toggle = screen.getByRole("switch", { name: "Nur Orga" });
        expect(toggle).not.toBeChecked();
        await user.click(toggle);
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        const sent = vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads!;
        expect(sent[0]).toMatchObject({ id: "levelhelper", orgaOnly: true });
        expect(sent[1]).toMatchObject({ id: "eventhelper-sync", orgaOnly: true });
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
        // the list goes alone: the server refuses it next to any other setting
        expect(Object.keys(vi.mocked(api.updateSettings).mock.calls[0][0])).toEqual(["addonDownloads"]);
    });

    it("restores the default addons after asking", async () => {
        const user = userEvent.setup();
        const onConfig = vi.fn();
        renderPage(<AddonsSection data={data({ addonDownloads: [] })} onConfig={onConfig} />, { route: "/settings?section=addons" });
        expect(screen.getByText("Noch keine Addons. Die Seite „Addons“ bleibt leer.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Standard wiederherstellen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Standard-Addons wiederherstellen?")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /Wiederherstellen/ }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ addonDownloadsReset: true }));
        expect(onConfig).toHaveBeenCalled();
        expect(await screen.findByText("Standard-Addons wiederhergestellt.")).toBeInTheDocument();
    });

    it("leaves the list alone when the restore is cancelled", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(screen.getByRole("button", { name: "Standard wiederherstellen" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(api.updateSettings).not.toHaveBeenCalled();
    });

    it("edits and saves the CurseForge link of an addon", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(within(rowOf("LevelHelper")).getByRole("button", { name: "Bearbeiten" }));
        const input = screen.getByLabelText("CurseForge-Link", { selector: "input" });
        expect(input).toHaveValue("");
        await user.type(input, "https://www.curseforge.com/wow/addons/levelhelper");
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        const sent = vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads!;
        expect(sent[0]).toMatchObject({ id: "levelhelper", curseforge: "https://www.curseforge.com/wow/addons/levelhelper" });
        expect(sent[1]).toMatchObject({ id: "eventhelper-sync", curseforge: "" });
    });

    it("shows a stored CurseForge link and lets the admin clear it", async () => {
        const user = userEvent.setup();
        const cf = "https://www.curseforge.com/wow/addons/pulse-aurakit";
        renderPage(<AddonsSection data={data({ addonDownloads: [{ ...LEVELHELPER, curseforge: cf }, SYNC] })} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(within(rowOf("LevelHelper")).getByRole("button", { name: "Bearbeiten" }));
        const input = screen.getByLabelText("CurseForge-Link", { selector: "input" });
        expect(input).toHaveValue(cf);
        await user.clear(input);
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0].addonDownloads![0]).toMatchObject({ curseforge: "" });
    });

    it("lets the browser flag a CurseForge address the server would drop (pattern as browsers compile it, v flag)", async () => {
        const user = userEvent.setup();
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        await user.click(within(rowOf("LevelHelper")).getByRole("button", { name: "Bearbeiten" }));
        const pattern = screen.getByLabelText("CurseForge-Link", { selector: "input" }).getAttribute("pattern")!;
        const accepts = (value: string) => new RegExp(`^(?:${pattern})$`, "v").test(value);
        for (const ok of [
            "https://www.curseforge.com/wow/addons/pulse-aurakit",
            "https://curseforge.com/wow/addons/pulse-aurakit/",
            "http://legacy.curseforge.com/wow/addons/pulse-aurakit/files/123",
            "https://www.curseforge.com/wow/addons/pulse-aurakit?ref=x",
        ]) expect(accepts(ok)).toBe(true);
        for (const bad of [
            "https://www.curseforge.com/projects/1748186",
            "https://www.curseforge.com/wow/addons/",
            "https://www.curseforge.com/minecraft/mc-mods/x",
            "https://evil.example/www.curseforge.com/wow/addons/x",
            "https://www.curseforge.com/wow/addons/pulse_aurakit",
        ]) expect(accepts(bad)).toBe(false);
    });

    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<AddonsSection data={data()} onConfig={vi.fn()} />, { route: "/settings?section=addons" });
        expect(screen.getByRole("button", { name: "Add addon" })).toBeInTheDocument();
        expect(screen.getByText("Private addons need the GitHub token.")).toBeInTheDocument();
    });
});
