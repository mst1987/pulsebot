// "Charakter hinzufügen" (#255): the three ways in one dialog, and what each
// sends. The API is mocked; the dialog is rendered on its own.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GameClass, GameSpec, ProfileCharacter, RaiderProfile } from "../../api";
import { t } from "../../i18n";
import AddCharacterDialog, { type AddWay } from "./AddCharacterDialog";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getLogCharacters: vi.fn(),
    addProfileCharacter: vi.fn(),
}));

function spec(classId: string, id: string, label: string, role: GameSpec["role"]): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank: role === "tank", canHeal: role === "healer" };
}

const CLASSES: GameClass[] = [
    { id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid", specs: [spec("Druid", "Guardian", "Wächter", "tank"), spec("Druid", "Restoration", "Wiederherstellung", "healer")] },
    { id: "Mage", label: "Magier", color: "#69ccf0", icon: "classicon_mage", specs: [spec("Mage", "Frost", "Frost", "ranged")] },
];

const PROFILE = { userId: "u1", characters: [] } as unknown as RaiderProfile;
const ADDED = { key: "new-char" } as ProfileCharacter;

function renderDialog(way: AddWay) {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(<AddCharacterDialog way={way} onClose={onClose} classes={CLASSES} onAdded={onAdded} />);
    return { onAdded, onClose, user: userEvent.setup() };
}

const nameField = () => screen.getByLabelText(t("profile.add.name"));

beforeEach(() => {
    vi.mocked(api.getLogCharacters).mockResolvedValue({
        characters: [
            { character: "Borka", className: "Druid", specKey: "Druid-Guardian", reports: 3, lastSeen: 0, match: "assigned", claimedBy: [] },
            { character: "Frosti", className: "Mage", specKey: "Mage-Frost", reports: 1, lastSeen: 0, match: "", claimedBy: [{ userId: "u9", name: "Ann" }] },
        ],
    });
    vi.mocked(api.addProfileCharacter).mockResolvedValue({ character: ADDED, armory: null, profile: PROFILE });
});

describe("AddCharacterDialog", () => {
    it("offers the three ways in one segment: logs, armory, by hand", () => {
        renderDialog("log");
        const ways = screen.getByRole("radiogroup", { name: t("profile.add.wayAria") });
        expect(within(ways).getAllByRole("radio").map((r) => r.textContent)).toEqual(
            [t("profile.add.wayLog"), t("profile.add.wayArmory"), t("profile.add.wayManual")],
        );
    });

    it("adds a character from the logs with „Das bin ich“, marking one another account already has", async () => {
        const { user, onAdded } = renderDialog("log");
        await screen.findByText("Borka");
        expect(screen.getByText(t("profile.add.matchAssigned"))).toBeInTheDocument();
        const claimed = screen.getByText(t("profile.add.claimed"));
        expect(claimed).toHaveAttribute("data-tip-sub", t("profile.add.claimedSub", { names: "Ann" }));

        const buttons = screen.getAllByRole("button", { name: "Das bin ich" });
        expect(buttons).toHaveLength(2);
        await user.click(buttons[1]);
        expect(api.addProfileCharacter).toHaveBeenCalledWith({ source: "log", name: "Frosti" });
        await waitFor(() => expect(onAdded).toHaveBeenCalledWith(PROFILE, "new-char"));
    });

    it("links an armory character, and asks for the class when the armory cannot tell it", async () => {
        vi.mocked(api.addProfileCharacter).mockRejectedValueOnce(Object.assign(new Error("Klasse unbekannt"), { code: "class_required" }));
        const { user, onAdded } = renderDialog("armory");

        const link = screen.getByRole("button", { name: t("profile.add.link") });
        expect(link).toBeDisabled();
        await user.type(nameField(), "Borka");
        await user.type(screen.getByLabelText(t("profile.add.realm")), "Thunderstrike");
        expect(screen.queryByRole("button", { name: /Druide/ })).not.toBeInTheDocument();
        await user.click(link);
        expect(api.addProfileCharacter).toHaveBeenLastCalledWith({ source: "armory", name: "Borka", realm: "Thunderstrike", className: undefined });

        // the class picker appears with the server's message, and the button waits for a class
        expect(await screen.findByText("Klasse unbekannt")).toBeInTheDocument();
        expect(link).toBeDisabled();
        await user.click(screen.getByRole("button", { name: /Druide/ }));
        await user.click(link);
        expect(api.addProfileCharacter).toHaveBeenLastCalledWith({ source: "armory", name: "Borka", realm: "Thunderstrike", className: "Druid" });
        await waitFor(() => expect(onAdded).toHaveBeenCalledWith(PROFILE, "new-char"));
    });

    it("creates a character by hand with its class and specs", async () => {
        const { user } = renderDialog("manual");
        const create = screen.getByRole("button", { name: t("profile.add.create") });
        await user.type(nameField(), "Borka");
        expect(create).toBeDisabled();

        await user.click(screen.getByRole("button", { name: /Druide/ }));
        await user.click(screen.getByRole("button", { name: /Wiederherstellung/ }));
        expect(create).toBeEnabled();
        await user.click(create);
        expect(api.addProfileCharacter).toHaveBeenCalledWith({ source: "manual", name: "Borka", className: "Druid", specs: ["Druid-Restoration"] });
    });
});

describe("AddCharacterDialog je Spielversion (#543)", () => {
    const VERSIONS = [
        { id: "tbc", label: "TBC Anniversary", short: "TBC", lastName: false },
        { id: "forever", label: "WoW Forever", short: "Forever", lastName: true },
    ];
    const FOREVER_CLASSES: GameClass[] = [CLASSES[1]];

    function renderVersioned(defaultVersion = "tbc") {
        const onAdded = vi.fn();
        render(<AddCharacterDialog way="manual" onClose={vi.fn()} classes={CLASSES} onAdded={onAdded}
            versions={VERSIONS} classesByVersion={{ tbc: CLASSES, forever: FOREVER_CLASSES }} defaultVersion={defaultVersion} />);
        return { onAdded, user: userEvent.setup() };
    }

    it("fragt die Version, die Hauptversion vorgewählt", () => {
        renderVersioned("forever");
        const picker = screen.getByRole("radiogroup", { name: t("profile.add.versionAria") });
        expect(within(picker).getAllByRole("radio").map((r) => r.textContent)).toEqual(["TBC", "Forever"]);
        expect(within(picker).getByRole("radio", { name: "Forever" })).toHaveAttribute("aria-checked", "true");
        // Forever: first and last name, the classes of its rule set
        expect(screen.getByLabelText(t("profile.add.firstName"))).toBeInTheDocument();
        expect(screen.getByLabelText(t("profile.add.lastName"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Druide/ })).not.toBeInTheDocument();
    });

    it("legt einen Forever-Charakter mit Vor- und Nachnamen an", async () => {
        const { user } = renderVersioned("forever");
        await user.type(screen.getByLabelText(t("profile.add.firstName")), "Devi");
        await user.type(screen.getByLabelText(t("profile.add.lastName")), "Res");
        await user.click(screen.getByRole("button", { name: /Magier/ }));
        await user.click(screen.getByRole("button", { name: t("profile.add.create") }));
        expect(api.addProfileCharacter).toHaveBeenLastCalledWith({ source: "manual", name: "Devi Res", className: "Mage", specs: [], versionId: "forever" });
    });

    it("TBC hat ein Namensfeld mit höchstens 12 Buchstaben", async () => {
        const { user } = renderVersioned("tbc");
        expect(screen.queryByLabelText(t("profile.add.lastName"))).not.toBeInTheDocument();
        expect(nameField()).toHaveAttribute("maxLength", "12");
        await user.type(nameField(), "Devi");
        await user.click(screen.getByRole("button", { name: /Druide/ }));
        await user.click(screen.getByRole("button", { name: t("profile.add.create") }));
        expect(api.addProfileCharacter).toHaveBeenLastCalledWith({ source: "manual", name: "Devi", className: "Druid", specs: [], versionId: "tbc" });
    });

    it("ein Versionswechsel setzt Klasse und Nachnamen zurück", async () => {
        const { user } = renderVersioned("forever");
        await user.type(screen.getByLabelText(t("profile.add.lastName")), "Res");
        await user.click(screen.getByRole("button", { name: /Magier/ }));
        await user.click(screen.getByRole("radio", { name: "TBC" }));
        expect(screen.queryByLabelText(t("profile.add.lastName"))).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("profile.add.create") })).toBeDisabled();
    });
});
