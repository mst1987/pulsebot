// The link dialog's character search with evidence: every hit shows where its
// evidence comes from, a character nobody confirmed stands greyed out and
// cannot be picked; "Im Arsenal prüfen" and "Im Spiel geprüft" (with a short
// confirmation inside the row) confirm it on the spot. The API is mocked.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GuildBankCharacterChoice } from "../../api";
import { renderPage } from "../../test/render";
import LinkCharacterDialog, { NotLinkedBadge } from "./CharacterPicker";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    searchGuildBankCharacters: vi.fn(),
    checkGuildBankCharacterArmory: vi.fn(),
    verifyGuildBankCharacter: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";

function choice(over: Partial<GuildBankCharacterChoice>): GuildBankCharacterChoice {
    return {
        userId: "u3", userName: "Gentle", characterKey: "gentleowl", characterName: "Gentleowl", realm: "", className: "Druid",
        versionId: "tbc", icon: "", classColor: "", specKey: "", verified: true, evidence: "log", ...over,
    };
}

const OWL = choice({});
const TWOWL = choice({ characterKey: "gentletwowl", characterName: "Gentletwowl", className: "Priest", evidence: "armory" });
const GENTLE = choice({ characterKey: "gentle", characterName: "Gentle", verified: false, evidence: "" });

function open(onPick = vi.fn()) {
    renderPage(<LinkCharacterDialog bankKey={KEY} what="1× Crimson Spinal" current="Gentle" busy={false} onPick={onPick} onClose={vi.fn()} />);
    return onPick;
}

beforeEach(() => {
    vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [OWL, TWOWL, GENTLE] });
});

describe("CharacterPicker — evidence", () => {
    it("shows each hit's evidence; an unconfirmed one is greyed out and cannot be picked", async () => {
        const user = userEvent.setup();
        const onPick = open();
        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(api.searchGuildBankCharacters).toHaveBeenCalledWith(KEY, "Gentle"));
        const owl = await within(dialog).findByRole("button", { name: "Gentleowl von Gentle wählen" });
        expect(within(owl).getByText("aus Logs")).toHaveAttribute("data-tip-sub", expect.stringMatching(/Warcraft-Logs/));
        expect(within(within(dialog).getByRole("button", { name: "Gentletwowl von Gentle wählen" })).getByText("Arsenal")).toBeInTheDocument();
        const typed = within(dialog).getByRole("button", { name: "Gentle von Gentle wählen" });
        expect(typed).toBeDisabled();
        expect(within(typed).getByText("nicht bestätigt")).toBeInTheDocument();
        await user.click(owl);
        expect(onPick).toHaveBeenCalledWith(OWL);
    });

    it("Im Arsenal prüfen: an answer makes the character pickable", async () => {
        const user = userEvent.setup();
        vi.mocked(api.checkGuildBankCharacterArmory).mockResolvedValue({ found: true, choice: { ...GENTLE, verified: true, evidence: "armory" } });
        const onPick = open();
        const dialog = await screen.findByRole("dialog");
        await user.click(await within(dialog).findByRole("button", { name: "Im Arsenal prüfen: Gentle" }));
        expect(api.checkGuildBankCharacterArmory).toHaveBeenCalledWith(KEY, { userId: "u3", characterKey: "gentle" });
        expect(await within(dialog).findByText("Das Arsenal kennt Gentle – bestätigt.")).toBeInTheDocument();
        const typed = within(dialog).getByRole("button", { name: "Gentle von Gentle wählen" });
        expect(typed).toBeEnabled();
        expect(within(typed).getByText("Arsenal")).toBeInTheDocument();
        await user.click(typed);
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ characterKey: "gentle", verified: true }));
    });

    it("Im Arsenal prüfen: no answer says so clearly and leaves it unconfirmed; an error is shown", async () => {
        const user = userEvent.setup();
        vi.mocked(api.checkGuildBankCharacterArmory).mockResolvedValueOnce({ found: false, choice: GENTLE });
        open();
        const dialog = await screen.findByRole("dialog");
        await user.click(await within(dialog).findByRole("button", { name: "Im Arsenal prüfen: Gentle" }));
        expect(await within(dialog).findByText("Arsenal kennt den Charakter nicht oder ist gerade nicht erreichbar – im Spiel per /who prüfen.")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Gentle von Gentle wählen" })).toBeDisabled();
        vi.mocked(api.checkGuildBankCharacterArmory).mockRejectedValueOnce(Object.assign(new Error("Kaputt"), { status: 500 }));
        await user.click(within(dialog).getByRole("button", { name: "Im Arsenal prüfen: Gentle" }));
        // an error is a toast like every failed action
        expect(await screen.findByText("Kaputt")).toBeInTheDocument();
    });

    it("Im Spiel geprüft asks once more inside the row; yes confirms the character, cancel changes nothing", async () => {
        const user = userEvent.setup();
        vi.mocked(api.verifyGuildBankCharacter).mockResolvedValue({ choice: { ...GENTLE, verified: true, evidence: "orga" } });
        open();
        const dialog = await screen.findByRole("dialog");
        await user.click(await within(dialog).findByRole("button", { name: "Im Spiel geprüft: Gentle" }));
        let ask = within(dialog).getByRole("group", { name: "Gentle im Spiel gefunden?" });
        expect(within(ask).getByText("Nur bestätigen, wenn du den Charakter im Spiel gefunden hast, z. B. per /who.")).toBeInTheDocument();
        await user.click(within(ask).getByRole("button", { name: "Abbrechen" }));
        expect(api.verifyGuildBankCharacter).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: "Im Spiel geprüft: Gentle" }));
        ask = within(dialog).getByRole("group", { name: "Gentle im Spiel gefunden?" });
        await user.click(within(ask).getByRole("button", { name: "Ja, gefunden" }));
        expect(api.verifyGuildBankCharacter).toHaveBeenCalledWith(KEY, { userId: "u3", characterKey: "gentle" });
        expect(await within(dialog).findByText("Gentle ist bestätigt.")).toBeInTheDocument();
        const typed = within(dialog).getByRole("button", { name: "Gentle von Gentle wählen" });
        expect(typed).toBeEnabled();
        expect(within(typed).getByText("von Orga geprüft")).toBeInTheDocument();
        expect(within(dialog).queryByRole("group", { name: "Gentle im Spiel gefunden?" })).toBeNull();
    });
});

describe("NotLinkedBadge", () => {
    it("names an unconfirmed character apart from a missing one", () => {
        renderPage(<><NotLinkedBadge problem="unverified" /><NotLinkedBadge noRaider /></>);
        expect(screen.getByText("Charakter nicht bestätigt")).toHaveAttribute("data-tip-sub", expect.stringMatching(/kein Log, kein Loot/));
        expect(screen.getByText("nicht verknüpft")).toBeInTheDocument();
    });
});
