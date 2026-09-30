// The Kaderplaner rendered against a mocked api: opening the last Kader, the
// first Kader, the pool and the import from Discord roles, the interview with
// its autosave, the overview's filters, the Vorläufig drawer (votes, comments,
// decision), the questions, the example setups, a read-only grant and English.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { KaderData } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { adminUser, renderPage } from "../../test/render";
import { kader as kaderData, kaderView, U } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    createKader: vi.fn(),
    setKaderState: vi.fn(),
    addKaderPlayers: vi.fn(),
    saveKaderInterview: vi.fn(),
    completeKaderInterview: vi.fn(),
    setKaderVote: vi.fn(),
    addKaderComment: vi.fn(),
    addKaderQuestion: vi.fn(),
    deleteKaderQuestion: vi.fn(),
    saveKaderVariant: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const SECTION_ORDER = ["roster", "bench", "tentative", "provisional"];
const reader = adminUser({ isAdmin: false, access: { kader: { read: true, write: false } } });

/** What a change inside the Kader answers: the Kader as stored plus the summaries. */
function change(kader: KaderData = kaderData(), extra: Record<string, unknown> = {}) {
    return { kader, kaders: kaderView().kaders, ...extra };
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockImplementation(async (id = "") => kaderView(id === "k1" ? {} : { kader: null }));
});

async function show(route: string, user = adminUser()) {
    const view = renderPage(<KaderPage />, { route, path: PATH, user });
    await screen.findByRole("button", { name: /Forever-Kader/ });
    return view;
}

describe("KaderPage · Kader", () => {
    it("opens the Kader used last when the address names none", async () => {
        localStorage.setItem("eh-kader-last", JSON.stringify("k1"));
        renderPage(<KaderPage />, { route: "/kader", path: PATH });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        expect(api.getKader).toHaveBeenLastCalledWith("k1");
    });

    it("starts with the flow and creates the first Kader", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kaders: [], kader: null }));
        vi.mocked(api.createKader).mockResolvedValue({ ...change(), kaderId: "k1" });
        renderPage(<KaderPage />, { route: "/kader", path: PATH });
        expect(await screen.findByRole("heading", { name: t("kader.start.title") })).toBeInTheDocument();
        expect(screen.getByText(t("kader.start.rule.internal.t"))).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.start.create") }));
        const dialog = await screen.findByRole("dialog");
        const create = within(dialog).getByRole("button", { name: t("kader.settings.create") });
        expect(create).toBeDisabled();
        await userEvent.type(within(dialog).getByRole("textbox"), "Forever-Kader 2027");
        await userEvent.click(create);
        expect(api.createKader).toHaveBeenCalledWith("Forever-Kader 2027");
    });

    it("edits name and leads in the settings: one row per lead, a real add button", async () => {
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.header.settings") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("textbox", { name: t("kader.field.name") })).toHaveValue("Forever-Kader");
        // the only lead cannot be removed; adding waits for a member
        expect(within(dialog).getByRole("button", { name: t("kader.settings.removeLead", { name: "Admin" }) })).toBeDisabled();
        const add = within(dialog).getByRole("button", { name: t("common.add") });
        expect(add).toBeDisabled();
        await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: t("kader.settings.addLead") }), U.guest);
        expect(add).toBeEnabled();
        await userEvent.click(add);
        expect(within(dialog).getByText("Gast")).toBeInTheDocument();
    });

    it("counts the players per state in the status bar, every count with the words behind it", async () => {
        await show("/kader/k1/pool");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        expect(within(nav).getByText(t("kader.nav.kicker"))).toBeInTheDocument();
        expect(within(nav).getByRole("link", { name: t("kader.nav.count.pool", { count: 1 }) })).toHaveAttribute("aria-current", "page");
        expect(within(nav).getByRole("link", { name: t("kader.nav.count.selected", { count: 2 }) })).not.toHaveAttribute("aria-current");
        // bench and tentative are segments of their own, next to the roster
        for (const s of ["provisional", "roster", "bench", "tentative"]) {
            expect(within(nav).getByRole("link", { name: t(`kader.nav.count.${s}`, { count: 1 }) })).toHaveAttribute("href", "/kader/k1/roster");
        }
        // no step numbers: the only figures are the counts
        expect(within(nav).queryByText("4")).toBeNull();
    });

    it("marks every state the roster page shows", async () => {
        await show("/kader/k1/roster");
        const nav = screen.getByRole("navigation", { name: t("kader.nav.aria") });
        const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
        expect(current.map((a) => a.getAttribute("aria-label"))).toEqual(["provisional", "roster", "bench", "tentative"].map((s) => t(`kader.nav.count.${s}`, { count: 1 })));
    });
});

describe("KaderPage · Pool", () => {
    it("lists everybody with the prefilled character and its source, and moves one by the switch", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show("/kader/k1/pool");
        // a spec is its icon plus the class; the full name sits in the tooltip and on the icon
        expect(screen.getByText("Magier")).toHaveAttribute("data-tip", "Magier · Frost");
        expect(screen.getAllByRole("img", { name: "Frost · Magier" }).length).toBeGreaterThan(0);
        // the scope says what it counts
        expect(screen.getByRole("radio", { name: t("kader.pool.scopeSelected", { n: 2 }) })).toHaveAttribute("data-tip", t("kader.nav.count.selected", { count: 2 }));
        expect(screen.getByText(t("kader.pool.ofTotal", { count: 7 }))).toBeInTheDocument();
        expect(screen.getAllByText(t("kader.source.profile")).length).toBeGreaterThan(0);
        expect(screen.getByText(t("kader.source.logs"))).toBeInTheDocument();
        // Neuling has no character data
        expect(screen.getAllByText(t("kader.pool.noData")).length).toBeGreaterThan(0);
        // the attendance of the main version carries its label
        expect(screen.getByText("80 %")).toHaveAttribute("data-tip", t("kader.pool.attendanceOf", { version: "TBC" }));
        await userEvent.click(screen.getByRole("switch", { name: t("kader.pool.toSelection", { name: "Neuling" }) }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.hand], "selected");
        // somebody further along shows their state instead of the switch
        expect(screen.getAllByText(t("kader.state.roster")).length).toBeGreaterThan(0);
    });

    it("takes the members of a Discord role into the pool", async () => {
        vi.mocked(api.addKaderPlayers).mockResolvedValue({ ...kaderView(), added: 1, already: 0 });
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.import.pickRoles"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: /Raider/ }));
        // Gast is new (profile), Aldric is already in this Kader
        expect(within(dialog).getByText("Gast")).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.import.from.profile"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("radio", { name: t("kader.import.listKnown", { n: 1 }) }));
        expect(within(dialog).getByText(t("kader.import.inKader"))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("kader.import.submit", { n: 1 }) }));
        expect(api.addKaderPlayers).toHaveBeenCalledWith("k1", [{ userId: U.guest, displayName: "Gast" }]);
    });

    it("says so when the member list is not there", async () => {
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ members: [], discordRoles: [] }));
        await show("/kader/k1/pool");
        await userEvent.click(screen.getByRole("button", { name: t("kader.pool.import") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.import.noRoles"))).toBeInTheDocument();
        expect(within(dialog).getByText(t("kader.import.offline"))).toBeInTheDocument();
    });
});

describe("KaderPage · Vorauswahl", () => {
    it("lists the interviews, started first, and saves a change by itself", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        await show("/kader/k1/vorauswahl");
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const rows = within(list).getAllByRole("button");
        expect(rows[0]).toHaveTextContent("Liss");
        expect(within(list).queryByText("Brakk")).toBeNull();
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        // one of two: the wish is there, the raid days are not
        expect(within(panel).getByText(t("kader.interview.progress", { done: 1, total: 2 }))).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: t("kader.interview.complete") })).toBeDisabled();
        await userEvent.click(within(panel).getByRole("button", { name: "Mittwoch" }));
        expect(within(panel).getByRole("button", { name: t("kader.interview.complete") })).toBeEnabled();
        await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { answers: { q1: ["d3"] } }), { timeout: 2500 });
    });

    it("completes an interview and goes on", async () => {
        const done = kaderData();
        done.players[U.mage].interview.completedAt = "2026-10-04T18:00:00.000Z";
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        vi.mocked(api.completeKaderInterview).mockResolvedValue(change(done));
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        await userEvent.click(within(panel).getByRole("button", { name: "Donnerstag" }));
        await userEvent.click(within(panel).getByRole("button", { name: t("kader.interview.complete") }));
        expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { answers: { q1: ["d4"] } });
        expect(api.completeKaderInterview).toHaveBeenCalledWith("k1", U.mage);
    });

    it("locks a held interview until it is opened again", async () => {
        await show(`/kader/k1/vorauswahl?spieler=${U.done}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Brakk" }) });
        expect(within(panel).getByRole("button", { name: t("kader.interview.reopen") })).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: "Mittwoch" })).toBeDisabled();
        // a held interview carries its check beside the name
        expect(within(panel).getByRole("img", { name: t("kader.interview.statusDoneTip") })).toBeInTheDocument();
    });

    it("marks the status with icons: the list filters, the questions and the progress", async () => {
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const open = within(list).getByRole("radio", { name: t("kader.interview.listOpen", { n: 1 }) });
        expect(open.querySelector("svg")).not.toBeNull();
        expect(open).toHaveAttribute("data-tip", t("kader.interview.listOpenTip", { count: 1 }));
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        // the voice question is answered, the raid days (required) are still open
        expect(within(panel).getAllByRole("img", { name: t("kader.interview.answered") })).toHaveLength(1);
        expect(within(panel).getAllByRole("img", { name: t("kader.interview.stillOpen") })).toHaveLength(1);
    });

    it("adds a wish by class and one of its spec icons", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue(change());
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        await userEvent.selectOptions(within(panel).getByRole("combobox", { name: t("kader.field.class") }), "Mage");
        const specs = within(panel).getByRole("radiogroup", { name: t("kader.field.spec") });
        // Frost is wished already, Fire can be added
        expect(within(specs).getByRole("radio", { name: "Frost · Magier" })).toBeDisabled();
        await userEvent.click(within(specs).getByRole("radio", { name: "Feuer · Magier" }));
        await userEvent.click(within(panel).getByRole("button", { name: t("kader.interview.addWish") }));
        await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { wishes: [{ className: "Mage", spec: "Mage-Frost" }, { className: "Mage", spec: "Mage-Fire" }] }), { timeout: 2500 });
    });

    it("compares everybody in the overview, filters by an answer and moves the marked on", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show("/kader/k1/uebersicht");
        expect(screen.getByText("Liss")).toBeInTheDocument();
        expect(screen.getByText("Brakk")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Im Voice-Chat aktiv\?/ }));
        await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /Meistens/ }));
        expect(screen.queryByText("Liss")).toBeNull();
        expect(screen.getByText("Brakk")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("checkbox", { name: t("kader.batch.mark", { name: "Brakk" }) }));
        await userEvent.click(screen.getByRole("button", { name: t("kader.overview.toProvisional") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.done], "provisional");
    });
});

describe("KaderPage · Vorläufig und Roster", () => {
    it("shows the columns and the drawer: votes, comments and the decision", async () => {
        vi.mocked(api.setKaderVote).mockResolvedValue(change());
        vi.mocked(api.addKaderComment).mockResolvedValue(change());
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.heal}`);
        for (const s of ["provisional", "roster", "bench", "tentative"]) expect(screen.getByRole("region", { name: t(`kader.state.${s}`) })).toBeInTheDocument();
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Mira" }) });
        expect(within(drawer).getByText(`Admin · ${t("kader.vote.yes")}`)).toBeInTheDocument();
        expect(within(drawer).getByText("Zuverlässig.")).toBeInTheDocument();
        await userEvent.click(within(drawer).getByRole("radio", { name: t("kader.vote.noAction") }));
        expect(api.setKaderVote).toHaveBeenCalledWith("k1", U.heal, "no");
        await userEvent.type(within(drawer).getByRole("textbox", { name: t("kader.decide.comment") }), "Passt gut.");
        await userEvent.click(within(drawer).getByRole("button", { name: t("kader.decide.send") }));
        expect(api.addKaderComment).toHaveBeenCalledWith("k1", U.heal, "Passt gut.");
        await userEvent.click(within(drawer).getByRole("button", { name: new RegExp(`^${t("kader.decide.decisionAria")}`) }));
        const menu = await screen.findByRole("menu", { name: t("kader.decide.decisionAria") });
        const items = within(menu).getAllByRole("menuitemradio");
        expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([
            `${t("kader.picker.rank", { n: 1 })}: Schamane · Wiederherstellung`,
            `${t("kader.picker.rank", { n: 2 })}: Schamane · Verstärkung`,
        ]);
        expect(items[0]).toHaveAttribute("aria-checked", "true");
        await userEvent.click(items[1]);
        await userEvent.click(within(drawer).getByRole("button", { name: t("kader.decide.toRoster") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.heal], "roster", { className: "Shaman", spec: "Shaman-Enhancement" });
    });

    it("lays the sections out as one grid with the same card everywhere", async () => {
        await show("/kader/k1/roster");
        const sections = SECTION_ORDER.map((s) => screen.getByRole("region", { name: t(`kader.state.${s}`) }));
        // one card per player, the same component in every section
        expect(sections.map((sec) => sec.querySelectorAll(".kp-card:not(.kp-card-empty)").length)).toEqual([1, 1, 1, 1]);
        // the cards carry votes and comments with the words behind the numbers
        const provisional = sections[3];
        expect(within(provisional).getByText(t("kader.decide.yesVotes", { count: 1 }))).toBeInTheDocument();
        expect(within(provisional).getByText(t("kader.decide.commentCount", { count: 1 }))).toBeInTheDocument();
    });

    it("changes a roster decision only when it differs, and shows the current state as the pressed button", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.sham}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Tomas" }) });
        // Tomas is on the bench: bench is the pressed, disabled one; tentative and "Ins Roster" can be used
        expect(within(drawer).getByRole("button", { name: t("kader.state.bench") })).toBeDisabled();
        expect(within(drawer).getByRole("button", { name: t("kader.state.bench") })).toHaveAttribute("aria-pressed", "true");
        expect(within(drawer).getByRole("button", { name: t("kader.state.tentative") })).toBeEnabled();
        expect(within(drawer).getByRole("button", { name: t("kader.decide.toRoster") })).toBeEnabled();
    });

    it("keeps the decision change off until another spec is picked", async () => {
        const k = kaderData();
        k.players[U.tank].wishes = [{ className: "Warrior", spec: "Warrior-Protection" }, { className: "Warrior", spec: "Warrior-Fury" }];
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        vi.mocked(api.setKaderState).mockResolvedValue(change(k));
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        const drawer = screen.getByRole("complementary", { name: t("kader.decide.drawer", { name: "Aldric" }) });
        const changeButton = within(drawer).getByRole("button", { name: t("kader.decide.changeDecision") });
        expect(changeButton).toBeDisabled();
        await userEvent.click(within(drawer).getByRole("button", { name: new RegExp(`^${t("kader.decide.decisionAria")}`) }));
        await userEvent.click(await screen.findByRole("menuitemradio", { name: `${t("kader.picker.rank", { n: 2 })}: Krieger · Furor` }));
        expect(changeButton).toBeEnabled();
        await userEvent.click(changeButton);
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "roster", { className: "Warrior", spec: "Warrior-Fury" });
    });

    it("moves a card back a step from the drawer", async () => {
        vi.mocked(api.setKaderState).mockResolvedValue(change());
        await show(`/kader/k1/roster?spieler=${U.tank}`);
        await userEvent.click(screen.getByRole("button", { name: t("kader.decide.back.provisional") }));
        expect(api.setKaderState).toHaveBeenCalledWith("k1", [U.tank], "provisional", undefined);
    });
});

describe("KaderPage · Fragen", () => {
    it("adds a question with its options", async () => {
        vi.mocked(api.addKaderQuestion).mockResolvedValue({ ...change(), questionId: "q9" });
        await show("/kader/k1/fragen");
        expect(screen.getByText(t("kader.questions.own", { n: 3 }))).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: t("kader.questions.add") }));
        const editor = screen.getByRole("region", { name: t("kader.questions.editor") });
        await userEvent.type(within(editor).getByPlaceholderText(t("kader.questions.textPlaceholder")), "Erfahrung");
        await userEvent.type(within(editor).getByRole("textbox", { name: t("kader.questions.optionN", { n: 1 }) }), "Neu");
        await userEvent.type(within(editor).getByRole("textbox", { name: t("kader.questions.optionN", { n: 2 }) }), "Viel");
        await userEvent.click(within(editor).getByRole("button", { name: t("kader.questions.create") }));
        expect(api.addKaderQuestion).toHaveBeenCalledWith("k1", { text: "Erfahrung", type: "single", required: false, options: [{ label: "Neu" }, { label: "Viel" }] });
    });

    it("says how many answers go with a deleted question", async () => {
        vi.mocked(api.deleteKaderQuestion).mockResolvedValue(change());
        await show("/kader/k1/fragen?frage=q2");
        await userEvent.click(screen.getByRole("button", { name: t("kader.questions.delete") }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("kader.questions.deleteText", { n: 2 }))).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: t("common.delete") }));
        expect(api.deleteKaderQuestion).toHaveBeenCalledWith("k1", "q2");
    });
});

describe("KaderPage · Beispiel-Setups", () => {
    it("switches the size and places a picked player on a free slot", async () => {
        vi.mocked(api.saveKaderVariant).mockResolvedValue(change());
        await show("/kader/k1/setups");
        expect(screen.getAllByRole("heading", { name: /^Gruppe \d$/ })).toHaveLength(4);
        await userEvent.click(screen.getByRole("button", { name: t("kader.setups.sizeN", { n: 10 }) }));
        expect(api.saveKaderVariant).toHaveBeenCalledWith("k1", "v1", { size: 10 });
        // Mira (Vorläufig) has no group yet: pick her, then the second slot of group 1
        await userEvent.click(screen.getByRole("button", { name: /Mira/ }));
        await userEvent.click(screen.getByRole("button", { name: t("kader.setups.freeSlot", { group: 1, n: 2 }) }));
        const groups = vi.mocked(api.saveKaderVariant).mock.calls.at(-1)?.[2].groups;
        expect(groups?.[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Restoration" });
    });
});

describe("KaderPage · spec picker in the setups", () => {
    it("picks a slot's spec from the player's wishes, with rank, icon and class", async () => {
        const k = kaderData();
        k.setups[0].groups[0][1] = { userId: U.heal, spec: "Shaman-Restoration" };
        vi.mocked(api.getKader).mockResolvedValue(kaderView({ kader: k }));
        vi.mocked(api.saveKaderVariant).mockResolvedValue(change(k));
        await show("/kader/k1/setups");
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t("kader.setups.specOf", { name: "Mira" })}`) }));
        const menu = await screen.findByRole("menu", { name: t("kader.setups.specOf", { name: "Mira" }) });
        const [first, second] = within(menu).getAllByRole("menuitemradio");
        expect(first).toHaveAttribute("aria-checked", "true");
        expect(within(second).getByText("Schamane")).toHaveAttribute("data-tip", "Schamane · Verstärkung");
        await userEvent.click(second);
        const groups = vi.mocked(api.saveKaderVariant).mock.calls.at(-1)?.[2].groups;
        expect(groups?.[0][1]).toEqual({ userId: U.heal, spec: "Shaman-Enhancement" });
    });
});

describe("KaderPage · read-only and English", () => {
    it("lets a read-only grant look at everything but change nothing", async () => {
        await show("/kader/k1/pool", reader);
        expect(screen.queryByRole("button", { name: t("kader.pool.import") })).toBeNull();
        expect(screen.getByRole("switch", { name: t("kader.pool.toSelection", { name: "Neuling" }) })).toBeDisabled();
        expect(screen.queryByRole("button", { name: t("kader.header.settings") })).toBeNull();
    });

    it("keeps a read-only interview and drawer free of controls", async () => {
        const view = renderPage(<KaderPage />, { route: `/kader/k1/vorauswahl?spieler=${U.mage}`, path: PATH, user: reader });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        expect(screen.queryByRole("button", { name: t("kader.interview.complete") })).toBeNull();
        expect(screen.getByRole("button", { name: "Mittwoch" })).toBeDisabled();
        view.unmount();
        renderPage(<KaderPage />, { route: `/kader/k1/roster?spieler=${U.heal}`, path: PATH, user: reader });
        await screen.findByRole("button", { name: /Forever-Kader/ });
        expect(screen.queryByRole("radio", { name: t("kader.vote.yesAction") })).toBeNull();
        expect(screen.queryByRole("textbox", { name: t("kader.decide.comment") })).toBeNull();
    });

    it("speaks English", async () => {
        await switchLang("en");
        try {
            await show("/kader/k1/vorauswahl");
            expect(screen.getByRole("link", { name: "Interviews" })).toBeInTheDocument();
            expect(screen.getByRole("heading", { name: "Preselection" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "Done 1" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Complete interview" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});
