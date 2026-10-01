// Who conducts an interview, made visible: the coloured badge everywhere, the
// "Gespräch führt" pick of the Gespräche list, the Übersicht's Interviewer
// filter and grouping — and that the picks are remembered.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import { entry, kader as kaderData, kaderView, ME, U } from "./kader.fixture";
import KaderPage from "./KaderPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKader: vi.fn(),
    getKaderLive: vi.fn(),
    leaveKaderLive: vi.fn(),
    saveKaderInterview: vi.fn(),
}));

const PATH = "/kader/:kaderId?/:sub?";
const LEADS = [ME, U.lead2, U.guest];
const iv = (lead: string, over: Partial<ReturnType<typeof entry>["interview"]> = {}) => ({ ...entry().interview, lead, ...over });

/** Five players in the Vorauswahl: two with Admin (one done), one each with Ohne and Gast, one with nobody. */
function viewWithLeads() {
    const k = kaderData({ leads: LEADS });
    k.players[U.hand] = entry({ name: "Neuling", state: "selected", interview: iv(U.lead2) });
    k.players[U.tent] = entry({ name: "Kael", state: "selected", interview: iv("") });
    k.players[U.sham] = entry({ name: "Tomas", state: "selected", interview: iv(U.guest, { startedAt: "2026-10-01T18:00:00.000Z" }) });
    return kaderView({ kader: k });
}

async function show(route: string) {
    renderPage(<KaderPage />, { route, path: PATH, user: adminUser() });
    await screen.findByRole("button", { name: /Forever-Kader/ });
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getKader).mockImplementation(async () => viewWithLeads());
});

const tip = (name: string) => t("kader.lead.tip", { name });

describe("Gespräche list", () => {
    it("shows the interviewer on every row as a badge: initial plus name, a warning badge for nobody", async () => {
        await show("/kader/k1/vorauswahl");
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const rows = Array.from(list.querySelectorAll<HTMLElement>(".kp-ivrow"));
        // open interviews: Liss (Admin), Neuling (Ohne), Kael (nobody), Tomas (Gast); Brakk is done
        expect(rows).toHaveLength(4);
        const liss = rows.find((r) => r.textContent?.includes("Liss")) as HTMLElement;
        const badge = within(liss).getByRole("img", { name: tip("Admin") });
        expect(badge).toHaveTextContent("Admin");
        expect(badge.querySelector(".kp-avatar")).toHaveTextContent("A");
        const kael = rows.find((r) => r.textContent?.includes("Kael")) as HTMLElement;
        const none = within(kael).getByRole("img", { name: t("kader.lead.nobodyTip") });
        expect(none).toHaveClass("kp-lead-none");
        expect(none).toHaveTextContent(t("kader.lead.nobody"));
        // three different people, three different colours
        const hues = ["Liss", "Neuling", "Tomas"].map((n) => {
            const row = rows.find((r) => r.textContent?.includes(n)) as HTMLElement;
            return row.querySelector(".kp-lead .kp-avatar")?.getAttribute("data-lead-hue");
        });
        expect(new Set(hues).size).toBe(3);
    });

    it("gives a lead the same colour in the Kader header and in the list", async () => {
        await show("/kader/k1/vorauswahl");
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const inList = list.querySelector(`.kp-lead[aria-label="${tip("Admin")}"] .kp-avatar`) as HTMLElement;
        const inHeader = document.querySelector(".kp-leads .kp-avatar[aria-label=Admin]") as HTMLElement;
        const hue = (el: HTMLElement) => Array.from(el.classList).find((c) => c.startsWith("kp-hue-"));
        expect(hue(inList)).toBeDefined();
        expect(hue(inList)).toBe(hue(inHeader));
    });

    it("filters by who conducts, with counts, combined with Offen / Geführt / Alle", async () => {
        await show("/kader/k1/vorauswahl");
        const list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        const rowsOf = () => Array.from(list.querySelectorAll<HTMLElement>(".kp-ivrow")).map((r) => r.textContent || "");
        await userEvent.click(within(list).getByRole("button", { name: `${t("kader.interview.lead")}: ${t("kader.lead.all")}` }));
        const menu = screen.getByRole("menu", { name: t("kader.interview.lead") });
        // counted over the open interviews: 4 all, 1 me, 1 Ohne, 1 Gast, 1 nobody
        const label = (text: string) => within(menu).getAllByRole("menuitemradio").find((o) => o.textContent?.includes(text)) as HTMLElement;
        expect(label(t("kader.lead.all"))).toHaveTextContent("4");
        expect(label("Ohne")).toHaveTextContent("1");
        await userEvent.click(label(t("kader.lead.me")));
        expect(rowsOf()).toHaveLength(1);
        expect(rowsOf()[0]).toContain("Liss");
        // the pick is remembered per Kader
        expect(JSON.parse(localStorage.getItem("eh-kader-interview-lead") || "{}")).toEqual({ k1: "me" });
        // with "Alle" shown Brakk (done, also Admin) joins
        await userEvent.click(within(list).getByRole("radio", { name: t("kader.interview.listAll") }));
        expect(rowsOf()).toHaveLength(2);
        expect(rowsOf().join(" ")).toContain("Brakk");
        // Niemand
        await userEvent.click(list.querySelector(".kp-leadfilter button") as HTMLElement);
        await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: new RegExp(t("kader.lead.nobodyTip").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
        expect(rowsOf()).toHaveLength(1);
        expect(rowsOf()[0]).toContain("Kael");
    });

    it("starts with the remembered pick and falls back to everybody for somebody gone", async () => {
        localStorage.setItem("eh-kader-interview-lead", JSON.stringify({ k1: U.lead2 }));
        await show("/kader/k1/vorauswahl");
        let list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        expect(list.querySelectorAll(".kp-ivrow")).toHaveLength(1);
        expect(list.querySelector(".kp-ivrow")).toHaveTextContent("Neuling");
        document.body.innerHTML = "";
        localStorage.setItem("eh-kader-interview-lead", JSON.stringify({ k1: "424242" }));
        await show("/kader/k1/vorauswahl");
        list = screen.getByRole("region", { name: t("kader.interview.listTitle") });
        expect(list.querySelectorAll(".kp-ivrow")).toHaveLength(4);
    });
});

describe("the interview's Gespräch führt pick", () => {
    it("shows the current lead as a badge and saves another one from the coloured menu", async () => {
        vi.mocked(api.saveKaderInterview).mockResolvedValue({ kader: viewWithLeads().kader as never, kaders: [] });
        await show(`/kader/k1/vorauswahl?spieler=${U.mage}`);
        const panel = screen.getByRole("region", { name: t("kader.interview.aria", { name: "Liss" }) });
        const button = within(panel).getByRole("button", { name: `${t("kader.interview.lead")}: Admin` });
        expect(button).toHaveTextContent(`Admin ${t("kader.lead.you")}`);
        await userEvent.click(button);
        const menu = screen.getByRole("menu", { name: t("kader.interview.lead") });
        expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4);
        await userEvent.click(within(menu).getByRole("menuitemradio", { name: new RegExp("Ohne") }));
        await waitFor(() => expect(api.saveKaderInterview).toHaveBeenCalledWith("k1", U.mage, { lead: U.lead2 }, { baseRev: 0 }), { timeout: 2500 });
    });
});

describe("Übersicht", () => {
    it("shows the badge under the status and filters by interviewer, with a removable chip", async () => {
        await show("/kader/k1/uebersicht");
        const table = screen.getByRole("table");
        const kael = within(table).getByText("Kael").closest("[role=row]") as HTMLElement;
        expect(within(kael).getByRole("img", { name: t("kader.lead.nobodyTip") })).toBeInTheDocument();
        const brakk = within(table).getByText("Brakk").closest("[role=row]") as HTMLElement;
        // a done interview adds its date to the badge's tooltip
        expect(within(brakk).getByRole("img", { name: new RegExp(tip("Admin")) })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /^Interviewer/, expanded: false }));
        const menu = screen.getByRole("menu", { name: "Interviewer" });
        expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(4);
        // Admin has two players, the dots carry the initial
        const admin = within(menu).getByRole("menuitemcheckbox", { name: /Admin/ });
        expect(admin).toHaveTextContent("2");
        expect(admin.querySelector(".kp-avatar")).toHaveTextContent("A");
        await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /Ohne/ }));
        expect(screen.queryByText("Liss")).toBeNull();
        expect(screen.getByText("Neuling")).toBeInTheDocument();
        await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: new RegExp(t("kader.lead.nobodyLong")) }));
        expect(screen.getByText("Kael")).toBeInTheDocument();
        // chips: remove one
        await userEvent.click(screen.getByRole("button", { name: t("kader.filter.remove", { label: "Interviewer: Ohne" }) }));
        expect(screen.queryByText("Neuling")).toBeNull();
        expect(screen.getByText("Kael")).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem("eh-kader-overview-filters") || "{}")).toEqual({ lead: ["-"] });
    });

    it("groups by interviewer: one group per lead, then nobody, and remembers it", async () => {
        await show("/kader/k1/uebersicht");
        await userEvent.click(screen.getByRole("radio", { name: t("kader.overview.byInterviewer") }));
        const table = screen.getByRole("table");
        const titles = Array.from(table.querySelectorAll(".kp-gtitle")).map((el) => el.textContent);
        expect(titles).toEqual(["Admin", "Ohne", "Gast", t("kader.lead.nobodyLong")]);
        const admin = table.querySelectorAll(".kp-ogroup")[0] as HTMLElement;
        expect(within(admin).getByText("Liss")).toBeInTheDocument();
        expect(within(admin).getByText("Brakk")).toBeInTheDocument();
        expect(admin.querySelector(".kp-ghead .kp-avatar")).toHaveTextContent("A");
        expect(JSON.parse(localStorage.getItem("eh-kader-overview-group") || "null")).toBe("lead");
    });

    it("speaks English", async () => {
        localStorage.setItem("eh-lang", JSON.stringify("en"));
        const { switchLang } = await import("../../test/i18n");
        await switchLang("en");
        await show("/kader/k1/uebersicht");
        expect(screen.getAllByRole("img", { name: /Interview by: Admin/ }).length).toBeGreaterThan(0);
        await switchLang("de");
    });
});
