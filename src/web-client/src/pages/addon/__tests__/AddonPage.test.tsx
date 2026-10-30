// The page "Addons" (#818) against a mocked API: one card per addon of the
// menu's version, download buttons that point at the server's route (never at
// GitHub), "Was ist neu?", the install steps, and the states (no release,
// GitHub unreachable with the cached release, missing token for admins and
// for members).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { switchLang } from "../../../test/i18n";
import { adminUser, renderPage, twoVersions } from "../../../test/render";
import { formatSize } from "../../../lib/format";
import { addonFolder, plainNotes } from "../../../lib/addons/addonInstall";
import AddonPage from "../AddonPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getAddons: vi.fn(),
}));

const file = (name: string, size: number, kind: api.AddonFile["kind"]): api.AddonFile => ({
    name, size, kind, sha256: "ab".repeat(32), url: `/api/addons/download?addon=x&asset=${encodeURIComponent(name)}`,
});

const levelhelper: api.AddonCard = {
    id: "levelhelper", name: "LevelHelper", description: "Leveling-Helfer für WoW Forever.", icon: "inv_misc_map02",
    versions: ["forever"], install: "", state: "ok", stale: false, errorCode: "", fetchedAt: Date.parse("2026-10-12T10:00:00Z"), orgaOnly: false, curseforge: "",
    release: {
        version: "0.3.0", tag: "v0.3.0", publishedAt: "2026-10-12T10:00:00Z",
        notes: "## Neu\n- **Duo-Modus** mit Partner-Anzeige\n- [Doku](https://example.org)",
        assets: [file("LevelHelper-0.3.0.zip", 389_120, "zip")],
    },
};
const sync: api.AddonCard = {
    id: "eventhelper-sync", name: "EventHelper Sync", description: "Sync-Tool und Addon.", icon: "inv_gizmo_01",
    versions: ["tbc", "forever"], install: "Im Sync-Tool den Token eintragen.", state: "ok", stale: false, errorCode: "", fetchedAt: 1, orgaOnly: true, curseforge: "",
    release: {
        version: "1.14.0", tag: "v1.14.0", publishedAt: "2026-10-10T12:00:00Z", notes: "",
        assets: [file("EventHelperSync.exe", 73_400_320, "exe"), file("EventHelperSync-1.14.0.zip", 90_000, "zip")],
    },
};
const professionkit: api.AddonCard = {
    id: "professionkit", name: "ProfessionKit", description: "Berufe-Guide.", icon: "trade_blacksmithing",
    versions: ["forever"], install: "", state: "no_release", stale: false, errorCode: "", fetchedAt: 1, orgaOnly: false, curseforge: "", release: null,
};

/** Where the router is now (path and hash). */
function Where() {
    const { pathname, hash } = useLocation();
    return <span data-testid="where">{`${pathname}${hash}`}</span>;
}

const data = (addons: api.AddonCard[], over: Partial<api.AddonsData> = {}): api.AddonsData => ({
    versionId: "forever", mainVersion: "forever", canManage: false, downloadLimit: 30, addons, ...over,
});

beforeEach(() => {
    vi.mocked(api.getAddons).mockResolvedValue(data([levelhelper, professionkit, sync]));
});
afterEach(() => switchLang("de"));

describe("page Addons", () => {
    it("shows one card per addon with version, date and the description", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByRole("heading", { name: "Addons", level: 1 })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "LevelHelper" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "ProfessionKit" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "EventHelper Sync" })).toBeInTheDocument();
        expect(screen.getByText("v0.3.0 · 12.10.2026")).toBeInTheDocument();
        expect(screen.getByText("Leveling-Helfer für WoW Forever.")).toBeInTheDocument();
    });

    it("marks an orga-only card with the chip Orga, and only that one", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        await screen.findByRole("heading", { name: "EventHelper Sync" });
        const chips = document.querySelectorAll(".orga-chip-lbl");
        expect(chips).toHaveLength(1);
        expect(chips[0].textContent).toBe("Orga");
        expect(chips[0].closest("section")).toHaveAttribute("data-addon", "eventhelper-sync");
        expect(chips[0]).toHaveAttribute("data-tip-sub", "Nur Admins und Orga-Rollen sehen und laden es.");
    });

    it("gives each card an anchor (#addon-<id>)", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        const card = (await screen.findByRole("heading", { name: "LevelHelper" })).closest("section");
        expect(card).toHaveAttribute("id", "addon-levelhelper");
        expect(screen.getByRole("heading", { name: "ProfessionKit" }).closest("section")).toHaveAttribute("id", "addon-professionkit");
    });

    it("sends an old Discord link (/addon#addon-<id>) on to the detail page", async () => {
        renderPage(<><AddonPage /><Where /></>, { route: "/addon#addon-levelhelper" });
        await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/addon\/levelhelper$/));
    });

    it("links each card with notes to all its patch notes on the detail page, and only those", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        const all = await screen.findByRole("link", { name: "Alle Patchnotes" });
        expect(all).toHaveAttribute("href", "/addon/levelhelper");
        expect(screen.getAllByRole("link", { name: "Alle Patchnotes" })).toHaveLength(1);
    });

    it("leaves GitHub's What's Changed block out of the card's notes", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddons).mockResolvedValue(data([{
            ...levelhelper,
            release: { ...levelhelper.release!, notes: "## Neu\n- Eigenes\n\n## What's Changed\n* PR by @x in #1\n\n**Full Changelog**: https://github.com/a/b/compare/v1...v2" },
        }]));
        renderPage(<AddonPage />, { route: "/addon" });
        await user.click(await screen.findByRole("button", { name: /Was ist neu\?/ }));
        expect(screen.getByText(/• Eigenes/)).toBeInTheDocument();
        expect(screen.queryByText(/What's Changed|Full Changelog|PR by/)).toBeNull();
    });

    it("links every download to the server route, with the file name and its size", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        const zip = await screen.findByRole("link", { name: "LevelHelper-0.3.0.zip · 380 KB" });
        expect(zip).toHaveAttribute("href", levelhelper.release!.assets[0].url);
        expect(zip.getAttribute("href")).toMatch(/^\/api\/addons\/download\?/);
        expect(zip).toHaveAttribute("download", "LevelHelper-0.3.0.zip");
        expect(screen.getByRole("link", { name: "EventHelperSync.exe · 70 MB" })).toBeInTheDocument();
        for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href") || "").not.toMatch(/github/i);
    });

    it("puts 'Auf CurseForge' next to the download of a card that has a link, also without a release, and nowhere else", async () => {
        const aura = "https://www.curseforge.com/wow/addons/pulse-aurakit";
        const macro = "https://www.curseforge.com/wow/addons/pulse-macrohelper";
        vi.mocked(api.getAddons).mockResolvedValue(data([
            { ...levelhelper, id: "aurakit", name: "AuraKit", curseforge: aura },
            { ...professionkit, id: "macrohelper", name: "MacroHelper", curseforge: macro },
            levelhelper,
        ]));
        renderPage(<AddonPage />, { route: "/addon" });
        const links = await screen.findAllByRole("link", { name: "Auf CurseForge" });
        expect(links.map((l) => [l.closest("section")?.getAttribute("data-addon"), l.getAttribute("href")])).toEqual([
            ["aurakit", aura], ["macrohelper", macro],
        ]);
        for (const l of links) {
            expect(l).toHaveAttribute("target", "_blank");
            expect(l).toHaveAttribute("rel", "noopener noreferrer");
            expect(l.closest(".dlp-files")).not.toBeNull();
        }
        // with a release it sits beside the download button
        expect(links[0].closest(".dlp-files")!.querySelector(".dlp-download")).not.toBeNull();
        expect(screen.getByText(/Noch kein Release/)).toBeInTheDocument();
    });

    it("speaks English on the CurseForge button", async () => {
        await switchLang("en");
        vi.mocked(api.getAddons).mockResolvedValue(data([{ ...levelhelper, curseforge: "https://www.curseforge.com/wow/addons/x" }]));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByRole("link", { name: "On CurseForge" })).toBeInTheDocument();
    });

    it("asks the server for the menu's game version", async () => {
        localStorage.removeItem("eh-content-version");
        renderPage(<AddonPage />, { route: "/addon", content: twoVersions() });
        await screen.findByRole("heading", { name: "LevelHelper" });
        expect(api.getAddons).toHaveBeenCalledWith("tbc");
    });

    it("folds the release notes open as plain text", async () => {
        const user = userEvent.setup();
        renderPage(<AddonPage />, { route: "/addon" });
        const toggle = await screen.findByRole("button", { name: /Was ist neu\?/ });
        expect(screen.queryByText(/Duo-Modus/)).toBeNull();
        await user.click(toggle);
        expect(screen.getByText(/• Duo-Modus mit Partner-Anzeige/)).toBeInTheDocument();
        // only the card with notes has the toggle
        expect(screen.getAllByRole("button", { name: /Was ist neu\?/ })).toHaveLength(1);
    });

    it("explains the installation per kind of file, with the version's folder and the admin's note", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        await screen.findByRole("heading", { name: "LevelHelper" });
        expect(screen.getAllByText(/_classic_beta_\\Interface\\AddOns\\/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Die exe starten/)).toBeInTheDocument();
        expect(screen.getByText("Im Sync-Tool den Token eintragen.")).toBeInTheDocument();
    });

    it("says when there is no release yet", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText(/Noch kein Release/)).toBeInTheDocument();
    });

    it("keeps the cached release with a hint when GitHub cannot be reached", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data([{ ...levelhelper, stale: true, errorCode: "unreachable" }]));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText(/GitHub ist gerade nicht erreichbar/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /LevelHelper-0.3.0.zip/ })).toBeInTheDocument();
    });

    it("tells a member only that the addon is not available when the token is missing", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data([{ ...levelhelper, state: "token_missing", release: null }]));
        renderPage(<AddonPage />, { route: "/addon", user: adminUser({ isAdmin: false }) });
        expect(await screen.findByText(/Gerade nicht verfügbar/)).toBeInTheDocument();
        expect(screen.queryByText(/GitHub-Token/)).toBeNull();
        expect(screen.queryByRole("link", { name: "Token einrichten" })).toBeNull();
    });

    it("shows an admin how to set the missing token", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data(
            [{ ...levelhelper, state: "token_missing", release: null, repo: "mst1987/levelhelper", private: true }],
            { canManage: true, tokenSet: false },
        ));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText(/private Repo mst1987\/levelhelper fehlt der GitHub-Token/)).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: "Token einrichten" })[0]).toHaveAttribute("href", "/settings/all?section=verbindungen");
    });

    it("names the version when it has no addons", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data([], { versionId: "tbc" }));
        renderPage(<AddonPage />, { route: "/addon", content: twoVersions() });
        expect(await screen.findByText("Für WoW TBC gibt es hier keine Addons.")).toBeInTheDocument();
    });

    it("tells a member on Classic which versions have addons, without the admin's way to the settings", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data([], {
            versionId: "classic",
            addonVersions: [{ id: "tbc", label: "WoW TBC" }, { id: "forever", label: "WoW Forever" }],
        }));
        const content = { ...twoVersions(), versions: [...twoVersions().versions, { id: "classic", label: "WoW Classic", short: "Classic" }] };
        renderPage(<AddonPage />, { route: "/addon", content, user: adminUser({ isAdmin: false }) });
        expect(await screen.findByText("Für WoW Classic gibt es hier keine Addons.")).toBeInTheDocument();
        expect(screen.getByText(/Addons gibt es für: WoW TBC, WoW Forever\./)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Addons einrichten" })).toBeNull();
    });

    it("shows an admin the way to Einstellungen -> Module -> Addons on an empty page", async () => {
        vi.mocked(api.getAddons).mockResolvedValue(data([], { versionId: "forever", canManage: true, tokenSet: true, addonVersions: [] }));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText(/gibt es hier keine Addons/)).toBeInTheDocument();
        expect(screen.queryByText(/Addons gibt es für/)).toBeNull();
        expect(screen.getByRole("link", { name: "Addons einrichten" })).toHaveAttribute("href", "/settings/all?section=addons");
    });

    it("never leaves the page blank: the cards carry no class an ad blocker hides", async () => {
        const { container } = renderPage(<AddonPage />, { route: "/addon" });
        await screen.findByRole("heading", { name: "LevelHelper" });
        const classes = [...container.querySelectorAll("[class]")].flatMap((el) => [...el.classList]);
        expect(classes.filter((c) => /^ads?-/.test(c))).toEqual([]);
        expect(container.querySelectorAll(".dlp-card")).toHaveLength(3);
    });

    it("shows the request error with a way to try again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddons).mockRejectedValueOnce(Object.assign(new Error("Kein Zugriff"), { status: 403 }));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText("Kein Zugriff")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("Die Addons konnten gerade nicht geladen werden.");
        await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
        expect(await screen.findByRole("heading", { name: "LevelHelper" })).toBeInTheDocument();
        expect(api.getAddons).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByRole("button", { name: /What's new\?/ })).toBeInTheDocument();
        expect(screen.getByText(/No release yet/)).toBeInTheDocument();
    });
});

describe("formatSize", () => {
    it("rounds to megabytes, below one megabyte to kilobytes, and leaves an unknown size empty", () => {
        expect(formatSize(73_400_320)).toBe("70 MB");
        expect(formatSize(1_572_864)).toMatch(/^1[.,]5 MB$/);
        expect(formatSize(389_120)).toBe("380 KB");
        expect(formatSize(100)).toBe("1 KB");
        expect(formatSize(0)).toBe("");
    });
});

describe("addon install helpers", () => {
    it("knows the addon folder of each version", () => {
        expect(addonFolder("forever")).toBe("<WoW>\\_classic_beta_\\Interface\\AddOns\\");
        expect(addonFolder("tbc")).toBe("<WoW>\\_anniversary_\\Interface\\AddOns\\");
        expect(addonFolder("unknown")).toContain("_classic_beta_");
    });

    it("turns Markdown notes into plain text (more in lib/addons/__tests__/addonInstall.test.ts)", () => {
        expect(plainNotes("## Neu\r\n\r\n\r\n* **fett** und `code`\n- [Link](https://x.y)")).toBe("Neu\n\n• fett und code\n• Link");
    });
});
