// The Komposition tab (#657): role cards with squares against the plan, the
// bench as outlined squares, the classes, the buffs (da / knapp / fehlt), the
// open places as one sentence, the ways to Rekrutierung and Kaderplaner only
// for whoever may open them, and English.
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import CompositionTab from "./CompositionTab";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { composition, detail, member } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterComposition: vi.fn(),
}));

const MEMBERS = [
    member("Thorgrim", { userId: "u-t", role: "tank" }),
    member("Lunaria", { userId: "u-l", role: "healer" }),
    member("Varok", { userId: "u-v", status: "bench", role: "dps" }),
];
const BUFFS = [
    { key: "bloodlust", label: "Kampfrausch", labelEn: "Bloodlust", icon: "spell_nature_bloodlust", scope: "raid", providers: ["u-t", "u-l"], covered: true },
    { key: "motw", label: "Mal der Wildnis", labelEn: "Mark of the Wild", icon: "spell_nature_regeneration", scope: "raid", providers: ["u-l"], covered: true },
    { key: "coe", label: "Fluch der Elemente", labelEn: "Curse of the Elements", icon: "spell_shadow_chilltouch", scope: "raid", providers: [], covered: false },
];

async function open(user = adminUser(), comp = composition({ buffs: BUFFS })) {
    vi.mocked(api.getRosterComposition).mockResolvedValue(comp);
    renderPage(<CompositionTab data={detail(MEMBERS)} user={user} reloadKey={0} />);
    await waitFor(() => expect(document.querySelector(".rn-comp-page")).not.toBeNull());
}

beforeEach(() => vi.mocked(api.getRosterComposition).mockReset());
afterEach(() => switchLang("de"));

describe("CompositionTab", () => {
    it("draws a card per role with a square per place, and the bench outlined", async () => {
        await open();
        const healers = screen.getByRole("region", { name: "Heiler" });
        expect(within(healers).getByText("von 7 geplant")).toBeInTheDocument();
        expect(within(healers).getByRole("img", { name: "6 von 7 Plätzen belegt" }).querySelectorAll("i.on")).toHaveLength(6);
        expect(within(healers).getByText(/Es fehlt 1 Heiler/)).toBeInTheDocument();
        expect(within(healers).getByText(/Lunaria/)).toBeInTheDocument();
        const bench = screen.getByRole("region", { name: "Ersatz" });
        expect(bench.querySelectorAll(".rn-slots i.bench")).toHaveLength(2);
        expect(within(bench).getByText("Bereit: Varok")).toBeInTheDocument();
        expect(screen.getByText("1 Heiler fehlt · 3 DPS fehlen · 4 Plätze frei")).toBeInTheDocument();
    });

    it("lists the classes and rates the buffs", async () => {
        await open();
        expect(screen.getByText("Krieger").closest(".rn-cls")).toHaveTextContent("4");
        const buff = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
        expect(within(buff("Kampfrausch")).getByText("da")).toBeInTheDocument();
        expect(within(buff("Kampfrausch")).getByText("2 Personen: Thorgrim, Lunaria")).toBeInTheDocument();
        expect(within(buff("Mal der Wildnis")).getByText("knapp")).toBeInTheDocument();
        expect(within(buff("Fluch der Elemente")).getByText("fehlt")).toBeInTheDocument();
        expect(within(buff("Fluch der Elemente")).getByText("niemand im Roster")).toBeInTheDocument();
    });

    it("shows the ways to Rekrutierung and Kaderplaner only with their areas", async () => {
        await open();
        expect(screen.getByRole("link", { name: "Zur Rekrutierung" })).toHaveAttribute("href", "/recruitment");
        expect(screen.getByRole("link", { name: "Zum Kaderplaner" })).toHaveAttribute("href", "/kader");
    });

    it("leaves them out for a roster reader without those areas", async () => {
        await open(adminUser({ isAdmin: false, access: { roster: { read: true, write: false } } }));
        expect(screen.queryByRole("link", { name: "Zur Rekrutierung" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Zum Kaderplaner" })).not.toBeInTheDocument();
    });

    it("says when every planned place is filled", async () => {
        await open(adminUser(), composition({ roles: [{ role: "tank", target: 2, actual: 2 }, { role: "healer", target: 0, actual: 3 }, { role: "dps", target: 5, actual: 5 }], open: 0 }));
        expect(screen.getByText("Alle geplanten Plätze sind besetzt.")).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Heiler" })).toHaveTextContent("kein Ziel");
    });

    it("speaks English", async () => {
        await switchLang("en");
        await open();
        expect(screen.getByText("Classes in the roster")).toBeInTheDocument();
        expect(screen.getByText("Warrior")).toBeInTheDocument();
        expect(screen.getByText("Mark of the Wild")).toBeInTheDocument();
        expect(screen.getByText("thin")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "To recruitment" })).toBeInTheDocument();
    });
});
