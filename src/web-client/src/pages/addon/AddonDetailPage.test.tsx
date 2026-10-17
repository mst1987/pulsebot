// The detail page /addon/<id> against a mocked API: the head with the version
// badge and the downloads (the server's route), the meta line, the patch notes
// as groups (text only, GitHub's block cut off), the install steps, and the
// states: unknown addon, no release, request error.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { switchLang } from "../../test/i18n";
import { adminUser, renderPage, twoVersions } from "../../test/render";
import AddonDetailPage from "./AddonDetailPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getAddonDetail: vi.fn(),
}));

const NOTES = [
    "## Neu",
    "- **Totenkopf am Zielknopf:** Der Zielknopf markiert Gegner.",
    "## Verbessert",
    "- Grind-Fenster bleibt offen. Danach `/reload`.",
    "## Behoben",
    "- Munition wurde doppelt gezählt.",
    "## Hinweise",
    "- <img src=x onerror=alert(1)> und [Doku](https://example.org/doku)",
    "## What's Changed",
    "* PR by @x in https://github.com/mst1987/levelhelper/pull/1",
    "**Full Changelog**: https://github.com/mst1987/levelhelper/compare/v0.5.1...v0.6.0",
].join("\n");

const levelhelper: api.AddonCard = {
    id: "levelhelper", name: "LevelHelper", description: "Leveling-Helfer für WoW Forever.", icon: "inv_misc_map02",
    versions: ["forever"], install: "", state: "ok", stale: false, errorCode: "", fetchedAt: 1, orgaOnly: false, curseforge: "",
    release: {
        version: "0.6.0", tag: "v0.6.0", publishedAt: "2026-10-16T10:00:00Z", notes: NOTES,
        assets: [{ name: "LevelHelper-0.6.0.zip", size: 574_464, sha256: "ab".repeat(32), kind: "zip", url: "/api/addons/download?addon=levelhelper&asset=LevelHelper-0.6.0.zip" }],
    },
};

const detail = (addon: api.AddonCard = levelhelper, over: Partial<api.AddonDetailData> = {}): api.AddonDetailData => ({
    canManage: false, downloadLimit: 30, addon, versions: [{ id: "forever", label: "WoW Forever" }], ...over,
});

const open = (id = "levelhelper") => renderPage(<AddonDetailPage />, { route: `/addon/${id}`, path: "/addon/:addonId" });

beforeEach(() => {
    vi.mocked(api.getAddonDetail).mockResolvedValue(detail());
});
afterEach(() => switchLang("de"));

describe("page Addon-Detail", () => {
    it("asks for the addon of the address and shows its head: kicker, version badge, title, description", async () => {
        open();
        const hero = (await screen.findByRole("heading", { name: "LevelHelper", level: 1 })).closest("section")!;
        expect(api.getAddonDetail).toHaveBeenCalledWith("levelhelper");
        expect(within(hero).getByText("Addon")).toBeInTheDocument();
        expect(hero.querySelector(".badge.dlpd-ver.ver-forever")).toHaveTextContent("WoW Forever");
        expect(within(hero).getByText("Leveling-Helfer für WoW Forever.")).toBeInTheDocument();
    });

    it("offers the way back and the download through the server route, with name, size and checksum", async () => {
        open();
        expect(await screen.findByRole("link", { name: "Alle Addons" })).toHaveAttribute("href", "/addon");
        const zip = screen.getByRole("link", { name: "LevelHelper-0.6.0.zip · 561 KB" });
        expect(zip).toHaveAttribute("href", "/api/addons/download?addon=levelhelper&asset=LevelHelper-0.6.0.zip");
        expect(zip).toHaveAttribute("download", "LevelHelper-0.6.0.zip");
        expect(zip).toHaveAttribute("data-tip-sub", "ab".repeat(32));
        for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href") || "").not.toMatch(/github|example\.org/i);
    });

    it("shows version, date and game in the meta line, and no reload claim of its own", async () => {
        open();
        await screen.findByRole("heading", { name: "LevelHelper", level: 1 });
        const meta = document.querySelector(".dlpd-meta") as HTMLElement;
        expect(within(meta).getByText("0.6.0")).toBeInTheDocument();
        expect(within(meta).getAllByText("16.10.2026")).toHaveLength(1);
        expect(within(meta).getByText("WoW Forever")).toBeInTheDocument();
        expect(meta.querySelectorAll("dt")).toHaveLength(3);
        expect(meta.textContent).not.toMatch(/reload|Nach dem Update/);
    });

    it("shows the patch notes as coloured groups, bold and code as such, without GitHub's block", async () => {
        open();
        const notes = await screen.findByRole("region", { name: "Patchnotes" });
        expect(within(notes).getByRole("heading", { name: "Version 0.6.0", level: 2 })).toBeInTheDocument();
        const heads = within(notes).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
        expect(heads).toEqual(["Neu", "Verbessert", "Behoben", "Hinweise"]);
        expect(notes.querySelector(".dlpd-g-new")).not.toBeNull();
        expect(notes.querySelector(".dlpd-g-better")).not.toBeNull();
        expect(notes.querySelector(".dlpd-g-fixed")).not.toBeNull();
        expect(notes.querySelector(".dlpd-g-other")).not.toBeNull();
        expect(within(notes).getByText("Totenkopf am Zielknopf:").tagName).toBe("B");
        expect(within(notes).getAllByText("/reload").some((el) => el.tagName === "CODE")).toBe(true);
        expect(notes.textContent).not.toMatch(/What's Changed|Full Changelog|PR by/);
    });

    it("adds no reload hint of its own under the notes", async () => {
        vi.mocked(api.getAddonDetail).mockResolvedValue(detail({ ...levelhelper, release: { ...levelhelper.release!, notes: "## Neu\n- Eins" } }));
        open();
        const notes = await screen.findByRole("region", { name: "Patchnotes" });
        expect(notes.textContent).not.toMatch(/reload/);
    });

    it("never renders markup or a link from the notes", async () => {
        open();
        const notes = await screen.findByRole("region", { name: "Patchnotes" });
        expect(notes.querySelector("img")).toBeNull();
        expect(notes.querySelector("a")).toBeNull();
        expect(within(notes).getByText(/<img src=x onerror=alert\(1\)> und Doku/)).toBeInTheDocument();
    });

    it("explains the installation with the addon's version folder and states the download limit", async () => {
        open();
        expect(await screen.findByText(/_classic_beta_\\Interface\\AddOns\\/)).toBeInTheDocument();
        expect(screen.getByText("Herunterladen nur nach dem Login, höchstens 30 Downloads pro Stunde.")).toBeInTheDocument();
    });

    describe("an addon for two versions (EventHelper Sync: TBC and Forever)", () => {
        const sync = { ...levelhelper, id: "eventhelper-sync", name: "EventHelper Sync", versions: ["tbc", "forever"] };
        const twoVersioned = detail(sync, { versions: [{ id: "tbc", label: "WoW TBC" }, { id: "forever", label: "WoW Forever" }] });
        beforeEach(() => {
            vi.mocked(api.getAddonDetail).mockResolvedValue(twoVersioned);
            localStorage.removeItem("eh-content-version");
        });

        it("names the folder of the menu's version when the addon is for it", async () => {
            renderPage(<AddonDetailPage />, { route: "/addon/eventhelper-sync", path: "/addon/:addonId", content: twoVersions({ mainVersion: "forever" }) });
            const step = await screen.findByText(/Die Zip nach/);
            expect(step.textContent).toContain("_classic_beta_");
            expect(step.textContent).not.toContain("_anniversary_");
        });

        it("names every version's folder when the menu shows none of them", async () => {
            open("eventhelper-sync");
            const step = await screen.findByText(/Die Zip nach/);
            expect(step.textContent).toContain("<WoW>\\_anniversary_\\Interface\\AddOns\\ (WoW TBC) oder <WoW>\\_classic_beta_\\Interface\\AddOns\\ (WoW Forever)");
        });
    });

    it("offers the CurseForge page next to the download in a new tab, only when the addon has one", async () => {
        const cf = "https://www.curseforge.com/wow/addons/pulse-aurakit";
        vi.mocked(api.getAddonDetail).mockResolvedValue(detail({ ...levelhelper, curseforge: cf }));
        open();
        const link = await screen.findByRole("link", { name: "Auf CurseForge" });
        expect(link).toHaveAttribute("href", cf);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link.closest(".dlpd-actions")).not.toBeNull();
        // the download stays the server's route
        expect(screen.getByRole("link", { name: "LevelHelper-0.6.0.zip · 561 KB" })).toHaveAttribute("href", "/api/addons/download?addon=levelhelper&asset=LevelHelper-0.6.0.zip");
    });

    it("shows the CurseForge page also without a release", async () => {
        const cf = "https://www.curseforge.com/wow/addons/pulse-macrohelper";
        vi.mocked(api.getAddonDetail).mockResolvedValue(detail({ ...levelhelper, id: "macrohelper", name: "MacroHelper", state: "no_release", release: null, curseforge: cf }));
        open("macrohelper");
        expect(await screen.findByRole("link", { name: "Auf CurseForge" })).toHaveAttribute("href", cf);
    });

    it("has no CurseForge button for an addon without a link", async () => {
        open();
        await screen.findByRole("heading", { name: "LevelHelper", level: 1 });
        expect(screen.queryByRole("link", { name: "Auf CurseForge" })).toBeNull();
        expect(document.querySelector(".dlp-curseforge")).toBeNull();
    });

    it("keeps the head without a release, but leaves downloads, notes and install out", async () => {
        vi.mocked(api.getAddonDetail).mockResolvedValue(detail({ ...levelhelper, id: "macrohelper", name: "MacroHelper", state: "no_release", release: null }));
        open("macrohelper");
        expect(await screen.findByRole("heading", { name: "MacroHelper", level: 1 })).toBeInTheDocument();
        expect(screen.getByText(/Noch kein Release/)).toBeInTheDocument();
        expect(screen.getByText("noch nicht")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Alle Addons" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Patchnotes" })).toBeNull();
        expect(screen.queryByText("Installation")).toBeNull();
        expect(document.querySelector(".dlp-download")).toBeNull();
    });

    it("tells a member only that the addon is unavailable when GitHub fails without a cached release", async () => {
        vi.mocked(api.getAddonDetail).mockResolvedValue(detail({ ...levelhelper, state: "error", errorCode: "unreachable", release: null }));
        renderPage(<AddonDetailPage />, { route: "/addon/levelhelper", path: "/addon/:addonId", user: adminUser({ isAdmin: false }) });
        expect(await screen.findByText(/Gerade nicht verfügbar/)).toBeInTheDocument();
    });

    it("says so for an unknown or hidden addon, with the way back", async () => {
        vi.mocked(api.getAddonDetail).mockRejectedValue({ code: "unknown_addon", message: "Dieses Addon gibt es nicht." });
        open("nope");
        expect(await screen.findByText("Dieses Addon gibt es hier nicht (mehr).")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Alle Addons" })).toHaveAttribute("href", "/addon");
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows another error with a way to try again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonDetail).mockRejectedValueOnce({ code: "http_500", message: "Serverfehler" });
        open();
        expect(await screen.findByRole("alert")).toHaveTextContent("Serverfehler");
        await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
        expect(await screen.findByRole("heading", { name: "LevelHelper", level: 1 })).toBeInTheDocument();
    });

    it("carries no class an ad blocker hides", async () => {
        const { container } = open();
        await screen.findByRole("heading", { name: "LevelHelper", level: 1 });
        const classes = [...container.querySelectorAll("[class]")].flatMap((el) => [...el.classList]);
        expect(classes.filter((c) => /^ads?-/.test(c))).toEqual([]);
    });

    it("speaks English", async () => {
        await switchLang("en");
        open();
        expect(await screen.findByRole("link", { name: "All addons" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Patch notes" })).toBeInTheDocument();
        expect(screen.getByText("Published")).toBeInTheDocument();
    });
});
