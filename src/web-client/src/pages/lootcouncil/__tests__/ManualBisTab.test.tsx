// The hand-maintained BiS lists (#760) against a mocked API: pick a spec by its
// icon, the slots as rows, add by Wowhead or by item id, reorder and remove;
// an id Wowhead does not know stays visible as "Item <id>"; a reader sees the
// lists without controls; without a Wowhead path only the id field is offered.
// Item ids are test ids, not game data.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { ManualBisData } from "../../../api";
import { renderPage } from "../../../test/render";
import { switchLang } from "../../../test/i18n";
import { ManualBisTab } from "../ManualBisTab";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getManualBis: vi.fn(),
    saveManualBisSlot: vi.fn(),
    searchManualBisItems: vi.fn(),
}));

const SLOTS = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17].map((slot) => ({ slot, slotName: `Slot ${slot}` }));
const spec = (key: string, label: string, role: string, filled = 0) => ({
    key, label, className: key.split("-")[0], spec: key.split("-")[1], role, iconUrl: `https://icons/${key}.jpg`, classColor: "#fff", filled,
});
const manualData = (over: Partial<ManualBisData> = {}): ManualBisData => ({
    versionId: "forever",
    versionLabel: "WoW Forever",
    available: true,
    off: false,
    search: true,
    maxPerSlot: 3,
    slots: SLOTS,
    specs: [spec("Priest-Shadow", "Schattenpriester", "caster", 1), spec("Mage-Fire", "Feuer-Magier", "caster"), spec("Paladin-Holy", "Heilig-Paladin", "healer")],
    lists: {
        "Priest-Shadow": {
            slots: {
                0: [
                    { id: 900001, name: "Kapuze", iconUrl: "", quality: 4, link: "" },
                    { id: 900002, name: "", iconUrl: "", quality: null, link: "" },
                ],
            },
            at: 1_790_000_000_000,
            by: "Orga",
        },
    },
    ...over,
});

const onSaved = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getManualBis).mockResolvedValue(manualData());
    vi.mocked(api.saveManualBisSlot).mockImplementation(async () => ({ ...manualData(), unresolved: [] }));
    vi.mocked(api.searchManualBisItems).mockResolvedValue({ items: [{ id: 900003, name: "Kapuzenmantel", iconUrl: "", quality: 3 }], search: true });
});

const slotRow = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("ManualBisTab", () => {
    it("opens the first spec with a list: its slots, BiS first, an unknown id as Item <id>", async () => {
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        expect(await screen.findByRole("button", { name: "Schattenpriester" })).toHaveAttribute("aria-pressed", "true");
        expect(api.getManualBis).toHaveBeenCalledWith("forever");
        const head = slotRow("Kapuze");
        expect(within(head).getByText("BiS")).toBeInTheDocument();
        expect(screen.getByText("Item 900002")).toBeInTheDocument();
        expect(screen.getByText("Alternative")).toBeInTheDocument();
        // the count comes with its word
        expect(screen.getByText("1 von 17 Slots")).toBeInTheDocument();
    });

    it("picks another spec by its icon", async () => {
        const user = userEvent.setup();
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        await user.click(await screen.findByRole("button", { name: "Feuer-Magier" }));
        expect(screen.getByRole("button", { name: "Feuer-Magier" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("0 von 17 Slots")).toBeInTheDocument();
        expect(screen.queryByText("Kapuze")).not.toBeInTheDocument();
    });

    it("moves an alternative to the front and removes an item - each a save of the whole slot", async () => {
        const user = userEvent.setup();
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        await screen.findByText("Kapuze");
        await user.click(screen.getByRole("button", { name: "Als BiS nach vorn" }));
        expect(api.saveManualBisSlot).toHaveBeenLastCalledWith("forever", "Priest-Shadow", 0, [900002, 900001]);
        await user.click(screen.getByRole("button", { name: "Kapuze entfernen" }));
        expect(api.saveManualBisSlot).toHaveBeenLastCalledWith("forever", "Priest-Shadow", 0, [900002]);
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    });

    it("adds by item id and says when Wowhead does not know it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveManualBisSlot).mockResolvedValue({ ...manualData(), unresolved: [900009] });
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        await screen.findByText("Kapuze");
        await user.click(screen.getByRole("button", { name: "Item für Hals hinzufügen" }));
        await user.type(screen.getByRole("textbox", { name: "Item-ID" }), "9000x09");
        await user.click(screen.getByRole("button", { name: "Hinzufügen" }));
        expect(api.saveManualBisSlot).toHaveBeenCalledWith("forever", "Priest-Shadow", 1, [900009]);
        const note = await screen.findByText(/Wowhead kennt Item 900009 \(noch\) nicht/);
        // a hint, not a success
        expect(note.closest(".toast")).toHaveClass("toast-warn");
    });

    it("leaves the ids already in the slot out of the search, and doubles", async () => {
        const user = userEvent.setup();
        vi.mocked(api.searchManualBisItems).mockResolvedValue({
            items: [{ id: 900001, name: "Kapuze", iconUrl: "", quality: 4 }, { id: 900003, name: "Kapuzenmantel", iconUrl: "", quality: 3 }, { id: 900003, name: "Kapuzenmantel", iconUrl: "", quality: 3 }],
            search: true,
        });
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        await screen.findByText("Kapuze");
        await user.click(screen.getByRole("button", { name: "Item für Kopf hinzufügen" }));
        await user.type(screen.getByPlaceholderText("Item auf Wowhead suchen …"), "kapu");
        expect(await screen.findAllByText("Kapuzenmantel")).toHaveLength(1);
        expect(screen.getAllByText("Kapuze")).toHaveLength(1);
    });

    it("adds from the Wowhead search of the version", async () => {
        const user = userEvent.setup();
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        await screen.findByText("Kapuze");
        await user.click(screen.getByRole("button", { name: "Item für Kopf hinzufügen" }));
        await user.type(screen.getByPlaceholderText("Item auf Wowhead suchen …"), "kapu");
        await user.click(await screen.findByText("Kapuzenmantel"));
        expect(api.searchManualBisItems).toHaveBeenCalledWith("forever", "kapu");
        expect(api.saveManualBisSlot).toHaveBeenCalledWith("forever", "Priest-Shadow", 0, [900001, 900002, 900003]);
    });

    it("offers only the id field without a Wowhead path, and says why", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getManualBis).mockResolvedValue(manualData({ search: false }));
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        expect(await screen.findByText(/Für WoW Forever ist keine Wowhead-Suche eingerichtet/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Item für Hals hinzufügen" }));
        expect(screen.queryByPlaceholderText("Item auf Wowhead suchen …")).not.toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Item-ID" })).toBeInTheDocument();
    });

    it("shows a reader the lists without controls", async () => {
        renderPage(<ManualBisTab versionId="forever" canWrite={false} onSaved={onSaved} />);
        await screen.findByText("Kapuze");
        expect(screen.queryByRole("button", { name: /entfernen/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /hinzufügen/ })).not.toBeInTheDocument();
    });

    it("says so for a version with its own BiS lists", async () => {
        vi.mocked(api.getManualBis).mockResolvedValue(manualData({ available: false }));
        renderPage(<ManualBisTab versionId="tbc" canWrite onSaved={onSaved} />);
        expect(await screen.findByText(/hat eigene BiS-Listen/)).toBeInTheDocument();
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<ManualBisTab versionId="forever" canWrite onSaved={onSaved} />);
        expect(await screen.findByText("1 of 17 slots")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add an item for Neck" })).toBeInTheDocument();
        switchLang("de");
    });
});
