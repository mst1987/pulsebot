// "Charakter bearbeiten": aus den Logs wählen (ähnliche Namen zuerst) oder von
// Hand ändern — und was der Dialog dann an `onSave` gibt.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GameClass, GameSpec, LogCharacterSuggestion, ProfileCharacter } from "../../api";
import { t } from "../../i18n";
import EditCharacterDialog from "./EditCharacterDialog";

function spec(classId: string, id: string, label: string, role: GameSpec["role"]): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank: role === "tank", canHeal: role === "healer" };
}

const CLASSES: GameClass[] = [
    { id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid", specs: [spec("Druid", "Guardian", "Wächter", "tank"), spec("Druid", "Restoration", "Wiederherstellung", "healer")] },
    { id: "Shaman", label: "Schamane", color: "#0070de", icon: "classicon_shaman", specs: [spec("Shaman", "Restoration", "Wiederherstellung", "healer")] },
];

const GENTLE: ProfileCharacter = {
    key: "gentle", name: "Gentle", versionId: "tbc", realm: "", className: "Druid", source: "manual", armory: null, armoryUrl: "",
    specs: [{ key: "Druid-Restoration", gear: "ready", label: "Wiederherstellung", specId: "Restoration", role: "healer", icon: "icon_Restoration", canTank: false, canHeal: true, logs: { status: "unknown", reports: 0 } }],
    canOfftank: false, canHeal: true, suggested: { canOfftank: false, canHeal: true }, possible: { canOfftank: true, canHeal: true }, claimedBy: [],
};

const LOGGED: LogCharacterSuggestion[] = [
    { character: "Gentlê", className: "Druid", specKey: "Druid-Restoration", reports: 4, lastSeen: 0, match: "similar", claimedBy: [] },
    { character: "Zeta", className: "Shaman", specKey: "", reports: 1, lastSeen: 0, match: "", claimedBy: [] },
];

function renderDialog(over: Partial<Parameters<typeof EditCharacterDialog>[0]> = {}) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const loadLog = vi.fn().mockResolvedValue({ characters: LOGGED });
    render(<EditCharacterDialog character={GENTLE} classes={CLASSES} loadLog={loadLog} onSave={onSave} onClose={() => undefined} {...over} />);
    return { onSave, loadLog, user: userEvent.setup() };
}

describe("EditCharacterDialog", () => {
    it("öffnet mit „Aus den Logs“: ähnlich geschriebene Namen markiert, ein Klick ordnet zu", async () => {
        const { user, onSave, loadLog } = renderDialog();
        const row = (await screen.findByText("Gentlê")).closest(".pf-logrow") as HTMLElement;
        expect(loadLog).toHaveBeenCalledWith("");
        expect(within(row).getByText(t("profile.add.matchSimilar"))).toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: t("profile.edit.pick") }));
        expect(onSave).toHaveBeenCalledWith({ fromLog: "Gentlê" });
        // a new name is announced before it is saved
        expect(screen.getByText(t("profile.edit.renameHint", { from: "Gentle" }))).toBeInTheDocument();
    });

    it("von Hand: schickt nur, was sich geändert hat", async () => {
        const { user, onSave } = renderDialog();
        await user.click(screen.getByRole("radio", { name: t("profile.edit.wayManual") }));
        const save = screen.getByRole("button", { name: t("profile.edit.save") });
        expect(save).toBeDisabled();
        const name = screen.getByLabelText(t("profile.add.name"));
        await user.clear(name);
        await user.type(name, "Blattwerk");
        await user.type(screen.getByLabelText(t("profile.add.realm")), "Thunderstrike");
        await user.click(save);
        expect(onSave).toHaveBeenCalledWith({ name: "Blattwerk", realm: "Thunderstrike" });
    });

    it("eine andere Klasse fängt mit neuen Specs an", async () => {
        const { user, onSave } = renderDialog();
        await user.click(screen.getByRole("radio", { name: t("profile.edit.wayManual") }));
        await user.click(screen.getByRole("button", { name: /Schamane|Shaman/ }));
        expect(screen.getByText(t("profile.edit.classHint"))).toBeInTheDocument();
        const specs = screen.getByRole("group", { name: t("profile.add.specs") });
        expect(within(specs).getAllByRole("button").every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
        await user.click(within(specs).getByRole("button", { name: /Wiederherstellung|Restoration/ }));
        await user.click(screen.getByRole("button", { name: t("profile.edit.save") }));
        expect(onSave).toHaveBeenCalledWith({ className: "Shaman", specs: ["Shaman-Restoration"] });
    });

    it("zeigt die Absage des Servers und bleibt offen", async () => {
        const onSave = vi.fn().mockRejectedValue(Object.assign(new Error("Nerathil steht schon in diesem Profil."), { code: "taken" }));
        const { user } = renderDialog({ onSave });
        await user.click(screen.getByRole("radio", { name: t("profile.edit.wayManual") }));
        await user.type(screen.getByLabelText(t("profile.add.name")), "x");
        await user.click(screen.getByRole("button", { name: t("profile.edit.save") }));
        expect(await screen.findByText("Nerathil steht schon in diesem Profil.")).toBeInTheDocument();
    });

    it("mit Nachnamen-Version (Forever): Vor- und Nachname getrennt, wieder zusammengesetzt", async () => {
        const { user, onSave } = renderDialog({ character: { ...GENTLE, key: "forever~bo res", name: "Bo Res", versionId: "forever" }, lastName: true });
        await user.click(screen.getByRole("radio", { name: t("profile.edit.wayManual") }));
        expect(screen.getByLabelText(t("profile.add.firstName"))).toHaveValue("Bo");
        const last = screen.getByLabelText(t("profile.add.lastName"));
        expect(last).toHaveValue("Res");
        await user.type(last, "t");
        await user.click(screen.getByRole("button", { name: t("profile.edit.save") }));
        expect(onSave).toHaveBeenCalledWith({ name: "Bo Rest" });
    });

    it("ist ohne Charakter zu", () => {
        render(<EditCharacterDialog character={null} classes={CLASSES} loadLog={vi.fn()} onSave={vi.fn()} onClose={() => undefined} />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
