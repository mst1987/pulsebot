// What the settings page hands the main menu (settingsNav.ts): the badge of a
// section, a publish that only wakes listeners on a real change, and the one
// load the menu does by itself when the page never published.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { getSettingsNav, loadSettingsNav, publishSettingsNav, resetSettingsNav, sectionBadge } from "./settingsNav";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getSettings: vi.fn(),
    getIngestTokens: vi.fn(),
}));

beforeEach(() => {
    resetSettingsNav();
    vi.mocked(api.getSettings).mockReset();
    vi.mocked(api.getIngestTokens).mockReset();
});

describe("sectionBadge", () => {
    const counts = { verbindungen: 2, discordserver: 1, kategorien: 3 };

    it("gives the three counted sections their badge and tone, the rest none", () => {
        expect(sectionBadge("verbindungen", counts)).toEqual({ count: 2, tone: "mid", tip: "2 Verbindungen nicht eingerichtet" });
        expect(sectionBadge("discordserver", counts)).toMatchObject({ count: 1, tone: "mid" });
        expect(sectionBadge("kategorien", counts)).toEqual({ count: 3, tip: "3 aktive Raid-Kategorien" });
        expect(sectionBadge("logs", counts)).toBeNull();
        expect(sectionBadge("verbindungen", null)).toBeNull();
    });
});

describe("publishSettingsNav", () => {
    it("keeps the same state object when nothing changed", () => {
        publishSettingsNav({ active: "logs", counts: { verbindungen: 0, discordserver: 0, kategorien: 1 } });
        const before = getSettingsNav();
        publishSettingsNav({ active: "logs", counts: { verbindungen: 0, discordserver: 0, kategorien: 1 } });
        expect(getSettingsNav()).toBe(before);
        publishSettingsNav({ active: null });
        expect(getSettingsNav()).toEqual({ active: null, counts: { verbindungen: 0, discordserver: 0, kategorien: 1 } });
    });
});

describe("loadSettingsNav", () => {
    it("leaves the badges out when the settings cannot be loaded", async () => {
        vi.mocked(api.getSettings).mockRejectedValue(new Error("403"));
        await loadSettingsNav(true);
        expect(getSettingsNav().counts).toBeNull();
    });

    it("does not overwrite what the page published meanwhile", async () => {
        let resolve: (v: Awaited<ReturnType<typeof api.getSettings>>) => void = () => undefined;
        vi.mocked(api.getSettings).mockReturnValue(new Promise((r) => { resolve = r; }));
        const loading = loadSettingsNav(false);
        publishSettingsNav({ counts: { verbindungen: 9, discordserver: 0, kategorien: 0 } });
        resolve({ config: { categoryIds: [] }, canManageAccess: false, servers: null } as unknown as Awaited<ReturnType<typeof api.getSettings>>);
        await loading;
        expect(getSettingsNav().counts).toEqual({ verbindungen: 9, discordserver: 0, kategorien: 0 });
        expect(api.getIngestTokens).not.toHaveBeenCalled();
    });
});
