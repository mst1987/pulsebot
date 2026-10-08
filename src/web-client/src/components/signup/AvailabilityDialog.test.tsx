// "Abwesenheit / Anwesenheit eintragen" as the raider and the orga use it: the
// API is mocked, every check is about what the dialog lists and which entry a
// click sends. The pure rules are in lib/availability.test.ts.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AvailabilityData, AvailabilityRaid } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import AvailabilityDialog from "./AvailabilityDialog";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getAvailability: vi.fn(),
    previewAvailability: vi.fn(),
    saveAvailability: vi.fn(),
    searchRaiders: vi.fn(),
}));

const OWN: AvailabilityData = {
    userId: "u1", name: "Zibbo", orga: false, today: "2026-10-05", maxDays: 180, entries: [],
    characters: [
        { key: "zibbo", name: "Zibbo", className: "Priest", versionId: "tbc", specs: [
            { key: "Priest-Shadow", label: "Shadow", gear: "usable" },
            { key: "Priest-Holy", label: "Holy", gear: "ready" },
        ] },
        { key: "zibbowar", name: "Zibbowar", className: "Warrior", versionId: "tbc", specs: [
            { key: "Warrior-Protection", label: "Protection", gear: "ready" },
        ] },
    ],
};

const RAIDS: AvailabilityRaid[] = [
    { id: "kara", title: "Kara Freitag", startTime: Date.UTC(2026, 9, 9, 17, 45) / 1000, categoryName: "T4", status: "signed", url: "" },
    { id: "gruul", title: "Gruul Samstag", startTime: Date.UTC(2026, 9, 10, 17, 30) / 1000, categoryName: "T4", status: "", url: "" },
];

function show(kind: "absence" | "presence" = "absence", own: AvailabilityData = OWN) {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    renderPage(<AvailabilityDialog kind={kind} own={own} onClose={onClose} onSaved={onSaved} />);
    return { onClose, onSaved };
}

const saveButton = (kind: "absence" | "presence" = "absence") =>
    screen.getByRole("button", { name: t(kind === "absence" ? "signups.availability.dialog.saveAbsence" : "signups.availability.dialog.savePresence") });
const raidBox = (title: string) => screen.findByRole("checkbox", { name: t("signups.availability.dialog.raidAria", { title }) });

beforeEach(() => {
    vi.mocked(api.previewAvailability).mockResolvedValue({ raids: RAIDS });
    vi.mocked(api.saveAvailability).mockResolvedValue({ entry: {} as never, results: [], dm: true });
});

describe("AvailabilityDialog", () => {
    it("lists the raids of the period, all picked, and sends only the ones left checked", async () => {
        const user = userEvent.setup();
        const { onSaved, onClose } = show();
        expect(screen.getByText(t("signups.availability.dialog.titleAbsence"))).toBeInTheDocument();
        expect(screen.getByLabelText(t("signups.availability.dialog.from"))).toHaveValue("2026-10-05");
        expect(screen.getByLabelText(t("signups.availability.dialog.to"))).toHaveValue("2026-10-05");

        expect(await raidBox("Kara Freitag")).toBeChecked();
        expect(await raidBox("Gruul Samstag")).toBeChecked();
        // the own status in each raid
        expect(screen.getByText(t("signups.status.signed"))).toBeInTheDocument();
        expect(screen.getByText(t("signups.availability.dialog.picked", { picked: 2, total: 2 }), { exact: false })).toBeInTheDocument();
        expect(api.previewAvailability).toHaveBeenLastCalledWith({ kind: "absence", from: "2026-10-05", to: "2026-10-05" });
        // later raids follow, and a DM is sent
        expect(screen.getByText(t("signups.availability.dialog.hintAbsence"))).toBeInTheDocument();

        await user.click(await raidBox("Gruul Samstag"));
        expect(screen.getByText(t("signups.availability.dialog.picked", { picked: 1, total: 2 }), { exact: false })).toBeInTheDocument();
        await user.type(screen.getByLabelText(t("signups.availability.dialog.reason"), { exact: false }), "Urlaub");
        vi.mocked(api.saveAvailability).mockResolvedValue({
            entry: {} as never, dm: true,
            results: [{ eventId: "kara", title: "Kara Freitag", startTime: RAIDS[0].startTime, ok: true, skipped: "", error: "" }],
        });
        await user.click(saveButton());

        expect(api.saveAvailability).toHaveBeenCalledWith({ kind: "absence", from: "2026-10-05", to: "2026-10-05", comment: "Urlaub", eventIds: ["kara"] });
        expect(await screen.findByText(t("signups.availability.result.signedOff", { count: 1 }))).toBeInTheDocument();
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it("leaves a raid the save would skip anyway unpicked and greyed out", async () => {
        const user = userEvent.setup();
        show("presence");
        // an attendance never touches an existing signup: Kara (signed) cannot be picked
        expect(await raidBox("Kara Freitag")).not.toBeChecked();
        expect(await raidBox("Kara Freitag")).toBeDisabled();
        expect(await raidBox("Gruul Samstag")).toBeChecked();
        expect(screen.getByText(t("signups.availability.dialog.picked", { picked: 1, total: 2 }), { exact: false })).toBeInTheDocument();
        await user.click(saveButton("presence"));
        expect(api.saveAvailability).toHaveBeenCalledWith(expect.objectContaining({ kind: "presence", eventIds: ["gruul"] }));
    });

    it("an absence still picks a raid one is signed up for, but not one already signed off from", async () => {
        vi.mocked(api.previewAvailability).mockResolvedValue({ raids: [RAIDS[0], { ...RAIDS[1], status: "absence" }] });
        show();
        expect(await raidBox("Kara Freitag")).toBeChecked();
        expect(await raidBox("Gruul Samstag")).toBeDisabled();
    });

    it("moves 'Bis' along with 'Von' and looks the period up again", async () => {
        show();
        await raidBox("Kara Freitag");
        fireEvent.change(screen.getByLabelText(t("signups.availability.dialog.from")), { target: { value: "2026-10-08" } });
        expect(screen.getByLabelText(t("signups.availability.dialog.to"))).toHaveValue("2026-10-08");
        fireEvent.change(screen.getByLabelText(t("signups.availability.dialog.to")), { target: { value: "2026-10-12" } });
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({ kind: "absence", from: "2026-10-08", to: "2026-10-12" }));
    });

    it("signs up with the raider's first character and its raid-ready spec — and never says 'Main'", async () => {
        const user = userEvent.setup();
        show("presence");
        const character = screen.getByLabelText(t("signups.availability.dialog.character"));
        expect(character).toHaveValue("zibbo");
        expect(within(character).getAllByRole("option").map((o) => o.textContent)).toEqual(["Zibbo", "Zibbowar"]);
        expect(screen.getByLabelText(t("signups.availability.dialog.spec"))).toHaveValue("Priest-Holy");
        expect(document.body.textContent).not.toMatch(/\bmain\b/i);
        await raidBox("Kara Freitag");
        expect(api.previewAvailability).toHaveBeenLastCalledWith({ kind: "presence", from: "2026-10-05", to: "2026-10-05", character: "zibbo", spec: "Priest-Holy" });

        await user.selectOptions(character, "zibbowar");
        expect(screen.getByLabelText(t("signups.availability.dialog.spec"))).toHaveValue("Warrior-Protection");
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ character: "zibbowar", spec: "Warrior-Protection" })));
        await waitFor(() => expect(saveButton("presence")).toBeEnabled());
        await user.click(saveButton("presence"));
        expect(api.saveAvailability).toHaveBeenCalledWith({
            // Kara is signed up already: an attendance leaves it alone, so it is not sent
            kind: "presence", from: "2026-10-05", to: "2026-10-05", character: "zibbowar", spec: "Warrior-Protection", comment: "", eventIds: ["gruul"],
        });
    });

    it("switches the kind inside the dialog", async () => {
        const user = userEvent.setup();
        show("absence");
        await user.click(screen.getByRole("radio", { name: t("signups.availability.dialog.presence") }));
        expect(screen.getByText(t("signups.availability.dialog.titlePresence"))).toBeInTheDocument();
        expect(screen.getByLabelText(t("signups.availability.dialog.character"))).toBeInTheDocument();
    });

    it("says so when an attendance has no character to go with", () => {
        show("presence", { ...OWN, characters: [] });
        expect(screen.getByText(t("signups.availability.dialog.noCharacter"))).toBeInTheDocument();
        expect(saveButton("presence")).toBeDisabled();
    });

    it("shows the server's reason when the period does not work, and saves nothing", async () => {
        vi.mocked(api.previewAvailability).mockRejectedValue({ code: "bad_request", message: "Der Zeitraum liegt schon in der Vergangenheit." });
        show();
        expect(await screen.findByRole("alert")).toHaveTextContent("Der Zeitraum liegt schon in der Vergangenheit.");
        expect(saveButton()).toBeDisabled();
    });

    it("lists what was skipped or refused after saving, with the reason", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveAvailability).mockResolvedValue({
            entry: {} as never, dm: true,
            results: [
                { eventId: "kara", title: "Kara Freitag", startTime: RAIDS[0].startTime, ok: false, skipped: "already_absent", error: "" },
                { eventId: "gruul", title: "Gruul Samstag", startTime: RAIDS[1].startTime, ok: false, skipped: "", error: "Anmeldeschluss vorbei" },
            ],
        });
        const { onClose } = show();
        await raidBox("Kara Freitag");
        await user.click(saveButton());
        expect(await screen.findByText(t("signups.availability.skip.already_absent"))).toBeInTheDocument();
        expect(screen.getByText("Anmeldeschluss vorbei")).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        // the foot's button, not the head's or the toast's X
        const close = screen.getAllByRole("button", { name: t("common.close") }).find((b) => b.classList.contains("btn"));
        if (!close) throw new Error("no close button in the foot");
        await user.click(close);
        expect(onClose).toHaveBeenCalled();
    });

    it("lets the orga enter for another raider: their characters, their id on preview and save", async () => {
        const user = userEvent.setup();
        vi.mocked(api.searchRaiders).mockResolvedValue({ raiders: [{ userId: "u9", name: "Anna", character: "Annadruid", className: "Druid" }] });
        vi.mocked(api.getAvailability).mockResolvedValue({
            ...OWN, userId: "u9", name: "Anna",
            characters: [{ key: "annadruid", name: "Annadruid", className: "Druid", versionId: "tbc", specs: [{ key: "Druid-Restoration", label: "Restoration", gear: "ready" }] }],
        });
        show("presence", { ...OWN, orga: true });
        await user.click(screen.getByRole("button", { name: t("signups.availability.dialog.forRaider") }));
        await user.type(screen.getByRole("textbox", { name: t("signups.availability.dialog.searchRaiderAria") }), "ann");
        await user.click(await screen.findByRole("button", { name: /Annadruid/ }));

        expect(api.getAvailability).toHaveBeenCalledWith("u9");
        expect(screen.getByText(t("signups.availability.dialog.forName", { name: "Anna" }))).toBeInTheDocument();
        expect(await screen.findByLabelText(t("signups.availability.dialog.character"))).toHaveValue("annadruid");
        expect(screen.getByText(t("signups.availability.dialog.hintPresenceFor", { name: "Anna" }))).toBeInTheDocument();
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({
            kind: "presence", from: "2026-10-05", to: "2026-10-05", character: "annadruid", spec: "Druid-Restoration", userId: "u9",
        }));
        await waitFor(() => expect(saveButton("presence")).toBeEnabled());
        await user.click(saveButton("presence"));
        expect(api.saveAvailability).toHaveBeenCalledWith(expect.objectContaining({ userId: "u9", character: "annadruid" }));
    });

    it("offers no raider picker to a raider", () => {
        show();
        expect(screen.queryByRole("button", { name: t("signups.availability.dialog.forRaider") })).not.toBeInTheDocument();
    });

    it("starts with a raider the orga picked elsewhere (Roster › Abwesenheiten), who can be taken back", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAvailability).mockResolvedValue({ ...OWN, userId: "u9", name: "Anna" });
        const anna = { userId: "u9", name: "Anna", character: "Annadruid", className: "Druid" };
        renderPage(<AvailabilityDialog kind="absence" own={{ ...OWN, orga: true }} target={anna} onClose={vi.fn()} onSaved={vi.fn()} />);
        expect(screen.getByText(t("signups.availability.dialog.forName", { name: "Anna" }))).toBeInTheDocument();
        expect(api.getAvailability).toHaveBeenCalledWith("u9");
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({ kind: "absence", from: "2026-10-05", to: "2026-10-05", userId: "u9" }));
        await user.click(screen.getByRole("button", { name: t("signups.availability.dialog.backToMe") }));
        expect(screen.getByRole("button", { name: t("signups.availability.dialog.forRaider") })).toBeInTheDocument();
    });

    it("ignores a picked raider for somebody who is no orga", () => {
        renderPage(<AvailabilityDialog kind="absence" own={OWN} target={{ userId: "u9", name: "Anna", character: "", className: "" }} onClose={vi.fn()} onSaved={vi.fn()} />);
        expect(screen.queryByText(t("signups.availability.dialog.forName", { name: "Anna" }))).not.toBeInTheDocument();
    });
});
