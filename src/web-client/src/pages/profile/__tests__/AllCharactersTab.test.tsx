// "Alle Charaktere" der Orga: Liste, Filter, Karte öffnen, bearbeiten über
// den gemeinsamen Dialog — gegen eine gemockte API.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { CharacterOwner, GameClass, GameSpec, ProfileCharacter, ProfileData } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import AllCharactersTab from "../AllCharactersTab";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getAllCharacters: vi.fn(),
    editCharacterOf: vi.fn(),
    saveCharacterOf: vi.fn(),
    removeCharacterOf: vi.fn(),
    getLogCharactersOf: vi.fn(),
}));

function spec(classId: string, id: string, label: string, role: GameSpec["role"]): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank: role === "tank", canHeal: role === "healer" };
}
const DRUID: GameClass = { id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid", specs: [spec("Druid", "Restoration", "Wiederherstellung", "healer")] };
const MAGE: GameClass = { id: "Mage", label: "Magier", color: "#69ccf0", icon: "classicon_mage", specs: [spec("Mage", "Frost", "Frost", "ranged")] };

function char(over: Partial<ProfileCharacter>): ProfileCharacter {
    return {
        key: "x", name: "X", versionId: "tbc", realm: "", className: "Mage", source: "manual", armory: null, armoryUrl: "",
        evidence: { verified: true, via: "log" }, specs: [], canOfftank: false, canHeal: false,
        suggested: { canOfftank: false, canHeal: false }, possible: { canOfftank: false, canHeal: false }, claimedBy: [],
        ...over,
    };
}

const ANNA: CharacterOwner = { userId: "u1", name: "Anna", characters: [char({ key: "gentle", name: "Gentle", className: "Druid", evidence: { verified: false, via: "" } })] };
const BERT: CharacterOwner = { userId: "u2", name: "Bert", characters: [char({ key: "nera", name: "Nera" })] };

const DATA = {
    classes: [DRUID, MAGE], roles: { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" },
    gearLevels: [{ id: "none", label: "keins" }, { id: "usable", label: "brauchbar" }, { id: "ready", label: "raidbereit" }],
} as unknown as ProfileData;

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getAllCharacters).mockResolvedValue({ raiders: [ANNA, BERT] });
    vi.mocked(api.getLogCharactersOf).mockResolvedValue({ characters: [{ character: "Gentlê", className: "Druid", specKey: "", reports: 2, lastSeen: 0, match: "similar", claimedBy: [] }] });
});

describe("AllCharactersTab", () => {
    it("listet jeden Charakter mit Raider und Status; „nur ungeprüfte“ filtert", async () => {
        const user = userEvent.setup();
        renderPage(<AllCharactersTab data={DATA} canWrite />);
        await screen.findByText("Gentle");
        expect(screen.getByText("Nera")).toBeInTheDocument();
        expect(screen.getByText("Anna")).toBeInTheDocument();
        expect(screen.getByText(t("profile.char.unverified"))).toBeInTheDocument();
        expect(screen.getByText(t("profile.all.count", { count: 2 }))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("profile.all.onlyUnverified", { count: 1 }) }));
        expect(screen.queryByText("Nera")).toBeNull();
        expect(screen.getByText("Gentle")).toBeInTheDocument();
    });

    it("ordnet über den Stift einen Log-Charakter zu und tauscht den Raider aus", async () => {
        const user = userEvent.setup();
        const renamed = { ...ANNA, characters: [char({ key: "gentlê", name: "Gentlê", className: "Druid", source: "log" })] };
        vi.mocked(api.editCharacterOf).mockResolvedValue({
            key: "gentlê", renamed: { fromKey: "gentle", toKey: "gentlê", fromName: "Gentle", toName: "Gentlê", versionId: "tbc" },
            moved: { rosters: 1, assignments: 0, signups: 2, guildBank: 0, availability: 0 }, raider: renamed,
        });
        renderPage(<AllCharactersTab data={DATA} canWrite />);
        const row = (await screen.findByText("Gentle")).closest("tr") as HTMLElement;
        await user.click(within(row).getByRole("button", { name: t("profile.char.edit") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("profile.edit.kickerOf", { owner: "Anna" }))).toBeInTheDocument();
        await user.click(await within(dialog).findByRole("button", { name: t("profile.edit.pick") }));
        expect(api.getLogCharactersOf).toHaveBeenCalledWith("u1", "gentle", "");
        expect(api.editCharacterOf).toHaveBeenCalledWith("u1", "gentle", { fromLog: "Gentlê" });
        expect(await screen.findByText("Gentlê")).toBeInTheDocument();
        expect(screen.queryByText("Gentle")).toBeNull();
    });

    it("öffnet per Klick die Karte und speichert Gear für den Raider", async () => {
        const user = userEvent.setup();
        const withSpec = { ...BERT, characters: [char({ key: "nera", name: "Nera", specs: [{ key: "Mage-Frost", gear: "usable", label: "Frost", specId: "Frost", role: "ranged", icon: "icon_Frost", canTank: false, canHeal: false, logs: { status: "unknown", reports: 0 } }] })] };
        vi.mocked(api.getAllCharacters).mockResolvedValue({ raiders: [withSpec] });
        vi.mocked(api.saveCharacterOf).mockResolvedValue({ raider: withSpec });
        renderPage(<AllCharactersTab data={DATA} canWrite />);
        await user.click(await screen.findByText("Nera"));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("radio", { name: "raidbereit" }));
        await waitFor(() => expect(api.saveCharacterOf).toHaveBeenCalledWith("u2", "nera", { specs: [{ key: "Mage-Frost", gear: "ready" }] }));
    });

    it("nimmt über den Mülleimer in der Zeile einen vertippten Charakter nach Rückfrage heraus", async () => {
        const user = userEvent.setup();
        const twice = { ...ANNA, characters: [...ANNA.characters, char({ key: "gentel", name: "Gentel", className: "Druid" })] };
        vi.mocked(api.getAllCharacters).mockResolvedValue({ raiders: [twice, BERT] });
        vi.mocked(api.removeCharacterOf).mockResolvedValue({ raider: ANNA });
        renderPage(<AllCharactersTab data={DATA} canWrite />);
        const row = (await screen.findByText("Gentel")).closest("tr") as HTMLElement;
        await user.click(within(row).getByRole("button", { name: `${t("profile.char.remove")}: Gentel` }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("profile.all.removeTitle", { name: "Gentel", owner: "Anna" }))).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: t("profile.remove.action") }));
        expect(api.removeCharacterOf).toHaveBeenCalledWith("u1", "gentel");
        await waitFor(() => expect(screen.queryByText("Gentel")).toBeNull());
        expect(screen.getByText("Gentle")).toBeInTheDocument();
    });

    it("ohne Schreibrecht: nur lesen, kein Stift, kein Mülleimer", async () => {
        renderPage(<AllCharactersTab data={DATA} canWrite={false} />);
        await screen.findByText("Gentle");
        expect(screen.queryByRole("button", { name: t("profile.char.edit") })).toBeNull();
        expect(screen.queryByRole("button", { name: `${t("profile.char.remove")}: Gentle` })).toBeNull();
    });
});
