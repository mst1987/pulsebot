// The character page (design issue #218): three sections behind a remembered
// switch, findings on the slot rows, item details in a modal addressed by the
// url, attendance night by night, and loot that only a writer may delete.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import * as api from "../api";
import type { GearItem, HistoryCharData, LootItem, RosterCharData } from "../api";
import HistoryCharPage from "./HistoryCharPage";
import { adminUser, renderPage } from "../test/render";
import { t } from "../i18n";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getHistoryChar: vi.fn(),
    getRosterChar: vi.fn(),
    deleteLootItems: vi.fn(),
}));

const SECONDS = Math.floor(Date.UTC(2026, 5, 15, 20, 0, 0) / 1000); // Mo 15.06.2026, as the API sends it

function gear(slot: string, itemId: number, name: string, over: Partial<GearItem> = {}): GearItem {
    return { slot, itemId, name, quality: "EPIC", level: 115, enchants: [], enchantIds: [], sockets: [], iconUrl: "", ...over };
}

function loot(over: Partial<LootItem> = {}): LootItem {
    return {
        id: "l1", itemId: 500, itemName: "Klinge der Probe", itemLink: "", character: "Alpha", response: "BiS",
        offspec: false, reason: "", reasonLabel: "", reasonTone: "", contentId: "kara", tokenTier: "", boss: "Prince",
        awardedAt: Date.UTC(2026, 5, 15, 21, 0, 0), source: "gargul",
        ...over,
    } as LootItem;
}

function charData(over: Partial<HistoryCharData> = {}): HistoryCharData {
    return {
        character: "Alpha",
        realm: "Thunderstrike",
        items: [loot()],
        armoryUrl: "",
        wclUrl: "",
        gear: [
            gear("HEAD", 100, "Helm der Probe"),
            gear("SHIRT", 101, "Hemd des Glücks"),
            gear("TABARD", 102, "Wappenrock der Gilde"),
            gear("CHEST", 103, "Brustplatte der Probe", { enchants: ["+6 Werte"] }),
        ],
        gearConfigured: true,
        gearError: "",
        charSummary: null,
        gearNamespace: "profile-classic1x-eu",
        info: null,
        gearIssues: {
            character: "Alpha", className: "Mage", issueCount: 1,
            issues: [{ kind: "enchant", label: "keine Verzauberung", severity: "high", itemId: "100", itemName: "Helm der Probe", slotName: "Kopf", slotKey: "HEAD", iconUrl: "" }],
            reportRefId: "r1", reportId: "wcl1", reportUrl: "", reportTitle: "Karazhan", zone: "Karazhan", generatedAt: 0,
        },
        ...over,
    };
}

function rosterFacts(): RosterCharData {
    return {
        character: "Alpha",
        role: "dps",
        categories: [{ id: "c1", name: "Montagsraid", raids: 2, contents: ["Karazhan"], icon: "" }],
        attendance: {
            c1: {
                attended: 1, total: 2, pct: 50,
                missed: [{ eventId: "e2", title: "Kara", startTime: SECONDS + 7 * 86400, reason: "nicht im Log" }],
                raids: [
                    { eventId: "e1", title: "Kara Montag", startTime: SECONDS, attended: true, reason: "im Log" },
                    { eventId: "e2", title: "Kara Montag", startTime: SECONDS + 7 * 86400, attended: false, reason: "nicht im Log" },
                ],
            },
        },
        items: {},
    };
}

function LocationProbe() {
    const { search } = useLocation();
    return <output data-testid="location">{search}</output>;
}

async function openPage(route = "/roster/char?name=Alpha", user = adminUser(), data = charData()) {
    vi.mocked(api.getHistoryChar).mockResolvedValue(data);
    renderPage(<><HistoryCharPage /><LocationProbe /></>, { route, user });
    await screen.findByRole("tablist", { name: "Bereich" });
}

const search = () => new URLSearchParams(screen.getByTestId("location").textContent || "");

beforeEach(() => {
    vi.mocked(api.getRosterChar).mockResolvedValue(rosterFacts());
    vi.mocked(api.deleteLootItems).mockResolvedValue({ removed: 1 });
});

describe("HistoryCharPage — sections", () => {
    it("shows gear, loot and attendance behind a switch, remembered for the next visit", async () => {
        await openPage();
        const tabs = within(screen.getByRole("tablist", { name: "Bereich" })).getAllByRole("tab");
        expect(tabs.map((tab) => tab.textContent)).toEqual([
            expect.stringMatching(/^Ausrüstung/), expect.stringMatching(/^Loot-Historie/), expect.stringMatching(/^Anwesenheit/),
        ]);
        expect(screen.getByRole("tab", { name: /Ausrüstung/ })).toHaveAttribute("aria-selected", "true");

        const user = userEvent.setup();
        await user.click(screen.getByRole("tab", { name: /Loot-Historie/ }));
        expect(screen.getByRole("tab", { name: /Loot-Historie/ })).toHaveAttribute("aria-selected", "true");
        expect(search().get("tab")).toBe("loot");
        expect(screen.getByText("Klinge der Probe")).toBeInTheDocument();
        expect(window.localStorage.getItem("eh-history-char-tab")).toBe("\"loot\"");
    });

    it("opens on the remembered section without a param, and the url wins over it", async () => {
        window.localStorage.setItem("eh-history-char-tab", "\"loot\"");
        await openPage("/roster/char?name=Alpha&tab=attendance");
        expect(screen.getByRole("tab", { name: /Anwesenheit/ })).toHaveAttribute("aria-selected", "true");
    });

    it("falls back to the gear on a stored section that does not exist", async () => {
        window.localStorage.setItem("eh-history-char-tab", "\"stats\"");
        await openPage();
        expect(screen.getByRole("tab", { name: /Ausrüstung/ })).toHaveAttribute("aria-selected", "true");
    });

    it("has no back link to the roster and no namespace meta row", async () => {
        await openPage();
        expect(screen.queryByText(/Zurück zum Roster/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Profile-Namespace/)).not.toBeInTheDocument();
    });
});

describe("HistoryCharPage — gear", () => {
    it("puts the findings on their slot rows and leaves out shirt and tabard", async () => {
        await openPage();
        const head = screen.getByRole("button", { name: /Helm der Probe/ });
        expect(within(head).getByText("Keine Verzauberung")).toBeInTheDocument();
        const chest = screen.getByRole("button", { name: /Brustplatte der Probe/ });
        expect(within(chest).queryByText("Keine Verzauberung")).not.toBeInTheDocument();
        expect(screen.queryByText("Hemd des Glücks")).not.toBeInTheDocument();
        expect(screen.queryByText("Wappenrock der Gilde")).not.toBeInTheDocument();
        // an empty slot is still a row
        expect(screen.getAllByText("leer").length).toBeGreaterThan(0);
    });

    it("asks the roster facts for the worn items", async () => {
        await openPage();
        await waitFor(() => expect(api.getRosterChar).toHaveBeenCalledWith("Alpha", [100, 101, 102, 103]));
    });

    it("opens an item's details in a modal addressed by the url", async () => {
        await openPage();
        const user = userEvent.setup();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Helm der Probe/ }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Helm der Probe", { selector: ".dlg-title" })).toBeInTheDocument();
        expect(within(dialog).getByText("fehlt")).toBeInTheDocument();
        expect(search().get("item")).toBe("HEAD");

        await user.click(within(dialog).getAllByRole("button", { name: "Schließen" })[1]); // the foot button; [0] is the head's X
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(search().get("item")).toBeNull();
    });

    it("opens the modal straight from a link", async () => {
        await openPage("/roster/char?name=Alpha&item=CHEST");
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Brustplatte der Probe", { selector: ".dlg-title" })).toBeInTheDocument();
        expect(within(dialog).getByText("vorhanden")).toBeInTheDocument();
    });
});

describe("HistoryCharPage — loot and attendance", () => {
    const deleteName = () => t("raidDetail.loot.deleteEntryAria", { item: "Klinge der Probe", character: "Alpha" });

    it("lets a writer delete a loot row, after the table asked", async () => {
        await openPage("/roster/char?name=Alpha&tab=loot");
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: deleteName() }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("raidDetail.loot.deleteAction") }));
        await waitFor(() => expect(api.deleteLootItems).toHaveBeenCalledWith(["l1"]));
        await waitFor(() => expect(screen.queryByText("Klinge der Probe")).not.toBeInTheDocument());
    });

    it("shows the loot read-only without history write access", async () => {
        const reader = adminUser({ isAdmin: false, access: { history: { read: true, write: false } } });
        await openPage("/roster/char?name=Alpha&tab=loot", reader);
        expect(screen.getByText("Klinge der Probe")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: deleteName() })).not.toBeInTheDocument();
    });

    it("dates each raid night from the API's unix seconds", async () => {
        await openPage("/roster/char?name=Alpha&tab=attendance");
        expect(await screen.findByText("Mo 15.06.")).toBeInTheDocument();
        expect(screen.getByText("Mo 22.06.")).toBeInTheDocument();
        expect(screen.queryByText(/\.01\.$/)).not.toBeInTheDocument();
        expect(screen.getByText("da")).toBeInTheDocument();
        expect(screen.getByText("gefehlt")).toBeInTheDocument();
    });
});
