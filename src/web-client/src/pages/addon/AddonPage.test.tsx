// The download page against a mocked API: version and date, both download
// links (GitHub's own), the release page link, the install hints, a release
// missing an asset, and the fallback when nothing could be loaded.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import { formatSize } from "../../lib/format";
import AddonPage from "./AddonPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getAddonRelease: vi.fn(),
}));

const FALLBACK = "https://github.com/mst1987/eventhelper-addon/releases/latest";
const release: api.AddonRelease = {
    version: "1.14.0",
    tag: "v1.14.0",
    url: "https://github.com/mst1987/eventhelper-addon/releases/tag/v1.14.0",
    publishedAt: "2026-10-10T12:00:00Z",
    exe: { name: "EventHelperSync.exe", url: "https://github.com/dl/EventHelperSync.exe", size: 73_400_320 },
    zip: { name: "EventHelperSync-1.14.0.zip", url: "https://github.com/dl/EventHelperSync-1.14.0.zip", size: 90_000 },
};

beforeEach(() => {
    vi.mocked(api.getAddonRelease).mockResolvedValue({ release, fallbackUrl: FALLBACK });
});
afterEach(() => switchLang("de"));

describe("addon download page", () => {
    it("shows version and date, links both files straight to GitHub and the release page", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByRole("heading", { name: "Sync-Tool & Addon" })).toBeInTheDocument();
        expect(screen.getByText("Version 1.14.0")).toBeInTheDocument();
        expect(screen.getByText(/veröffentlicht am/)).toBeInTheDocument();
        const exe = screen.getByRole("link", { name: "EventHelperSync.exe herunterladen" });
        expect(exe).toHaveAttribute("href", release.exe!.url);
        expect(screen.getByText("EventHelperSync.exe · 70 MB")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Addon herunterladen (.zip)" })).toHaveAttribute("href", release.zip!.url);
        expect(screen.getByRole("link", { name: "Was ist neu?" })).toHaveAttribute("href", release.url);
    });

    it("explains the first installation", async () => {
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText("Erste Installation")).toBeInTheDocument();
        expect(screen.getByText(/_anniversary_\/Interface\/AddOns/)).toBeInTheDocument();
        expect(screen.getByText(/Einstellungen → Loot-Sync/)).toBeInTheDocument();
        expect(screen.getByText(/Ab Version 1.14.0 aktualisiert sich das Sync-Tool selbst/)).toBeInTheDocument();
    });

    it("says so when a release lacks one of the files", async () => {
        vi.mocked(api.getAddonRelease).mockResolvedValue({ release: { ...release, exe: null }, fallbackUrl: FALLBACK });
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText(/gibt es diese Datei nicht/)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /EventHelperSync.exe herunterladen/ })).toBeNull();
        expect(screen.getByRole("link", { name: "Addon herunterladen (.zip)" })).toBeInTheDocument();
    });

    it("offers the releases page when no release could be loaded", async () => {
        vi.mocked(api.getAddonRelease).mockResolvedValue({ release: null, fallbackUrl: FALLBACK });
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText("Die neueste Version konnte gerade nicht geladen werden")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zur Release-Seite" })).toHaveAttribute("href", FALLBACK);
    });

    it("shows the request error", async () => {
        vi.mocked(api.getAddonRelease).mockRejectedValue(Object.assign(new Error("Kein Zugriff"), { status: 403 }));
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByText("Kein Zugriff")).toBeInTheDocument();
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<AddonPage />, { route: "/addon" });
        expect(await screen.findByRole("link", { name: "Download addon (.zip)" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "What's new?" })).toBeInTheDocument();
    });
});

describe("formatSize", () => {
    it("rounds to megabytes and leaves an unknown size empty", () => {
        expect(formatSize(73_400_320)).toBe("70 MB");
        expect(formatSize(1_572_864)).toMatch(/^1[.,]5 MB$/);
        expect(formatSize(0)).toBe("");
    });
});