// Einstellungen → Kategorien: the open card of a category sorts its settings into
// six tabs (design "A · Sechs Tabs, jede Einstellung eine Karte"), each setting a
// card with a one-line summary and the full explanation behind its (i), the three
// attendance settings in one card with the quota as a free number, and the
// Planung switch decides whether the fixed sheet is offered at all (raid plan OR
// sheet, never both).
import { useState } from "react";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { PlanningMode } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { renderPage } from "../../../test/render";
import type { CategoryAttendance } from "../../../lib/settings/settingsLogic";
import CategoryMatrix, { type CategorySheet } from "../CategoryMatrix";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getRaiderCharacters: vi.fn(),
}));

const noop = () => undefined;

function Harness({ planning = {}, sheets = {}, onSheet = noop, onPlanning, languages, onLanguage, attendance, onAttendance, missing, onCloseCategory, closeBlocked, roles, categoryRoles, hubs, signupChars, onSignupCharacters, raidhelperActive, categoryIds, unproven, otherServer, serverListed, serverOverview, onServerOverview }: {
    /** In the server overview per category; with onServerOverview the card is offered. */
    serverOverview?: Record<string, boolean>;
    onServerOverview?: (id: string, on: boolean) => void;
    /** #927: false = Raid-Helper is off on the active server. */
    raidhelperActive?: boolean;
    /** #926: the active server's categories, those without a proven server, and other servers' ones. */
    categoryIds?: string[];
    unproven?: string[];
    otherServer?: string[];
    serverListed?: boolean;
    /** Characters per signup per category; with onSignupCharacters the card is offered. */
    signupChars?: Record<string, number>;
    onSignupCharacters?: (id: string, count: number) => void;
    missing?: api.MissingCategory[];
    onCloseCategory?: (c: api.MissingCategory) => void;
    closeBlocked?: boolean;
    roles?: api.Role[];
    categoryRoles?: Record<string, string[]>;
    attendance?: Record<string, Partial<CategoryAttendance>>;
    onAttendance?: (id: string, value: CategoryAttendance) => void;
    languages?: Record<string, string>;
    onLanguage?: (id: string, lang: string) => void;
    planning?: Record<string, PlanningMode>;
    sheets?: Record<string, CategorySheet>;
    onSheet?: (id: string, sheet: CategorySheet) => void;
    onPlanning?: (id: string, mode: PlanningMode) => void;
    /** With the Raid- and Orga-Zentrale (their lists loaded). */
    hubs?: boolean;
}) {
    const [plan, setPlan] = useState(planning);
    return (
        <CategoryMatrix
            categories={[{ id: "c1", name: "Raids Mittwoch" }]}
            roles={roles || [{ id: "r1", name: "Raider" }]}
            categoryIds={categoryIds || ["c1"]}
            unproven={unproven}
            otherServer={otherServer}
            serverListed={serverListed}
            categoryRoles={categoryRoles || { c1: ["r1"] }}
            missing={missing}
            onCloseCategory={onCloseCategory}
            closeBlocked={closeBlocked}
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
            raidhelperActive={raidhelperActive}
            onSignupNotes={noop}
            categorySignupCharacters={signupChars}
            onSignupCharacters={onSignupCharacters}
            onSetupDms={noop}
            onAnnounce={noop}
            onDiscordEvent={noop}
            categoryServerOverview={serverOverview}
            onServerOverview={onServerOverview}
            onVoiceChannel={noop}
            onMessageLook={noop}
            categoryLanguage={languages}
            onLanguage={onLanguage}
            categoryAttendance={attendance}
            onAttendance={onAttendance}
            onSheet={onSheet}
            availabilityPanels={hubs ? { panels: [], channels: [], links: {}, maxLinks: 5, onChange: noop, onLinks: noop } : undefined}
            orgaHubs={hubs ? { hubs: [], channels: [], onChange: noop, links: {}, maxLinks: 5, onLinks: noop } : undefined}
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
const label = (key: string) => `${t(`settings.categories.tabs.${key}`)}`;

beforeEach(() => {
    vi.mocked(api.getRaiderCharacters).mockResolvedValue({ categoryId: "c1", raiders: [], characters: {} } as never);
});

describe("CategoryMatrix: the open card's tabs", () => {
    it("shows the tabs with their field counts, the Raider tab open", async () => {
        await openCard();
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((b) => b.textContent)).toEqual([
            `${label("raider")}2`,
            // source, template, voice channel, announcement, Discord event
            `${label("events")}5`,
            `${label("message")}3`,
            // no Discord-Zentralen without their lists; Planung + setup DMs, no sheet while it plans with the raid plan
            `${label("plan")}2`,
            `${label("loot")}2`,
        ]);
        expect(tab("raider")).toHaveAttribute("aria-selected", "true");
        const panel = screen.getByRole("tabpanel");
        expect(panel).toHaveAttribute("aria-labelledby", tab("raider").id);
        // the tab says in one line what it covers
        expect(within(panel).getByText(t("settings.categories.tabsIntro.raider"))).toBeVisible();
        expect(within(panel).getByText(t("settings.categories.raiderRoles"))).toBeInTheDocument();
        // a short line is visible, the full explanation sits behind the (i)
        expect(within(panel).getByText(t("settings.categories.raiderRolesShort"))).toBeVisible();
        expect(within(panel).queryByText(t("settings.categories.raiderRolesSub"))).toBeNull();
        const more = within(panel).getByRole("button", { name: t("settings.categories.moreAbout", { label: t("settings.categories.raiderRoles") }) });
        expect(more).toHaveAttribute("data-tip-sub", t("settings.categories.raiderRolesSub"));
        // nothing of the other tabs is rendered
        expect(screen.queryByRole("radiogroup", { name: t("settings.categories.newEventsAria", { name: "Raids Mittwoch" }) })).toBeNull();
        expect(screen.queryByRole("radiogroup", { name: t("settings.categories.lootAddonAria", { name: "Raids Mittwoch" }) })).toBeNull();
    });

    // #927: a server without Raid-Helper offers only EventHelper for new events
    it("offers only EventHelper for new events when Raid-Helper is off on this server", async () => {
        const user = await openCard({ raidhelperActive: false });
        expect(screen.queryByText(t("settings.categories.stillRh", { count: 1 }))).toBeNull();
        await user.click(tab("events"));
        const events = screen.getByRole("tabpanel");
        expect(within(events).queryByRole("radiogroup", { name: t("settings.categories.newEventsAria", { name: "Raids Mittwoch" }) })).toBeNull();
        expect(within(events).getByText("EventHelper")).toHaveAttribute("data-source", "eventhelper");
        expect(within(events).getByText(t("settings.categories.newEventsNoRh"))).toBeInTheDocument();
    });

    it("switches tabs by click and shows only that tab's fields", async () => {
        const user = await openCard();
        await user.click(tab("loot"));
        expect(tab("loot")).toHaveAttribute("aria-selected", "true");
        const panel = screen.getByRole("tabpanel");
        expect(within(panel).getByRole("radiogroup", { name: t("settings.categories.lootAddonAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(panel).getByText(t("settings.categories.lootAddonShort"))).toBeInTheDocument();
        expect(within(panel).queryByText(t("settings.categories.raiderRoles"))).toBeNull();

        // everything that happens when an event is created sits in "Neue Events"
        await user.click(tab("events"));
        const events = screen.getByRole("tabpanel");
        expect(within(events).getByRole("radiogroup", { name: t("settings.categories.newEventsAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(events).getByRole("checkbox", { name: t("settings.categories.discordEventAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(events).getByText(t("settings.categories.voice"))).toBeInTheDocument();
        expect(within(events).getByLabelText(t("settings.categories.template"))).toBeInTheDocument();

        // the signup message's look and the tentative/decline question sit together
        await user.click(tab("message"));
        const message = screen.getByRole("tabpanel");
        expect(within(message).getByRole("radiogroup", { name: t("settings.categories.notesAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
        expect(within(message).getByRole("checkbox", { name: t("settings.categories.raidArtAria", { name: "Raids Mittwoch" }) })).toBeInTheDocument();
    });

    it("offers the Discord-Zentralen tab with the Raid- and Orga-Zentrale once their lists are loaded", async () => {
        const user = await openCard({ hubs: true });
        expect(screen.getAllByRole("tab").map((b) => b.textContent)[3]).toBe(`${label("hubs")}2`);
        await user.click(tab("hubs"));
        const panel = screen.getByRole("tabpanel");
        expect(within(panel).getByText(t("settings.categories.panel"))).toBeInTheDocument();
        expect(within(panel).getByText(t("settings.categories.orgaHub"))).toBeInTheDocument();
        expect(within(panel).getByText(t("settings.categories.links"))).toBeInTheDocument();
    });

    it("switches a category out of the server overview in the Discord-Zentralen tab, shown by default", async () => {
        const onServerOverview = vi.fn();
        const user = await openCard({ onServerOverview });
        // the switch alone is enough for the tab
        await user.click(tab("hubs"));
        const panel = screen.getByRole("tabpanel");
        expect(within(panel).getByText(t("settings.categories.serverOverviewShort"))).toBeVisible();
        const toggle = within(panel).getByRole("checkbox", { name: t("settings.categories.serverOverviewAria", { name: "Raids Mittwoch" }) });
        expect(toggle).toBeChecked();
        await user.click(toggle);
        expect(onServerOverview).toHaveBeenCalledWith("c1", false);
    });

    it("shows a category left out of the server overview switched off and switches it back on", async () => {
        const onServerOverview = vi.fn();
        const user = await openCard({ serverOverview: { c1: false }, onServerOverview });
        await user.click(tab("hubs"));
        const toggle = screen.getByRole("checkbox", { name: t("settings.categories.serverOverviewAria", { name: "Raids Mittwoch" }) });
        expect(toggle).not.toBeChecked();
        await user.click(toggle);
        expect(onServerOverview).toHaveBeenCalledWith("c1", true);
    });

    it("moves between the tabs with the arrow keys, Home and End", async () => {
        const user = await openCard();
        tab("raider").focus();
        await user.keyboard("{ArrowRight}");
        expect(tab("events")).toHaveAttribute("aria-selected", "true");
        expect(tab("events")).toHaveFocus();
        await user.keyboard("{End}");
        expect(tab("loot")).toHaveFocus();
        await user.keyboard("{ArrowRight}");
        expect(tab("raider")).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{ArrowLeft}");
        expect(tab("loot")).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{Home}");
        expect(tab("raider")).toHaveFocus();
        // only the open tab is in the tab order
        expect(tab("raider")).toHaveAttribute("tabindex", "0");
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
        expect(tab("plan").textContent).toBe(`${label("plan")}3`);

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
        expect(tab("message").textContent).toBe(`${label("message")}4`);
        const group = screen.getByRole("radiogroup", { name: t("settings.categories.languageAria", { name: "Raids Mittwoch" }) });
        expect(within(group).getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText(t("settings.categories.languageShort"))).toBeVisible();
        await user.click(within(group).getByRole("radio", { name: t("settings.categories.languageServer") }));
        expect(onLanguage).toHaveBeenCalledWith("c1", "");
        await user.click(within(group).getByRole("radio", { name: "Deutsch" }));
        expect(onLanguage).toHaveBeenLastCalledWith("c1", "de");
    });

    it("keeps attendance in one card of the Raider tab: shown or not, over how many raids, in the absence overview or not", async () => {
        const onAttendance = vi.fn();
        const user = await openCard({ attendance: { c1: { window: 8 } }, onAttendance });
        // roles, characters and the attendance card
        expect(tab("raider").textContent).toBe(`${label("raider")}3`);
        const name = "Raids Mittwoch";
        const card = screen.getByText(t("settings.categories.attendanceBlock")).closest(".cat-field-wrap") as HTMLElement;
        expect(card).toHaveAttribute("data-field", "attendance");
        expect(within(card).getByRole("checkbox", { name: t("settings.categories.attendanceAria", { name }) })).toBeInTheDocument();
        expect(within(card).getByRole("checkbox", { name: t("settings.categories.absencesAria", { name }) })).toBeInTheDocument();
        expect(within(card).getByRole("spinbutton", { name: t("settings.categories.attendanceWindowAria", { name }) })).toHaveValue(8);

        await user.click(screen.getByRole("checkbox", { name: t("settings.categories.absencesAria", { name }) }));
        expect(onAttendance).toHaveBeenLastCalledWith("c1", { show: true, window: 8, absences: false });
        await user.click(screen.getByRole("checkbox", { name: t("settings.categories.attendanceAria", { name }) }));
        expect(onAttendance).toHaveBeenLastCalledWith("c1", { show: false, window: 8, absences: true });
    });

    it("counts the quota over any number from 1 to 50: − / + or typed", async () => {
        const onAttendance = vi.fn();
        const user = await openCard({ attendance: { c1: { window: 8 } }, onAttendance });
        const name = "Raids Mittwoch";
        const input = screen.getByRole("spinbutton", { name: t("settings.categories.attendanceWindowAria", { name }) });
        await user.click(screen.getByRole("button", { name: t("settings.categories.attendanceWindowMore") }));
        expect(onAttendance).toHaveBeenLastCalledWith("c1", { show: true, window: 9, absences: true });
        await user.click(screen.getByRole("button", { name: t("settings.categories.attendanceWindowLess") }));
        expect(onAttendance).toHaveBeenLastCalledWith("c1", { show: true, window: 7, absences: true });

        // typed: every valid step is handed over, a half-typed or too large number is not
        onAttendance.mockClear();
        await user.clear(input);
        expect(onAttendance).not.toHaveBeenCalled();
        await user.type(input, "20");
        expect(onAttendance).toHaveBeenLastCalledWith("c1", { show: true, window: 20, absences: true });
        onAttendance.mockClear();
        await user.clear(input);
        await user.type(input, "60");
        expect(onAttendance.mock.calls.map((c) => c[1].window)).toEqual([6]);
        // leaving the field shows the value that counts again
        await user.tab();
        expect(input).toHaveValue(8);
    });

    it("stops − at 1 and + at 50", async () => {
        await openCard({ attendance: { c1: { window: 1 } }, onAttendance: noop });
        expect(screen.getByRole("button", { name: t("settings.categories.attendanceWindowLess") })).toBeDisabled();
        expect(screen.getByRole("button", { name: t("settings.categories.attendanceWindowMore") })).toBeEnabled();
    });

    it("keeps a stored 50 and stops + there", async () => {
        await openCard({ attendance: { c1: { window: 50 } }, onAttendance: noop });
        expect(screen.getByRole("spinbutton", { name: t("settings.categories.attendanceWindowAria", { name: "Raids Mittwoch" }) })).toHaveValue(50);
        expect(screen.getByRole("button", { name: t("settings.categories.attendanceWindowMore") })).toBeDisabled();
    });

    it("hides the quota while the attendance is not shown", async () => {
        await openCard({ attendance: { c1: { show: false } }, onAttendance: noop });
        expect(screen.getByRole("checkbox", { name: t("settings.categories.attendanceAria", { name: "Raids Mittwoch" }) })).not.toBeChecked();
        expect(screen.queryByRole("spinbutton", { name: t("settings.categories.attendanceWindowAria", { name: "Raids Mittwoch" }) })).toBeNull();
    });

    it("sets the characters per signup in the message tab: 8 by default, − / + within 1..8", async () => {
        const onSignupCharacters = vi.fn();
        const user = await openCard({ onSignupCharacters });
        await user.click(tab("message"));
        const name = "Raids Mittwoch";
        const input = screen.getByRole("spinbutton", { name: t("settings.categories.signupCharsAria", { name }) });
        const card = input.closest("[data-field]") as HTMLElement;
        expect(card).toHaveAttribute("data-field", "signupChars");
        expect(within(card).getByText(t("settings.categories.signupChars"))).toBeInTheDocument();
        expect(within(card).getByText(t("settings.categories.signupCharsShort"))).toBeInTheDocument();
        expect(input).toHaveValue(8);
        // 8 is the most there is
        expect(screen.getByRole("button", { name: t("settings.categories.signupCharsMore") })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: t("settings.categories.signupCharsLess") }));
        expect(onSignupCharacters).toHaveBeenLastCalledWith("c1", 7);
        onSignupCharacters.mockClear();
        await user.clear(input);
        await user.type(input, "9");
        expect(onSignupCharacters).not.toHaveBeenCalled();
        await user.clear(input);
        await user.type(input, "3");
        expect(onSignupCharacters).toHaveBeenLastCalledWith("c1", 3);
    });

    it("shows a category's own number and stops − at 1", async () => {
        const user = await openCard({ signupChars: { c1: 1 }, onSignupCharacters: noop });
        await user.click(tab("message"));
        expect(screen.getByRole("spinbutton", { name: t("settings.categories.signupCharsAria", { name: "Raids Mittwoch" }) })).toHaveValue(1);
        expect(screen.getByRole("button", { name: t("settings.categories.signupCharsLess") })).toBeDisabled();
        expect(tab("message")).toHaveTextContent(`${label("message")}4`);
    });

    it("words the tabs in English", async () => {
        await switchLang("en");
        await openCard();
        expect(screen.getByRole("tablist", { name: "Settings of Raids Mittwoch" })).toBeInTheDocument();
        expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Raiders2", "New events5", "Signup message3", "Setup & planning2", "Loot2"]);
    });
});

describe("CategoryMatrix: a category's life (#744)", () => {
    // the tabs' English case above leaves the page in English
    beforeEach(() => switchLang("de"));

    const gone: api.MissingCategory = {
        categoryId: "gone", name: "TBC Montag", active: false, series: { enabled: true, weekdays: [1], time: "19:30" }, reminders: false,
        settings: [], councilProfile: false, kaders: [], rosters: [], upcoming: 0,
    };

    it("marks a category deleted in Discord under its last name and offers to close it", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        renderPage(<Harness missing={[gone]} onCloseCategory={onClose} />);
        const row = screen.getByText("TBC Montag").closest(".cat-row") as HTMLElement;
        expect(within(row).getByText("in Discord gelöscht")).toBeInTheDocument();
        expect(within(row).queryByText("unbekannt")).toBeNull();
        await user.click(within(row).getByRole("button", { name: "Kategorie abschließen" }));
        expect(onClose).toHaveBeenCalledWith(gone);
    });

    // #926 (prod incident 2026-10-27): a category without a proven server is never "deleted"
    it("marks an active category without a proven server as unclear and never offers to close it", () => {
        renderPage(<Harness categoryIds={["c1", "f1"]} categoryRoles={{ c1: ["r1"], f1: ["r1"] }} unproven={["f1"]} onCloseCategory={noop} />);
        const row = document.querySelector('[data-category="f1"]') as HTMLElement;
        expect(within(row).getByText("Server unklar")).toBeInTheDocument();
        expect(within(row).queryByText("unbekannt")).toBeNull();
        expect(within(row).queryByText("in Discord gelöscht")).toBeNull();
        expect(within(row).queryByRole("button", { name: "Kategorie abschließen" })).toBeNull();
    });

    it("says once when the active server is not in the server list, also without categories", () => {
        renderPage(<Harness serverListed={false} />);
        expect(screen.getByRole("status")).toHaveTextContent("Server nicht in der Server-Liste");
        cleanup();
        renderPage(<Harness serverListed={false} categoryIds={[]} categoryRoles={{}} />);
        expect(screen.getByText("Server nicht in der Server-Liste")).toBeInTheDocument();
    });

    it("shows no such note on a listed server", () => {
        renderPage(<Harness />);
        expect(screen.queryByText("Server nicht in der Server-Liste")).toBeNull();
    });

    it("leaves another server's categories off the page", () => {
        renderPage(<Harness categoryRoles={{ c1: ["r1"], b1: ["r1"] }} otherServer={["b1"]} />);
        expect(document.querySelector('[data-category="b1"]')).toBeNull();
        expect(document.querySelector('[data-category="c1"]')).not.toBeNull();
    });

    it("keeps the close action shut while the page has unsaved changes", () => {
        renderPage(<Harness missing={[gone]} onCloseCategory={noop} closeBlocked />);
        expect(screen.getByRole("button", { name: "Kategorie abschließen" })).toBeDisabled();
    });

    it("offers a renamed raider role by its id, also in a category that does not use it yet", async () => {
        const user = userEvent.setup();
        renderPage(<Harness roles={[{ id: "r1", name: "Kern" }, { id: "r2", name: "Gamer" }]} categoryRoles={{ c1: ["r1"] }} />);
        await user.click(screen.getByRole("button", { name: "Details" }));
        expect(screen.getByRole("button", { name: "@Kern" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.queryByRole("button", { name: "@Gamer" })).toBeNull();
    });
});
