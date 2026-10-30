// "Abwesenheit / Anwesenheit eintragen" and "… bearbeiten" as the raider and the
// orga use it: the API is mocked, every check is about what the dialog lists and
// which entry a click sends. The pure rules are in lib/signups/__tests__/availability.test.ts.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { AvailabilityData, AvailabilityEntry, AvailabilityRaid, AvailabilityServer } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import AvailabilityDialog from "../AvailabilityDialog";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getAvailability: vi.fn(),
    previewAvailability: vi.fn(),
    saveAvailability: vi.fn(),
    updateAvailability: vi.fn(),
    searchRaiders: vi.fn(),
}));

const PULSE: AvailabilityServer = {
    guildId: "g1", name: "Pulse", icon: "",
    categories: [
        { id: "c-tbc", name: "📅 Raids TBC", icon: "", versionId: "tbc" },
        { id: "c-fv", name: "Forever-Raid", icon: "", versionId: "forever" },
    ],
};
const PUGS: AvailabilityServer = {
    guildId: "g2", name: "PuGs", icon: "",
    categories: [{ id: "c-pug", name: "PuG Kara", icon: "", versionId: "tbc" }],
};

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
        { key: "zibbofv", name: "Zibbofv", className: "Mage", versionId: "forever", specs: [{ key: "Mage-Frost", label: "Frost", gear: "ready" }] },
    ],
    categories: [],
    servers: [PULSE],
};
const TWO: AvailabilityData = { ...OWN, servers: [PULSE, PUGS] };

const ALL_PULSE = [{ guildId: "g1", categoryIds: [] }];

const RAIDS: AvailabilityRaid[] = [
    { id: "kara", title: "Kara Freitag", startTime: Date.UTC(2026, 9, 9, 17, 45) / 1000, categoryName: "T4", status: "signed", url: "" },
    { id: "gruul", title: "Gruul Samstag", startTime: Date.UTC(2026, 9, 10, 17, 30) / 1000, categoryName: "T4", status: "", url: "" },
];

function show(kind: "absence" | "presence" = "absence", own: AvailabilityData = OWN, more: { categoryId?: string; activeGuildId?: string; entryId?: string } = {}) {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    renderPage(<AvailabilityDialog kind={kind} own={own} onClose={onClose} onSaved={onSaved} {...more} />);
    return { onClose, onSaved };
}

const saveButton = (kind: "absence" | "presence" | "edit" = "absence") => screen.getByRole("button", {
    name: t(kind === "edit" ? "signups.availability.dialog.saveEdit" : kind === "absence" ? "signups.availability.dialog.saveAbsence" : "signups.availability.dialog.savePresence"),
});
const raidRow = (title: string) => screen.findByRole("button", { name: t("signups.availability.dialog.raidAria", { title }) });
const charRow = (name: string) => screen.getByRole("button", { name: t("signups.availability.dialog.charAria", { name }) });
const specOf = (name: string) => screen.getByLabelText(t("signups.availability.dialog.specAria", { name }));
const chip = (group: HTMLElement, name: string) => within(group).getByRole("button", { name });
const allChip = (group: HTMLElement) => chip(group, t("signups.availability.dialog.allOfServer"));
const scopeGroup = () => screen.getByRole("group", { name: t("signups.availability.dialog.category") });
const serverGroup = (name: string) => screen.getByRole("group", { name: t("signups.availability.dialog.serverAria", { name }) });

beforeEach(() => {
    vi.mocked(api.previewAvailability).mockResolvedValue({ raids: RAIDS });
    vi.mocked(api.saveAvailability).mockResolvedValue({ entry: {} as never, results: [], dm: true });
    vi.mocked(api.updateAvailability).mockResolvedValue({ entry: {} as never, results: [], dm: true });
});

describe("AvailabilityDialog", () => {
    it("lists the raids of the period, all picked, and sends only the ones left on", async () => {
        const user = userEvent.setup();
        const { onSaved, onClose } = show();
        expect(screen.getByText(t("signups.availability.dialog.titleAbsence"))).toBeInTheDocument();
        expect(screen.getByLabelText(t("signups.availability.dialog.from"))).toHaveValue("2026-10-05");
        expect(screen.getByLabelText(t("signups.availability.dialog.to"))).toHaveValue("2026-10-05");

        expect(await raidRow("Kara Freitag")).toHaveAttribute("aria-pressed", "true");
        expect(await raidRow("Gruul Samstag")).toHaveAttribute("aria-pressed", "true");
        // no checkboxes anywhere: toggles
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.getByText(t("signups.status.signed"))).toBeInTheDocument();
        expect(screen.getByText(t("signups.availability.dialog.picked", { picked: 2, total: 2 }), { exact: false })).toBeInTheDocument();
        expect(api.previewAvailability).toHaveBeenLastCalledWith({ kind: "absence", from: "2026-10-05", to: "2026-10-05", scope: ALL_PULSE });
        expect(screen.getByText(t("signups.availability.dialog.hintAbsence"))).toBeInTheDocument();

        await user.click(await raidRow("Gruul Samstag"));
        expect(await raidRow("Gruul Samstag")).toHaveAttribute("aria-pressed", "false");
        await user.type(screen.getByLabelText(t("signups.availability.dialog.reason"), { exact: false }), "Urlaub");
        vi.mocked(api.saveAvailability).mockResolvedValue({
            entry: {} as never, dm: true,
            results: [{ eventId: "kara", title: "Kara Freitag", startTime: RAIDS[0].startTime, ok: true, skipped: "", error: "" }],
        });
        await user.click(saveButton());

        expect(api.saveAvailability).toHaveBeenCalledWith({ kind: "absence", from: "2026-10-05", to: "2026-10-05", scope: ALL_PULSE, comment: "Urlaub", eventIds: ["kara"] });
        expect(api.updateAvailability).not.toHaveBeenCalled();
        expect(await screen.findByText(t("signups.availability.result.signedOff", { count: 1 }))).toBeInTheDocument();
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it("saves with the green 'go' button, absence and attendance alike", () => {
        show();
        expect(saveButton()).toHaveClass("btn-go");
    });

    it("leaves a raid the save would skip anyway unpicked and greyed out", async () => {
        const user = userEvent.setup();
        show("presence");
        // an attendance never touches an existing signup: Kara (signed) cannot be picked
        expect(await raidRow("Kara Freitag")).toHaveAttribute("aria-pressed", "false");
        expect(await raidRow("Kara Freitag")).toBeDisabled();
        expect(await raidRow("Gruul Samstag")).toHaveAttribute("aria-pressed", "true");
        await waitFor(() => expect(saveButton("presence")).toBeEnabled());
        await user.click(saveButton("presence"));
        expect(api.saveAvailability).toHaveBeenCalledWith(expect.objectContaining({ kind: "presence", eventIds: ["gruul"] }));
    });

    it("an absence still picks a raid one is signed up for, but not one already signed off from", async () => {
        vi.mocked(api.previewAvailability).mockResolvedValue({ raids: [RAIDS[0], { ...RAIDS[1], status: "absence" }] });
        show();
        expect(await raidRow("Kara Freitag")).toHaveAttribute("aria-pressed", "true");
        expect(await raidRow("Gruul Samstag")).toBeDisabled();
    });

    it("moves 'Bis' along with 'Von' and looks the period up again", async () => {
        show();
        await raidRow("Kara Freitag");
        fireEvent.change(screen.getByLabelText(t("signups.availability.dialog.from")), { target: { value: "2026-10-08" } });
        expect(screen.getByLabelText(t("signups.availability.dialog.to"))).toHaveValue("2026-10-08");
        fireEvent.change(screen.getByLabelText(t("signups.availability.dialog.to")), { target: { value: "2026-10-12" } });
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-10-08", to: "2026-10-12" })));
    });

    it("an attendance starts with the first character of each version and its raid-ready spec — and never says 'Main'", async () => {
        show("presence");
        // both versions of Pulse: one group each, the first character of each picked
        expect(screen.getByText("TBC")).toBeInTheDocument();
        expect(charRow("Zibbo")).toHaveAttribute("aria-pressed", "true");
        expect(charRow("Zibbowar")).toHaveAttribute("aria-pressed", "false");
        expect(charRow("Zibbofv")).toHaveAttribute("aria-pressed", "true");
        expect(specOf("Zibbo")).toHaveValue("Priest-Holy");
        expect(document.body.textContent).not.toMatch(/\bmain\b/i);
        await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({
            kind: "presence", from: "2026-10-05", to: "2026-10-05", scope: ALL_PULSE,
            characters: [{ character: "zibbo", spec: "Priest-Holy" }, { character: "zibbofv", spec: "Mage-Frost" }],
        }));
    });

    it("takes several characters of one version, each with its own spec", async () => {
        const user = userEvent.setup();
        show("presence");
        await user.click(charRow("Zibbowar"));
        expect(charRow("Zibbowar")).toHaveAttribute("aria-pressed", "true");
        await user.selectOptions(specOf("Zibbo"), "Priest-Shadow");
        await user.click(charRow("Zibbofv"));
        expect(charRow("Zibbofv")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText(t("signups.availability.dialog.picked", { picked: 2, total: 3 }), { exact: false })).toBeInTheDocument();
        await waitFor(() => expect(saveButton("presence")).toBeEnabled());
        await user.click(saveButton("presence"));
        expect(api.saveAvailability).toHaveBeenCalledWith({
            kind: "presence", from: "2026-10-05", to: "2026-10-05", scope: ALL_PULSE,
            characters: [{ character: "zibbo", spec: "Priest-Shadow" }, { character: "zibbowar", spec: "Warrior-Protection" }],
            comment: "", eventIds: ["gruul"],
        });
    });

    it("asks for a character when every one is left out, and saves nothing", async () => {
        const user = userEvent.setup();
        show("presence", { ...OWN, servers: [{ ...PULSE, categories: [PULSE.categories[0]] }] });
        await user.click(charRow("Zibbo"));
        expect(screen.getByRole("alert")).toHaveTextContent(t("signups.availability.dialog.noCharPicked"));
        expect(saveButton("presence")).toBeDisabled();
    });

    it("switches the kind inside the dialog", async () => {
        const user = userEvent.setup();
        show("absence");
        await user.click(screen.getByRole("radio", { name: t("signups.availability.dialog.presence") }));
        expect(screen.getByText(t("signups.availability.dialog.titlePresence"))).toBeInTheDocument();
        expect(charRow("Zibbo")).toBeInTheDocument();
    });

    it("says so when an attendance has no character to go with", () => {
        show("presence", { ...OWN, characters: [] });
        expect(screen.getByText(t("signups.availability.dialog.noCharacter"))).toBeInTheDocument();
        expect(saveButton("presence")).toBeDisabled();
    });

    it("says so when the raider is on no server the bot plans for", () => {
        show("absence", { ...OWN, servers: [] });
        expect(screen.getByText(t("signups.availability.dialog.noServer"))).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();
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
        await raidRow("Kara Freitag");
        await waitFor(() => expect(saveButton()).toBeEnabled());
        await user.click(saveButton());
        expect(await screen.findByText(t("signups.availability.skip.already_absent"))).toBeInTheDocument();
        expect(screen.getByText("Anmeldeschluss vorbei")).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        const close = screen.getAllByRole("button", { name: t("common.close") }).find((b) => b.classList.contains("btn"));
        if (!close) throw new Error("no close button in the foot");
        await user.click(close);
        expect(onClose).toHaveBeenCalled();
    });

    describe("where it holds", () => {
        it("one server: chips 'Alle Kategorien' plus one per category, without a server heading", () => {
            show();
            const group = scopeGroup();
            expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([t("signups.availability.dialog.allOfServer"), "Raids TBC", "Forever-Raid"]);
            expect(allChip(group)).toHaveAttribute("aria-pressed", "true");
            expect(screen.queryByText("Pulse")).not.toBeInTheDocument();
        });

        it("several categories may be on; the last one off asks for a pick", async () => {
            const user = userEvent.setup();
            show();
            await user.click(chip(scopeGroup(), "Raids TBC"));
            expect(allChip(scopeGroup())).toHaveAttribute("aria-pressed", "false");
            expect(chip(scopeGroup(), "Raids TBC")).toHaveAttribute("aria-pressed", "true");
            await user.click(chip(scopeGroup(), "Forever-Raid"));
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ scope: [{ guildId: "g1", categoryIds: ["c-tbc", "c-fv"] }] })));

            await user.click(chip(scopeGroup(), "Raids TBC"));
            await user.click(chip(scopeGroup(), "Forever-Raid"));
            expect(screen.getByRole("alert")).toHaveTextContent(t("signups.availability.dialog.noScope"));
            expect(saveButton()).toBeDisabled();
        });

        it("several servers: one block each, the active one picked, more can be added", async () => {
            const user = userEvent.setup();
            show("absence", TWO, { activeGuildId: "g2" });
            expect(screen.getByText("Pulse")).toBeInTheDocument();
            expect(screen.getByText("PuGs")).toBeInTheDocument();
            expect(allChip(serverGroup("PuGs"))).toHaveAttribute("aria-pressed", "true");
            expect(allChip(serverGroup("Pulse"))).toHaveAttribute("aria-pressed", "false");
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ scope: [{ guildId: "g2", categoryIds: [] }] })));

            await user.click(chip(serverGroup("Pulse"), "Raids TBC"));
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({
                scope: [{ guildId: "g1", categoryIds: ["c-tbc"] }, { guildId: "g2", categoryIds: [] }],
            })));
            await waitFor(() => expect(saveButton()).toBeEnabled());
            await user.click(saveButton());
            expect(api.saveAvailability).toHaveBeenCalledWith(expect.objectContaining({
                scope: [{ guildId: "g1", categoryIds: ["c-tbc"] }, { guildId: "g2", categoryIds: [] }],
            }));
        });

        it("starts on the category of the page's open tab, on its server", async () => {
            show("absence", TWO, { categoryId: "c-fv" });
            expect(chip(serverGroup("Pulse"), "Forever-Raid")).toHaveAttribute("aria-pressed", "true");
            expect(allChip(serverGroup("PuGs"))).toHaveAttribute("aria-pressed", "false");
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ scope: [{ guildId: "g1", categoryIds: ["c-fv"] }] })));
        });

        it("takes an unknown category from the page as the whole first server", async () => {
            show("absence", TWO, { categoryId: "gone" });
            expect(allChip(serverGroup("Pulse"))).toHaveAttribute("aria-pressed", "true");
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ scope: ALL_PULSE })));
        });

        it("an attendance offers only characters of the versions picked", async () => {
            const user = userEvent.setup();
            show("presence");
            await user.click(chip(scopeGroup(), "Forever-Raid"));
            expect(screen.queryByRole("button", { name: t("signups.availability.dialog.charAria", { name: "Zibbo" }) })).not.toBeInTheDocument();
            expect(charRow("Zibbofv")).toHaveAttribute("aria-pressed", "true");
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({
                scope: [{ guildId: "g1", categoryIds: ["c-fv"] }], characters: [{ character: "zibbofv", spec: "Mage-Frost" }],
            })));
        });
    });

    describe("the orga", () => {
        it("enters for another raider: their characters and servers, their id on preview and save", async () => {
            const user = userEvent.setup();
            vi.mocked(api.searchRaiders).mockResolvedValue({ raiders: [{ userId: "u9", name: "Anna", character: "Annadruid", className: "Druid" }] });
            vi.mocked(api.getAvailability).mockResolvedValue({
                ...OWN, userId: "u9", name: "Anna", servers: [PUGS],
                characters: [{ key: "annadruid", name: "Annadruid", className: "Druid", versionId: "tbc", specs: [{ key: "Druid-Restoration", label: "Restoration", gear: "ready" }] }],
            });
            show("presence", { ...OWN, orga: true });
            await user.click(screen.getByRole("button", { name: t("signups.availability.dialog.forRaider") }));
            await user.type(screen.getByRole("textbox", { name: t("signups.availability.dialog.searchRaiderAria") }), "ann");
            await user.click(await screen.findByRole("button", { name: /Annadruid/ }));

            expect(api.getAvailability).toHaveBeenCalledWith("u9");
            expect(screen.getByText(t("signups.availability.dialog.forName", { name: "Anna" }))).toBeInTheDocument();
            expect(await screen.findByRole("button", { name: t("signups.availability.dialog.charAria", { name: "Annadruid" }) })).toHaveAttribute("aria-pressed", "true");
            expect(screen.getByText(t("signups.availability.dialog.hintPresenceFor", { name: "Anna" }))).toBeInTheDocument();
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({
                kind: "presence", from: "2026-10-05", to: "2026-10-05", scope: [{ guildId: "g2", categoryIds: [] }],
                characters: [{ character: "annadruid", spec: "Druid-Restoration" }], userId: "u9",
            }));
            await waitFor(() => expect(saveButton("presence")).toBeEnabled());
            await user.click(saveButton("presence"));
            expect(api.saveAvailability).toHaveBeenCalledWith(expect.objectContaining({ userId: "u9", characters: [{ character: "annadruid", spec: "Druid-Restoration" }] }));
        });

        it("offers no raider picker to a raider", () => {
            show();
            expect(screen.queryByRole("button", { name: t("signups.availability.dialog.forRaider") })).not.toBeInTheDocument();
        });

        it("starts with a raider picked elsewhere (Roster › Abwesenheiten), who can be taken back", async () => {
            const user = userEvent.setup();
            vi.mocked(api.getAvailability).mockResolvedValue({ ...OWN, userId: "u9", name: "Anna" });
            const anna = { userId: "u9", name: "Anna", character: "Annadruid", className: "Druid" };
            renderPage(<AvailabilityDialog kind="absence" own={{ ...OWN, orga: true }} target={anna} categoryId="c-tbc" onClose={vi.fn()} onSaved={vi.fn()} />);
            expect(screen.getByText(t("signups.availability.dialog.forName", { name: "Anna" }))).toBeInTheDocument();
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith({
                kind: "absence", from: "2026-10-05", to: "2026-10-05", scope: [{ guildId: "g1", categoryIds: ["c-tbc"] }], userId: "u9",
            }));
            await user.click(screen.getByRole("button", { name: t("signups.availability.dialog.backToMe") }));
            expect(screen.getByRole("button", { name: t("signups.availability.dialog.forRaider") })).toBeInTheDocument();
        });

        it("ignores a picked raider for somebody who is no orga", () => {
            renderPage(<AvailabilityDialog kind="absence" own={OWN} target={{ userId: "u9", name: "Anna", character: "", className: "" }} onClose={vi.fn()} onSaved={vi.fn()} />);
            expect(screen.queryByText(t("signups.availability.dialog.forName", { name: "Anna" }))).not.toBeInTheDocument();
        });
    });

    describe("editing", () => {
        const ENTRY: AvailabilityEntry = {
            id: "e1", kind: "presence", from: "2026-10-03", to: "2026-10-12", comment: "", character: "Zibbo", spec: "Priest-Shadow",
            specLabel: "Shadow", versionId: "tbc", categoryId: "", categoryName: "", byOrga: false, done: 1,
            scope: [{ guildId: "g1", name: "Pulse", categories: [{ id: "c-tbc", name: "Raids TBC" }] }],
            characters: [
                { character: "Zibbo", spec: "Priest-Shadow", versionId: "tbc", specLabel: "Shadow" },
                { character: "Zibbowar", spec: "Warrior-Protection", versionId: "tbc", specLabel: "Protection" },
            ],
        };
        const WITH_ENTRY: AvailabilityData = { ...TWO, entries: [ENTRY] };

        it("opens filled in: title, period, where, characters — and no kind to switch", async () => {
            show("presence", WITH_ENTRY, { entryId: "e1" });
            expect(screen.getByText(t("signups.availability.dialog.titleEditPresence"))).toBeInTheDocument();
            expect(screen.getByText(t("signups.availability.dialog.hintEdit"))).toBeInTheDocument();
            expect(screen.queryByRole("radio")).not.toBeInTheDocument();
            // an entry already running keeps its start
            expect(screen.getByLabelText(t("signups.availability.dialog.from"))).toHaveValue("2026-10-03");
            expect(screen.getByLabelText(t("signups.availability.dialog.to"))).toHaveValue("2026-10-12");
            expect(chip(serverGroup("Pulse"), "Raids TBC")).toHaveAttribute("aria-pressed", "true");
            expect(allChip(serverGroup("Pulse"))).toHaveAttribute("aria-pressed", "false");
            expect(allChip(serverGroup("PuGs"))).toHaveAttribute("aria-pressed", "false");
            expect(charRow("Zibbo")).toHaveAttribute("aria-pressed", "true");
            expect(charRow("Zibbowar")).toHaveAttribute("aria-pressed", "true");
            expect(specOf("Zibbo")).toHaveValue("Priest-Shadow");
            await waitFor(() => expect(api.previewAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ id: "e1" })));
        });

        it("keeps the raids the entry already changed and saves by PUT with the id", async () => {
            const user = userEvent.setup();
            vi.mocked(api.previewAvailability).mockResolvedValue({ raids: [{ ...RAIDS[0], status: "", applied: true }, RAIDS[1]] });
            const { onSaved, onClose } = show("presence", WITH_ENTRY, { entryId: "e1" });
            expect(await raidRow("Kara Freitag")).toBeDisabled();
            expect(screen.getByText(t("signups.availability.dialog.applied"))).toBeInTheDocument();
            await waitFor(() => expect(saveButton("edit")).toBeEnabled());
            expect(saveButton("edit")).toHaveClass("btn-go");
            await user.click(saveButton("edit"));
            expect(api.updateAvailability).toHaveBeenCalledWith({
                kind: "presence", from: "2026-10-03", to: "2026-10-12", scope: [{ guildId: "g1", categoryIds: ["c-tbc"] }],
                characters: [{ character: "zibbo", spec: "Priest-Shadow" }, { character: "zibbowar", spec: "Warrior-Protection" }],
                id: "e1", comment: "", eventIds: ["gruul"],
            });
            expect(api.saveAvailability).not.toHaveBeenCalled();
            expect(onSaved).toHaveBeenCalled();
            expect(onClose).toHaveBeenCalled();
        });

        it("an absence keeps its reason", async () => {
            const absence: AvailabilityEntry = { ...ENTRY, id: "e2", kind: "absence", comment: "Urlaub", characters: [], character: "", spec: "" };
            show("absence", { ...WITH_ENTRY, entries: [absence] }, { entryId: "e2" });
            expect(screen.getByText(t("signups.availability.dialog.titleEditAbsence"))).toBeInTheDocument();
            expect(screen.getByLabelText(t("signups.availability.dialog.reason"), { exact: false })).toHaveValue("Urlaub");
        });

        it("an older entry without scope holds everywhere", () => {
            show("absence", { ...WITH_ENTRY, entries: [{ ...ENTRY, kind: "absence", scope: [] }] }, { entryId: "e1" });
            expect(allChip(serverGroup("Pulse"))).toHaveAttribute("aria-pressed", "true");
            expect(allChip(serverGroup("PuGs"))).toHaveAttribute("aria-pressed", "true");
        });

        it("says so when the entry is gone", () => {
            show("absence", OWN, { entryId: "gone" });
            expect(screen.getByRole("alert")).toHaveTextContent(t("signups.availability.dialog.entryGone"));
        });

        it("the orga edits a raider's entry with their data and their id", async () => {
            const user = userEvent.setup();
            vi.mocked(api.getAvailability).mockResolvedValue({ ...WITH_ENTRY, userId: "u9", name: "Anna" });
            const anna = { userId: "u9", name: "Anna", character: "Annadruid", className: "Druid" };
            renderPage(<AvailabilityDialog kind="presence" own={{ ...OWN, orga: true }} target={anna} entryId="e1" onClose={vi.fn()} onSaved={vi.fn()} />);
            expect(await screen.findByText(t("signups.availability.dialog.hintEditFor", { name: "Anna" }))).toBeInTheDocument();
            expect(api.getAvailability).toHaveBeenCalledWith("u9");
            // no raider picker while editing
            expect(screen.queryByRole("button", { name: t("signups.availability.dialog.backToMe") })).not.toBeInTheDocument();
            await waitFor(() => expect(saveButton("edit")).toBeEnabled());
            await user.click(saveButton("edit"));
            expect(api.updateAvailability).toHaveBeenCalledWith(expect.objectContaining({ id: "e1", userId: "u9" }));
        });
    });
});
