// "Mein Profil": der Stift an der eigenen Karte und der Tab „Alle Charaktere“,
// den nur die Orga sieht.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GameClass, GameSpec, ProfileCharacter, ProfileData, RaiderProfile } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import ProfilePage from "./ProfilePage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getProfile: vi.fn(),
    getCalendarTokens: vi.fn(),
    getLogCharacters: vi.fn(),
    editProfileCharacter: vi.fn(),
    getAllCharacters: vi.fn(),
    getRaiderAttendance: vi.fn(),
    getProfileRaiding: vi.fn(),
}));

function spec(classId: string, id: string, label: string, role: GameSpec["role"]): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank: role === "tank", canHeal: role === "healer" };
}
const DRUID: GameClass = { id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid", specs: [spec("Druid", "Restoration", "Wiederherstellung", "healer")] };

const GENTLE: ProfileCharacter = {
    key: "gentle", name: "Gentle", versionId: "tbc", realm: "", className: "Druid", source: "manual", armory: null, armoryUrl: "",
    specs: [], canOfftank: false, canHeal: false, suggested: { canOfftank: false, canHeal: true }, possible: { canOfftank: true, canHeal: true }, claimedBy: [],
};

function profile(characters: ProfileCharacter[]): RaiderProfile {
    return {
        userId: "u1", name: "Anna", characters, canOfftank: false, canHeal: false, suggested: { canOfftank: false, canHeal: false },
        availability: [], preferredRaids: [], wishes: [], avoidEnabled: false, avoid: [], note: "", updatedAt: 0,
    };
}

function data(characters: ProfileCharacter[]): ProfileData {
    return {
        profile: profile(characters), isNew: false, classes: [DRUID],
        roles: { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" }, raidGroups: [],
        weekdays: [], gearLevels: [{ id: "usable", label: "brauchbar" }], limits: { characters: 12, wishes: 3, avoid: 3, note: 200 },
    };
}

const RAIDER = { id: "u1", name: "Anna", isAdmin: false, isOrga: false, access: { signup: { read: true, write: true } } };
const ORGA = { id: "u9", name: "Orga", isAdmin: false, isOrga: true, access: { signup: { read: true, write: true }, roster: { read: true, write: true } } };

beforeEach(() => {
    vi.mocked(api.getProfile).mockResolvedValue(data([GENTLE]));
    vi.mocked(api.getCalendarTokens).mockResolvedValue({ tokens: [], max: 3, configured: true });
    vi.mocked(api.getLogCharacters).mockResolvedValue({ characters: [] });
    vi.mocked(api.getAllCharacters).mockResolvedValue({ raiders: [] });
    vi.mocked(api.getRaiderAttendance).mockResolvedValue({ userId: "u1", name: "Anna", own: true, orga: false, categories: [] });
    vi.mocked(api.getProfileRaiding).mockResolvedValue({ versionId: "tbc", rosters: [], characters: {} });
});

describe("ProfilePage: bearbeiten und Orga-Tab", () => {
    it("bearbeitet den eigenen Charakter über den Stift und zeigt den neuen Namen", async () => {
        const user = userEvent.setup();
        const renamed = { ...GENTLE, key: "blattwerk", name: "Blattwerk" };
        vi.mocked(api.editProfileCharacter).mockResolvedValue({
            character: renamed, renamed: { fromKey: "gentle", toKey: "blattwerk", fromName: "Gentle", toName: "Blattwerk", versionId: "tbc" },
            moved: { rosters: 0, assignments: 0, signups: 1, guildBank: 0, availability: 0 }, profile: profile([renamed]),
        });
        renderPage(<ProfilePage />, { user: RAIDER, route: "/profile?char=gentle" });
        await user.click(await screen.findByRole("button", { name: t("profile.char.edit") }));
        // the typos of this character are asked for
        expect(api.getLogCharacters).toHaveBeenCalledWith("", "gentle");
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("radio", { name: t("profile.edit.wayManual") }));
        const name = within(dialog).getByLabelText(t("profile.add.name"));
        await user.clear(name);
        await user.type(name, "Blattwerk");
        await user.click(within(dialog).getByRole("button", { name: t("profile.edit.save") }));
        expect(api.editProfileCharacter).toHaveBeenCalledWith("gentle", { name: "Blattwerk" });
        expect((await screen.findAllByText("Blattwerk")).length).toBeGreaterThan(0);
    });

    it("ein Raider sieht keinen Tab „Alle Charaktere“", async () => {
        renderPage(<ProfilePage />, { user: RAIDER });
        await screen.findByRole("tab", { name: t("profile.tabs.info") });
        expect(screen.queryByRole("tab", { name: t("profile.tabs.all") })).toBeNull();
    });

    it("die Orga wechselt in „Alle Charaktere“ (?view=all)", async () => {
        const user = userEvent.setup();
        renderPage(<ProfilePage />, { user: ORGA });
        await user.click(await screen.findByRole("tab", { name: t("profile.tabs.all") }));
        expect(await screen.findByText(t("profile.all.none"))).toBeInTheDocument();
        expect(api.getAllCharacters).toHaveBeenCalled();
        expect(screen.getByRole("tab", { name: t("profile.tabs.all") })).toHaveAttribute("aria-selected", "true");
    });
});
