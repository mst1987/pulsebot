// Einstellungen → Kategorien: the open card of a category sorts its settings into
// four tabs (design "B · Tabs in der Karte"), each setting one row with its
// explanation beside it, and the Planung switch decides whether the fixed sheet
// is offered at all (raid plan OR sheet, never both).
import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { PlanningMode } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import CategoryMatrix, { type CategorySheet } from "./CategoryMatrix";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRaiderCharacters: vi.fn(),
}));

const noop = () => undefined;

function Harness({ planning = {}, sheets = {}, onSheet = noop, onPlanning, languages, onLanguage }: {
    languages?: Record<string, string>;
    onLanguage?: (id: string, lang: string) => void;
    planning?: Record<string, PlanningMode>;
    sheets?: Record<string, CategorySheet>;
    onSheet?: (id: string, sheet: CategorySheet) => void;
    onPlanning?: (id: string, mode: PlanningMode) => void;
}) {
    const [plan, setPlan] = useState(planning);
    return (
        <CategoryMatrix
            categories={[{ id: "c1", name: "Raids Mittwoch" }]}
            roles={[{ id: "r1", name: "Raider" }]}
            categoryIds={["c1"]}
            categoryRoles={{ c1: ["r1"] }}
            categoryLootTool={{ c1: "gargul" }}
            categorySheets={sheets}
            categoryPlanning={plan}
            onPlanning={(id, mode) => { setPlan((p) => ({ ...p, [id]: mode })); if (onPlanning) onPlanning(id, mode); }}
            savedCategoryRoles={{}}
            onToggleCategory={noop}
            onToggleRole={noop}
            onLootTool={noop}
            onLootSystem={noop}
            onSignupSource={noop}
            onSignupNotes={noop}
            onSetupDms={noop}
            onAnnounce={noop}
            onDiscordEvent={noop}
            onVoiceChannel={noop}
            onMessageLook={noop}
            categoryLanguage={languages}
            onLanguage={onLanguage}
            onSheet={onSheet}
            raidTemplates={{ options: [], value: {}, onChange: noop }}
            icon="inv_banner_03"
            crumb="Raid-Kategorien"
        />
    );
}

async function openCard(props: Parameters<typeof Harness>[0] = {}) {
    const user = userEvent.setup();
    renderPage(<Harness {...props} />);
    await user.click(screen.getByRole("button", { name: "Details" }));
    return user;
}

const tab = (key: string) => screen.getByRole("tab", { name: new RegExp(`^${t(`settings.categories.tabs.${key}`).replace(/[&]/g, "\\&")}`) });

beforeEach(() => {
    vi.mocked(api.getRaiderCharacters).mockResolvedValue({ categoryId: "c1", raiders: [], characters: {} } as never);
});

describe("CategoryMatrix: the open card's tabs", () => {
    it("shows four tabs with their field counts, the first one open", async () => {
        await openCard();
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((b) => b.textContent)).toEqual([
            `${t("settings.categories.tabs.signup")}4`,
            `${t("settings.categories.tabs.message")}5`,
            // template, setup DMs, Planung - no sheet while it plans with the raid plan
            `${t("settings.categories.tabs.plan")}3`,
            `${t("settings.categories.tabs.loot")}2`,
        ]);
        expect(tab("signup")).toHaveAttribute("aria-selected", "true");
        const panel = screen.getByRole("tabpanel");
        expect(panel).toHaveAttribute("aria-labelledby", tab("signup").id);
        expect(within(panel).getByRole("radiogroup", { name: t("settings.categories.newEventsAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(panel).getByText(t("settings.categories.raiderRoles"))).toBeInTheDocument();
        // the explanation sits beside the control, not only behind an "i"
        expect(within(panel).getByText(t("settings.categories.newEventsSub"))).toBeVisible();
        // nothing of the other tabs is rendered
        expect(screen.queryByRole("radiogroup", { name: t("settings.categories.lootAddonAria", { name: "Raids Mittwoch" }) })).toBeNull();
    });

    it("switches tabs by click and shows only that tab's fields", async () => {
        const user = await openCard();
        await user.click(tab("loot"));
        expect(tab("loot")).toHaveAttribute("aria-selected", "true");
        const panel = screen.getByRole("tabpanel");
        expect(within(panel).getByRole("radiogroup", { name: t("settings.categories.lootAddonAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(panel).getByText(t("settings.categories.lootAddonSub"))).toBeInTheDocument();
        expect(within(panel).queryByText(t("settings.categories.raiderRoles"))).toBeNull();

        await user.click(tab("message"));
        const message = screen.getByRole("tabpanel");
        expect(within(message).getByRole("checkbox", { name: t("settings.categories.discordEventAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(message).getByText(t("settings.categories.voice"))).toBeInTheDocument();
    });

    it("moves between the tabs with the arrow keys, Home and End", async () => {
        const user = await openCard();
        tab("signup").focus();
        await user.keyboard("{ArrowRight}");
        expect(tab("message")).toHaveAttribute("aria-selected", "true");
        expect(tab("message")).toHaveFocus();
        await user.keyboard("{End}");
        expect(tab("loot")).toHaveFocus();
        await user.keyboard("{ArrowRight}");
        expect(tab("signup")).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{ArrowLeft}");
        expect(tab("loot")).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{Home}");
        expect(tab("signup")).toHaveFocus();
        // only the open tab is in the tab order
        expect(tab("signup")).toHaveAttribute("tabindex", "0");
        expect(tab("plan")).toHaveAttribute("tabindex", "-1");
    });

    it("offers the fixed sheet only while the category plans with a sheet", async () => {
        const onPlanning = vi.fn();
        const user = await openCard({ onPlanning });
        await user.click(tab("plan"));
        const planning = screen.getByRole("radiogroup", { name: t("settings.categories.planningAria", { name: "Raids Mittwoch" }) });
        expect(within(planning).getByRole("radio", { name: t("settings.planning.raidplan") })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByLabelText(t("settings.categories.sheetLinkAria"))).toBeNull();
        // the head pill says how it plans
        expect(screen.getAllByText(t("settings.planning.raidplan")).length).toBeGreaterThan(1);

        await user.click(within(planning).getByRole("radio", { name: t("settings.planning.sheet") }));
        expect(onPlanning).toHaveBeenCalledWith("c1", "sheet");
        expect(screen.getByLabelText(t("settings.categories.sheetLinkAria"))).toBeInTheDocument();
        expect(screen.getByLabelText(t("settings.categories.fixedSheet"))).toBeInTheDocument();
        expect(tab("plan").textContent).toBe(`${t("settings.categories.tabs.plan")}4`);

        await user.click(within(planning).getByRole("radio", { name: t("settings.planning.raidplan") }));
        expect(screen.queryByLabelText(t("settings.categories.sheetLinkAria"))).toBeNull();
    });

    it("plans with the sheet by default when a fixed sheet is set", async () => {
        const onSheet = vi.fn();
        const user = await openCard({ sheets: { c1: { url: "https://docs.google.com/x", name: "T6" } }, onSheet });
        await user.click(tab("plan"));
        expect(screen.getByRole("radio", { name: t("settings.planning.sheet") })).toHaveAttribute("aria-checked", "true");
        const url = screen.getByLabelText(t("settings.categories.sheetLinkAria"));
        expect(url).toHaveValue("https://docs.google.com/x");
        await user.type(url, "y");
        expect(onSheet).toHaveBeenLastCalledWith("c1", { url: "https://docs.google.com/xy", name: "T6" });
    });

    it("remembers the open tab per category when the card is closed and reopened", async () => {
        const user = await openCard();
        await user.click(tab("loot"));
        await user.click(screen.getByRole("button", { name: "Details" }));
        expect(screen.queryByRole("tablist")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Details" }));
        expect(tab("loot")).toHaveAttribute("aria-selected", "true");
    });

    it("sets the language of the category's posts in the message tab: the server's, German or English", async () => {
        const onLanguage = vi.fn();
        const user = await openCard({ languages: { c1: "en" }, onLanguage });
        await user.click(tab("message"));
        expect(tab("message").textContent).toBe(`${t("settings.categories.tabs.message")}6`);
        const group = screen.getByRole("radiogroup", { name: t("settings.categories.languageAria", { name: "Raids Mittwoch" }) });
        expect(within(group).getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText(t("settings.categories.languageSub"))).toBeVisible();
        await user.click(within(group).getByRole("radio", { name: t("settings.categories.languageServer") }));
        expect(onLanguage).toHaveBeenCalledWith("c1", "");
        await user.click(within(group).getByRole("radio", { name: "Deutsch" }));
        expect(onLanguage).toHaveBeenLastCalledWith("c1", "de");
    });

    it("words the tabs in English", async () => {
        switchLang("en");
        await openCard();
        expect(screen.getByRole("tablist", { name: "Settings of Raids Mittwoch" })).toBeInTheDocument();
        expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Signup4", "Message5", "Setup & planning3", "Loot2"]);
    });
});
