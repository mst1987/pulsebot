// "Mein Profil" (#255) as the raider sees it: the page renders against a
// mocked profile API and every check is about what is on screen and which
// request a click sends. The stylesheet and routing promises that cannot be
// rendered stay in test/web-client/conventions/profilePage.test.js.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type {
    CalendarTokens, GameClass, GameSpec, ProfileCharacter, ProfileData, ProfilePatch, ProfileRaiding, RaiderAttendanceData, RaiderProfile, RaiderRef,
} from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { renderPage, twoVersions } from "../../test/render";
import ProfilePage from "./ProfilePage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    removeProfileCharacter: vi.fn(),
    searchRaiders: vi.fn(),
    getCalendarTokens: vi.fn(),
    createCalendarToken: vi.fn(),
    revokeCalendarToken: vi.fn(),
    getLogCharacters: vi.fn(),
    addProfileCharacter: vi.fn(),
    getRaiderAttendance: vi.fn(),
    getProfileRaiding: vi.fn(),
}));

// ---- fixtures ----

function spec(classId: string, id: string, label: string, role: GameSpec["role"], canTank = false, canHeal = false): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank, canHeal };
}

const DRUID: GameClass = {
    id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid",
    specs: [spec("Druid", "Guardian", "Wächter", "tank", true), spec("Druid", "Restoration", "Wiederherstellung", "healer", false, true)],
};
const MAGE: GameClass = {
    id: "Mage", label: "Magier", color: "#69ccf0", icon: "classicon_mage",
    specs: [spec("Mage", "Frost", "Frost", "ranged")],
};

function character(over: Partial<ProfileCharacter>): ProfileCharacter {
    return {
        key: "borka", name: "Borka", versionId: "tbc", realm: "Thunderstrike", className: "Druid", source: "manual",
        armory: null, armoryUrl: "", specs: [], canOfftank: false, canHeal: false,
        suggested: { canOfftank: true, canHeal: true }, possible: { canOfftank: true, canHeal: true }, claimedBy: [],
        ...over,
    };
}

const BORKA = character({
    specs: [{
        key: "Druid-Guardian", gear: "usable", label: "Wächter", specId: "Guardian", role: "tank", icon: "icon_Guardian",
        canTank: true, canHeal: false, logs: { status: "seen", reports: 2 },
    }],
});
const FROSTI = character({
    key: "frosti", name: "Frosti", className: "Mage", canHeal: true,
    suggested: { canOfftank: false, canHeal: false }, possible: { canOfftank: false, canHeal: false },
});

const ANNA: RaiderRef = { userId: "u2", name: "anna", character: "Annabelle", className: "Mage" };
const BERT: RaiderRef = { userId: "u3", name: "bert", character: "Bertram", className: "Druid" };
const CARL: RaiderRef = { userId: "u4", name: "carl", character: "Carlos", className: "Mage" };
const DORA: RaiderRef = { userId: "u5", name: "dora", character: "Doris", className: "Druid" };
const RAIDERS = [ANNA, BERT, CARL, DORA];

function profile(over: Partial<RaiderProfile> = {}): RaiderProfile {
    return {
        userId: "u1", name: "Admin", characters: [BORKA, FROSTI], canOfftank: false, canHeal: false,
        suggested: { canOfftank: true, canHeal: true }, availability: ["mi"], preferredRaids: [], wishes: [],
        avoidEnabled: false, avoid: [], note: "", updatedAt: 0,
        ...over,
    };
}

function profileData(p: RaiderProfile = profile()): ProfileData {
    return {
        profile: p,
        isNew: false,
        classes: [DRUID, MAGE],
        roles: { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" },
        raidGroups: [{ id: "tbc", label: "TBC", instances: [{ id: "kara", name: "Karazhan", short: "Kara", icon: "icon_kara", status: "complete" }] }],
        weekdays: ["mo", "di", "mi", "do", "fr", "sa", "so"].map((id) => ({ id, label: id })),
        gearLevels: [{ id: "none", label: "keins" }, { id: "usable", label: "brauchbar" }, { id: "ready", label: "raidbereit" }],
        limits: { characters: 5, wishes: 3, avoid: 3, note: 200 },
    };
}

const NO_TOKENS: CalendarTokens = { tokens: [], max: 3, configured: true };
const NO_ATTENDANCE: RaiderAttendanceData = { userId: "u1", name: "Admin", own: true, orga: false, categories: [] };
const NO_RAIDING: ProfileRaiding = { versionId: "tbc", rosters: [], characters: {} };

/** What the server answers to a PUT: the patch applied (characters by key). */
function applyPatch(p: RaiderProfile, patch: ProfilePatch): RaiderProfile {
    const { characters, wishes, avoid, order, ...rest } = patch;
    const ordered = order ? [...p.characters].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : p.characters;
    return {
        ...p,
        ...rest,
        characters: ordered.map((c) => {
            const change = characters?.find((x) => x.key === c.key);
            if (!change) return c;
            const { specs, ...fields } = change;
            return {
                ...c,
                ...fields,
                specs: specs ? c.specs.map((s) => ({ ...s, gear: specs.find((x) => x.key === s.key)?.gear || s.gear })) : c.specs,
            };
        }),
        wishes: wishes ? RAIDERS.filter((w) => wishes.includes(w.userId)) : p.wishes,
        avoid: avoid ? RAIDERS.filter((w) => avoid.includes(w.userId)) : p.avoid,
    };
}

function setup(p: RaiderProfile = profile(), calendar: CalendarTokens = NO_TOKENS) {
    let current = p;
    vi.mocked(api.getProfile).mockResolvedValue(profileData(p));
    vi.mocked(api.getCalendarTokens).mockResolvedValue(calendar);
    vi.mocked(api.saveProfile).mockImplementation(async (patch) => {
        current = applyPatch(current, patch);
        return { profile: current };
    });
    vi.mocked(api.searchRaiders).mockResolvedValue({ raiders: RAIDERS });
    vi.mocked(api.getLogCharacters).mockResolvedValue({ characters: [] });
    vi.mocked(api.getRaiderAttendance).mockResolvedValue(NO_ATTENDANCE);
    vi.mocked(api.getProfileRaiding).mockResolvedValue(NO_RAIDING);
    return { user: userEvent.setup() };
}

const tabRow = () => screen.getByRole("tablist", { name: t("profile.tabs.aria") });
/** The names of the character tabs, in order (Meine Infos and the orga's tab left out). */
const charTabs = () => within(tabRow()).getAllByRole("tab").map((x) => x.textContent || "")
    .filter((x) => x && x !== t("profile.tabs.info") && !x.startsWith(t("profile.tabs.all")));

async function renderProfile(route = "/profile") {
    renderPage(<ProfilePage />, { route });
    await screen.findByRole("tablist", { name: t("profile.tabs.aria") });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("Reiter statt Chips", () => {
    it("opens on „Meine Infos“, then one tab per character in the raider's order, [+], and the orga's list last", async () => {
        setup();
        await renderProfile();
        const tabs = within(tabRow()).getAllByRole("tab");
        expect(tabs[0]).toHaveTextContent(t("profile.tabs.info"));
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        expect(charTabs()).toEqual(["Borka", "Frosti"]);
        expect(tabs[tabs.length - 1]).toHaveAccessibleName(t("profile.tabs.all"));
        expect(within(tabRow()).getByRole("tab", { name: t("profile.addCharacter"), selected: false })).toBeInTheDocument();
        expect(tabs[tabs.length - 1]).toHaveAttribute("data-tip-sub", t("profile.tabs.allTip"));
        // Meine Infos: the person's parts, no character card
        expect(screen.getByText(t("profile.fold.attendance"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("profile.char.edit") })).not.toBeInTheDocument();
        // the old head action and the chips are gone
        expect(document.querySelector(".pf-chip")).toBeNull();
    });

    it("reaches a character's tab by link (?char=) and by click; the tab names its spec in the tooltip", async () => {
        const { user } = setup();
        await renderProfile("/profile?char=frosti");
        expect(screen.getByRole("tab", { name: /Frosti/, selected: true })).toBeInTheDocument();
        const borka = screen.getByRole("tab", { name: /Borka/ });
        // the spec's own word (lib/wow/wowNames), then the class
        expect(borka).toHaveAttribute("data-tip-sub", "Wilder Kampf (Bär) · Druide");
        expect(screen.getByRole("tab", { name: /Frosti/ })).toHaveAttribute("data-tip-sub", `${t("profile.tabs.noSpec")} · Magier`);
        await user.click(borka);
        expect(screen.getByRole("tab", { name: /Borka/, selected: true })).toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: t("profile.tabs.info") }));
        expect(screen.getByRole("tab", { name: t("profile.tabs.info"), selected: true })).toBeInTheDocument();
    });

    it("takes eight characters, and from six on offers „⋯“ with the full list", async () => {
        const many = Array.from({ length: 8 }, (_, i) => character({ key: `c${i}`, name: `Char${i}` }));
        const { user } = setup(profile({ characters: many }));
        await renderProfile();
        expect(charTabs()).toEqual(many.map((c) => c.name));
        await user.click(screen.getByRole("button", { name: t("profile.tabs.more") }));
        const menu = screen.getByRole("menu", { name: t("profile.tabs.more") });
        expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1 + 8 + 1);
        await user.click(within(menu).getByRole("menuitemradio", { name: /Char7/ }));
        expect(screen.getByRole("tab", { name: /Char7/, selected: true })).toBeInTheDocument();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("has no „⋯“ with few characters", async () => {
        setup();
        await renderProfile();
        expect(screen.queryByRole("button", { name: t("profile.tabs.more") })).not.toBeInTheDocument();
    });
});

describe("Reihenfolge statt Main", () => {
    afterEach(() => vi.clearAllMocks());

    it("hat kein „Main“ – der Raider schiebt Charaktere innerhalb ihrer Version nach vorn und hinten", async () => {
        const { user } = setup();
        await renderProfile("/profile?char=borka");
        expect(screen.queryByText("Main")).not.toBeInTheDocument();
        expect(charTabs()).toEqual(["Borka", "Frosti"]);
        // Borka (first) cannot move further forward
        expect(screen.getByRole("button", { name: t("profile.char.moveForward") })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: t("profile.char.moveBack") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ order: ["frosti", "borka"] }));
        expect(charTabs()).toEqual(["Frosti", "Borka"]);
        // the moved one stays shown
        expect(screen.getByRole("tab", { name: /Borka/, selected: true })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("profile.char.moveBack") })).toBeDisabled();
        expect(screen.getByRole("button", { name: t("profile.char.moveForward") })).toBeEnabled();
    });
});

describe("Charaktere je Spielversion (#543)", () => {
    const DEVI = character({ key: "forever~devi res", name: "Devi Res", versionId: "forever", className: "Mage" });
    const VERSIONS = [
        { id: "forever", label: "WoW Forever", short: "Forever", lastName: true },
        { id: "tbc", label: "TBC Anniversary", short: "TBC", lastName: false },
    ];
    const load = () => {
        setup(profile({ characters: [BORKA, FROSTI, DEVI] }));
        vi.mocked(api.getProfile).mockResolvedValue({
            ...profileData(profile({ characters: [BORKA, FROSTI, DEVI] })), mainVersion: "forever", versions: VERSIONS,
            classesByVersion: { tbc: [DRUID, MAGE], forever: [MAGE] },
        });
    };

    afterEach(() => vi.clearAllMocks());

    it("without a menu version lists every version's characters, the main version first, and the card names the version", async () => {
        load();
        await renderProfile("/profile?char=forever~devi res");
        expect(charTabs()).toEqual(["Devi Res", "Borka", "Frosti"]);
        expect(screen.getByText(/Forever · /)).toBeInTheDocument();
    });

    // One version per page (#741): Forever = Forever characters, TBC = TBC characters.
    describe("mit dem Content-Umschalter", () => {
        const content = (version: "forever" | "tbc") => twoVersions({ mainVersion: version, versions: version === "forever" ? [VERSIONS[0], VERSIONS[1]] : [VERSIONS[1], VERSIONS[0]] });

        it("zeigt unter Forever nur die Forever-Charaktere", async () => {
            load();
            renderPage(<ProfilePage />, { route: "/profile", content: content("forever") });
            expect(await screen.findByRole("tab", { name: /Devi Res/ })).toBeInTheDocument();
            expect(screen.queryByRole("tab", { name: /Borka/ })).not.toBeInTheDocument();
            expect(screen.queryByRole("tab", { name: /Frosti/ })).not.toBeInTheDocument();
        });

        it("zeigt unter TBC nur die TBC-Charaktere", async () => {
            load();
            renderPage(<ProfilePage />, { route: "/profile", content: content("tbc") });
            expect(await screen.findByRole("tab", { name: /Borka/ })).toBeInTheDocument();
            expect(screen.getByRole("tab", { name: /Frosti/ })).toBeInTheDocument();
            expect(screen.queryByRole("tab", { name: /Devi Res/ })).not.toBeInTheDocument();
        });

        it("folgt einem Link auf einen Charakter der anderen Version", async () => {
            load();
            renderPage(<ProfilePage />, { route: "/profile?char=forever~devi res", content: content("tbc") });
            expect(await screen.findByRole("tab", { name: /Devi Res/ })).toBeInTheDocument();
            await waitFor(() => expect(screen.queryByRole("tab", { name: /Borka/ })).not.toBeInTheDocument());
        });

        it("asks the attendance and the character data for the shown version, the latter only once a character tab opens", async () => {
            load();
            const user = userEvent.setup();
            renderPage(<ProfilePage />, { route: "/profile", content: content("forever") });
            await screen.findByRole("tab", { name: /Devi Res/ });
            await waitFor(() => expect(api.getRaiderAttendance).toHaveBeenCalledWith("", "forever"));
            expect(api.getProfileRaiding).not.toHaveBeenCalled();
            await user.click(screen.getByRole("tab", { name: /Devi Res/ }));
            await waitFor(() => expect(api.getProfileRaiding).toHaveBeenCalledWith("forever"));
        });
    });
});

/** Clicks the fold's chevron — its accessible name is the part's title. */
const openFold = async (user: ReturnType<typeof userEvent.setup>, key: string) => {
    await user.click(screen.getAllByRole("button", { name: t(`profile.fold.${key}`) }).find((b) => b.hasAttribute("aria-expanded"))!);
};
/**
 * The open dialog whose head says `title`. Modal's <dialog> has no accessible
 * name (no aria-labelledby on the title), so it is found through its title text.
 */
async function findDialog(title: string): Promise<HTMLDialogElement> {
    return waitFor(() => {
        const dlg = screen.getAllByText(title).map((el) => el.closest("dialog")).find((d) => d?.open);
        if (!dlg) throw new Error(`no open dialog "${title}"`);
        return dlg;
    });
}
const expandButtons = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded") && b.closest(".pf-fold"));

describe("ProfilePage – loading", () => {
    it("shows the raid loader with its own text while the profile loads, not a bare empty box", async () => {
        vi.mocked(api.getProfile).mockReturnValue(new Promise(() => undefined));
        vi.mocked(api.getCalendarTokens).mockResolvedValue(NO_TOKENS);
        renderPage(<ProfilePage />);
        expect(await screen.findByText(t("profile.loading"))).toBeInTheDocument();
    });
});

describe("Meine Infos – folded parts", () => {
    it("has the seven parts in their groups, only „Wann ich kann“ open at first, and opening one closes the other", async () => {
        const { user } = setup();
        await renderProfile();

        for (const g of ["groupRaiding", "groupLinks", "groupPrefs"]) expect(screen.getByText(t(`profile.info.${g}`))).toBeInTheDocument();
        const toggles = expandButtons();
        expect(toggles.map((b) => b.getAttribute("aria-label"))).toEqual(
            ["attendance", "calendar", "days", "raids", "wishes", "avoid", "note"].map((k) => t(`profile.fold.${k}`)),
        );
        expect(toggles.filter((b) => b.getAttribute("aria-expanded") === "true")).toEqual([toggles[2]]);
        expect(screen.getByRole("button", { name: t("profile.weekday.mo"), pressed: false })).toBeInTheDocument();
        // closed parts show their one-line summary
        expect(screen.getByText(t("profile.fold.raidsNone"))).toBeInTheDocument();

        await openFold(user, "raids");
        expect(expandButtons().filter((b) => b.getAttribute("aria-expanded") === "true").map((b) => b.getAttribute("aria-label")))
            .toEqual([t("profile.fold.raids")]);
        expect(screen.queryByRole("button", { name: t("profile.weekday.mo") })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Kara", pressed: false })).toBeInTheDocument();
        expect(screen.queryByText(t("profile.fold.raidsNone"))).not.toBeInTheDocument();

        // a second click folds everything
        await openFold(user, "raids");
        expect(expandButtons().every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    });

    it("marks every weekday with its day, in the buttons and in the folded summary, and saves a click", async () => {
        const { user } = setup();
        await renderProfile();

        const mo = screen.getByRole("button", { name: t("profile.weekday.mo") });
        expect(mo).toHaveAttribute("data-day", "mo");
        expect(screen.getByRole("button", { name: t("profile.weekday.mi") })).toHaveAttribute("aria-pressed", "true");

        await user.click(mo);
        expect(api.saveProfile).toHaveBeenCalledWith({ availability: ["mi", "mo"] });
        expect(mo).toHaveAttribute("aria-pressed", "true");

        await openFold(user, "days");
        const tags = ["mo", "mi"].map((d) => screen.getByText(t(`profile.weekday.${d}`)));
        expect(tags.map((tag) => tag.getAttribute("data-day"))).toEqual(["mo", "mi"]);
    });

    it("folds the attendance to one line with its quota, and opens to the counted nights", async () => {
        const { user } = setup();
        vi.mocked(api.getRaiderAttendance).mockResolvedValue({
            ...NO_ATTENDANCE,
            categories: [
                {
                    id: "c1", name: "SSC/TK", pct: 80, attended: 4, total: 5, link: "auto", window: 10, upcoming: [],
                    raids: [1, 2, 3, 4, 5].map((n) => ({ eventId: `e${n}`, title: `Raid ${n}`, startTime: 1790000000 + n * 86400, attended: n !== 3, reason: "" })),
                },
                { id: "c2", name: "Kara", pct: null, attended: 0, total: 0, link: "auto", window: 10, upcoming: [], raids: [] },
            ],
        });
        await renderProfile();
        expect(await screen.findByText(t("profile.attendance.sum", { pct: 80, attended: 4, count: 5, name: "SSC/TK" }))).toBeInTheDocument();
        await openFold(user, "attendance");
        expect(screen.getByText(t("absences.mine.pct", { pct: 80 }))).toBeInTheDocument();
        expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("pf-att-night"))).toHaveLength(5);
        // a category without counted raids says so calmly
        expect(screen.getByText(t("absences.mine.noRaids"))).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("profile.attendance.open") })).toHaveAttribute("href", "/absences");
    });

    it("says calmly that no raid is counted yet", async () => {
        setup();
        await renderProfile();
        expect(await screen.findByText(t("profile.attendance.none"))).toBeInTheDocument();
    });
});

describe("Charakter-Reiter – Roster, Loot, Bestzeiten", () => {
    const RAIDING: ProfileRaiding = {
        versionId: "tbc",
        rosters: [
            { id: "r1", name: "SSC Mittwoch", categoryId: "c1", status: "trial", since: "2026-09-12T00:00:00.000Z", trialUntil: "2026-10-30T00:00:00.000Z", chars: ["borka"], charNames: { borka: "Borka" }, spec: null },
        ],
        characters: {
            borka: {
                loot: {
                    count: 7, lastAt: Date.UTC(2026, 9, 8),
                    items: [{
                        itemId: 30236, itemName: "Helm of the Vanquished Hero", itemIconUrl: "https://example.org/helm.jpg", itemQuality: 4,
                        itemLink: "https://www.wowhead.com/tbc/item=30236", response: "BiS", offspec: false, reason: "bis", reasonLabel: "BiS", reasonTone: "bis",
                        contentId: "ssc", categoryId: "c1", eventId: "e1", eventLabel: "SSC Mittwoch", awardedAt: Date.UTC(2026, 9, 8), boss: "Lady Vashj",
                    }],
                },
                dungeons: {
                    points: 1240, pointsRank: 4, characters: 31, medals: { gold: 3, silver: 5, bronze: 2 }, runs: 14, dungeons: 3, readAt: 0,
                    best: [{ dungeon: "The Deadmines", seconds: 872, medal: "gold", place: 1, runsOfDungeon: 9, finishedAt: Date.UTC(2026, 9, 7), others: 4 }],
                },
            },
            frosti: { loot: { count: 0, lastAt: 0, items: [] }, dungeons: null },
        },
    };

    it("opens the loot when there is some, and shows roster status and - with LevelHelper data - the dungeon block as one line each", async () => {
        const { user } = setup();
        vi.mocked(api.getProfileRaiding).mockResolvedValue(RAIDING);
        await renderProfile("/profile?char=borka");

        // the loot is open from the start: icon framed in its quality, Wowhead link, the reason badge
        const item = await screen.findByRole("link", { name: "Helm of the Vanquished Hero" });
        expect(item).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=30236");
        expect(item.closest("li")?.querySelector("img.item-ico")).toHaveAttribute("src", "https://example.org/helm.jpg");
        expect(screen.getByText("BiS")).toHaveClass("rbadge");
        expect(screen.getByRole("link", { name: t("profile.loot.history", { count: 7 }) })).toHaveAttribute("href", "/history/char?name=Borka");
        expect(expandButtons().filter((b) => b.getAttribute("aria-expanded") === "true").map((b) => b.getAttribute("aria-label"))).toEqual([t("profile.fold.loot")]);

        expect(screen.getByText(`${t("roster.status.trial")} · SSC Mittwoch`)).toBeInTheDocument();
        expect(screen.getByText(t("profile.fold.dungeons"))).toBeInTheDocument();
        expect(screen.getByText(/1\.240 Erfolgspunkte/)).toBeInTheDocument();

        await openFold(user, "roster");
        expect(screen.getByText(t("profile.roster.thisChar"), { exact: false })).toBeInTheDocument();
        expect(screen.getByText(t("profile.roster.readOnly"))).toBeInTheDocument();
        // folded now, the loot shows its line
        expect(screen.getByText(new RegExp(t("profile.loot.sum", { count: 7, date: "X" }).split("X")[0]))).toBeInTheDocument();

        await openFold(user, "dungeons");
        expect(screen.getByText(t("profile.dungeons.pointsRank", { rank: 4, count: 31 }))).toBeInTheDocument();
        expect(screen.getByText("The Deadmines")).toBeInTheDocument();
        expect(screen.getByText("14:32")).toBeInTheDocument();
        expect(screen.getByText(new RegExp(t("profile.dungeons.record")))).toBeInTheDocument();
    });

    it("never shows the old answer while it reloads for another version: loading, then the new version's data", async () => {
        const VERSIONS = [
            { id: "tbc", label: "TBC Anniversary", short: "TBC", lastName: false },
            { id: "forever", label: "WoW Forever", short: "Forever", lastName: true },
        ];
        const DEVI = character({ key: "forever~devi res", name: "Devi Res", versionId: "forever", className: "Mage" });
        setup(profile({ characters: [BORKA, DEVI] }));
        vi.mocked(api.getProfile).mockResolvedValue({ ...profileData(profile({ characters: [BORKA, DEVI] })), mainVersion: "tbc", versions: VERSIONS });
        let answer: (r: ProfileRaiding) => void = () => undefined;
        vi.mocked(api.getProfileRaiding).mockImplementation((version) => (version === "forever"
            ? new Promise<ProfileRaiding>((resolve) => { answer = resolve; })
            : Promise.resolve(RAIDING)));
        renderPage(<ProfilePage />, { route: "/profile?char=borka", content: twoVersions() });
        expect(await screen.findByText(`${t("roster.status.trial")} · SSC Mittwoch`)).toBeInTheDocument();

        // a link to the Forever character switches the menu; the TBC answer must not show under Forever
        const user = userEvent.setup();
        await user.click(screen.getAllByRole("radio", { name: "Forever" })[0]);
        await waitFor(() => expect(api.getProfileRaiding).toHaveBeenCalledWith("forever"));
        await user.click(await screen.findByRole("tab", { name: /Devi Res/ }));
        expect(screen.queryByText(`${t("roster.status.trial")} · SSC Mittwoch`)).not.toBeInTheDocument();
        expect(screen.queryByText(t("profile.loot.none"))).not.toBeInTheDocument();
        expect(screen.getAllByText(t("profile.fold.loading")).length).toBeGreaterThan(0);

        answer({ versionId: "forever", rosters: [], characters: { "forever~devi res": { loot: { count: 0, lastAt: 0, items: [] }, dungeons: null } } });
        expect(await screen.findByText(t("profile.loot.none"))).toBeInTheDocument();
        expect(screen.getByText(t("profile.roster.none"))).toBeInTheDocument();
    });

    it("shows no dungeon block at all without LevelHelper data (TBC), and calm empty lines for roster and loot", async () => {
        setup();
        vi.mocked(api.getProfileRaiding).mockResolvedValue(RAIDING);
        await renderProfile("/profile?char=frosti");
        // Frosti is not the roster's character - the raider is in it with Borka
        expect(await screen.findByText(t("profile.roster.sumOther"))).toBeInTheDocument();
        expect(screen.getByText(t("profile.loot.none"))).toBeInTheDocument();
        expect(screen.queryByText(t("profile.fold.dungeons"))).not.toBeInTheDocument();
        expect(document.querySelector(".pf-medal")).toBeNull();
    });

    it("says „in keinem Roster“ when the raider is in none", async () => {
        setup();
        await renderProfile("/profile?char=borka");
        expect(await screen.findByText(t("profile.roster.none"))).toBeInTheDocument();
    });

    it("offers the Armory as a labelled button in the card's head, and nothing about gear beyond it", async () => {
        setup(profile({ characters: [character({ ...BORKA, armoryUrl: "https://classic-armory.org/character/eu/thunderstrike/borka" })] }));
        await renderProfile("/profile?char=borka");
        const armory = screen.getByRole("link", { name: t("profile.char.openArmory") });
        expect(armory).toHaveTextContent(t("profile.char.armory"));
        expect(armory).toHaveAttribute("target", "_blank");
        expect(document.body.textContent).not.toMatch(/Item-Level|Itemlevel|Ausrüstung/);
    });
});

describe("ProfilePage – the selected character", () => {
    it("keeps „kann offtanken / heilen“ on the selected character and saves it for that character only", async () => {
        const { user } = setup();
        await renderProfile("/profile?char=borka");

        expect(screen.getByRole("tab", { name: /Borka/, selected: true })).toBeInTheDocument();
        const offtank = screen.getByRole("checkbox", { name: new RegExp(t("profile.roles.offtank")) });
        expect(offtank).not.toBeChecked();
        expect(offtank.closest("label")).toHaveAttribute("data-tip", t("profile.roles.forChar", { label: t("profile.roles.offtank"), name: "Borka" }));
        expect(offtank.closest("label")).toHaveAttribute("data-tip-sub", t("profile.roles.suggested", { answer: t("profile.roles.yes") }));

        await user.click(offtank);
        expect(api.saveProfile).toHaveBeenCalledWith({ characters: [{ key: "borka", canOfftank: true }] });
        expect(offtank).toBeChecked();

        // the other character keeps its own answer
        await user.click(screen.getByRole("tab", { name: /Frosti/ }));
        expect(screen.getByRole("tab", { name: /Frosti/, selected: true })).toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: new RegExp(t("profile.roles.offtank")) })).not.toBeChecked();
        // never a profile-wide switch
        for (const [patch] of vi.mocked(api.saveProfile).mock.calls) {
            expect(patch).not.toHaveProperty("canOfftank");
            expect(patch).not.toHaveProperty("canHeal");
        }
    });

    it("disables a switch the character's class cannot use, off, with the reason in the tooltip", async () => {
        setup();
        await renderProfile("/profile?char=frosti");

        const heal = screen.getByRole("checkbox", { name: new RegExp(t("profile.roles.heal")) });
        // stored as true, but a mage cannot heal: shown off and locked
        expect(heal).toBeDisabled();
        expect(heal).not.toBeChecked();
        expect(heal.closest("label")).toHaveAttribute("data-tip-sub", "Die Klasse Magier hat keine Heil-Spec – das lässt sich nicht einschalten.");
        expect(screen.getByRole("checkbox", { name: new RegExp(t("profile.roles.offtank")) }).closest("label"))
            .toHaveAttribute("data-tip-sub", t("profile.roles.impossible.canOfftank", { cls: "Magier" }));
    });

    it("gives the reason in English on the English page", async () => {
        await switchLang("en");
        try {
            setup();
            await renderProfile("/profile?char=frosti");
            const offtank = screen.getByRole("checkbox", { name: new RegExp(t("profile.roles.offtank")) });
            expect(offtank.closest("label")?.getAttribute("data-tip-sub")).toMatch(/no tank spec/);
            expect(offtank.closest("label")?.getAttribute("data-tip-sub")).toContain("Mage");
            expect(screen.getByRole("tab", { name: "My Infos" })).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });

    it("shows the gear level as a segment that saves the spec's gear, and the log evidence as a badge with a tooltip", async () => {
        const { user } = setup();
        await renderProfile("/profile?char=borka");

        const seg = screen.getByRole("radiogroup", { name: /^Gear-Stand / });
        expect(within(seg).getAllByRole("radio").map((r) => r.textContent)).toEqual(["keins", "brauchbar", "raidbereit"]);
        expect(within(seg).getByRole("radio", { name: "brauchbar" })).toHaveAttribute("aria-checked", "true");

        await user.click(within(seg).getByRole("radio", { name: "raidbereit" }));
        expect(api.saveProfile).toHaveBeenCalledWith({ characters: [{ key: "borka", specs: [{ key: "Druid-Guardian", gear: "ready" }] }] });
        expect(within(seg).getByRole("radio", { name: "raidbereit" })).toHaveAttribute("aria-checked", "true");

        const badge = screen.getByText("laut Logs");
        expect(badge).toHaveAttribute("data-tip", t("profile.logs.seen"));
        expect(badge).toHaveAttribute("data-tip-sub", `${t("profile.logs.seenTip")}\n${t("profile.logs.reports", { count: 2 })}`);
    });

    it("warns about a character another account claimed instead of hiding it", async () => {
        const claimed = character({ ...FROSTI, claimedBy: [{ userId: "u9", name: "Ann" }] });
        const nameless = character({ key: "tanky", name: "Tanky", claimedBy: [{ userId: "u8", name: "" }] });
        const { user } = setup(profile({ characters: [BORKA, claimed, nameless] }));
        await renderProfile();

        const tab = screen.getByRole("tab", { name: /Frosti/ });
        const warn = within(tab).getByText("!");
        expect(warn).toHaveAttribute("data-tip", t("profile.char.claimed"));
        expect(warn).toHaveAttribute("data-tip-sub", t("profile.char.claimedChip", { names: "Ann" }));
        expect(within(screen.getByRole("tab", { name: /Borka/ })).queryByText("!")).not.toBeInTheDocument();

        await user.click(tab);
        const badge = screen.getByText("vergeben an Ann");
        expect(badge).toHaveAttribute("data-tip-sub", t("profile.char.claimedCard", { names: "Ann" }));

        await user.click(screen.getByRole("tab", { name: /Tanky/ }));
        expect(screen.getByText(t("profile.char.claimedBy", { name: t("profile.char.otherAccount") }))).toBeInTheDocument();
    });

    it("marks a character no log, loot or armory knows as not confirmed, with how to change that", async () => {
        const typed = character({ ...FROSTI, evidence: { verified: false, via: "" } });
        const logged = character({ ...BORKA, evidence: { verified: true, via: "log" } });
        const { user } = setup(profile({ characters: [logged, typed] }));
        await renderProfile("/profile?char=borka");
        expect(screen.queryByText("nicht bestätigt")).not.toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: /Frosti/ }));
        const badge = screen.getByText("nicht bestätigt");
        expect(badge).toHaveAttribute("data-tip-sub", t("profile.char.unverifiedTip"));
    });
});

describe("ProfilePage – wishes and „Nicht mit X raiden“", () => {
    it("marks the wishes as visible to the orga only and never shows whether one is mutual", async () => {
        const { user } = setup(profile({ wishes: [{ ...ANNA, mutual: true }] }));
        await renderProfile();

        const [wishBadge, avoidBadge] = screen.getAllByText(t("profile.fold.orgaOnly"));
        expect(wishBadge).toHaveAttribute("data-tip", t("profile.fold.orgaOnlyTip"));
        expect(wishBadge).toHaveAttribute("data-tip-sub", t("profile.fold.orgaOnlySub"));
        expect(avoidBadge).toHaveAttribute("data-tip-sub", t("profile.avoid.orgaOnlySub"));
        expect(t("profile.avoid.orgaOnlySub")).toMatch(/Nur die Orga/);

        await openFold(user, "wishes");
        expect(screen.getByText("Annabelle")).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/mutual|gegenseitig/i);
    });

    it("is off at first and asks before it is switched on, reminding that everyone deserves a chance", async () => {
        const { user } = setup();
        await renderProfile();

        // folded summary: "aus"
        expect(screen.getByText(t("profile.fold.avoidOff"))).toBeInTheDocument();
        await openFold(user, "avoid");
        const toggle = screen.getByRole("checkbox", { name: t("profile.avoid.switch") });
        expect(toggle).not.toBeChecked();
        expect(screen.getByText(t("profile.avoid.offText"))).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: t("profile.wishes.searchAria") })).not.toBeInTheDocument();

        // "Abbrechen" leaves it off and sends nothing
        await user.click(toggle);
        const dialog = await findDialog(t("profile.avoid.confirmTitle"));
        expect(within(dialog).getByText(/jeder eine Chance/)).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
        await waitFor(() => expect(dialog.open).toBe(false));
        expect(api.saveProfile).not.toHaveBeenCalled();
        expect(toggle).not.toBeChecked();

        await user.click(toggle);
        await user.click(within(await findDialog(t("profile.avoid.confirmTitle"))).getByRole("button", { name: t("profile.avoid.confirmAction") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ avoidEnabled: true }));
        expect(await screen.findByRole("textbox", { name: t("profile.wishes.searchAria") })).toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: t("profile.avoid.switch") })).toBeChecked();
    });

    it("never offers somebody who is already on the other list", async () => {
        const { user } = setup(profile({ wishes: [ANNA], avoidEnabled: true, avoid: [BERT] }));
        await renderProfile();

        await openFold(user, "avoid");
        const avoidSearch = screen.getByRole("textbox", { name: t("profile.wishes.searchAria") });
        // the open part: the folded wishes line above also names Annabelle
        const avoidPart = within(avoidSearch.closest("section")!);
        await user.type(avoidSearch, "a");
        const carl = await avoidPart.findByRole("button", { name: /Carlos/ });
        expect(avoidPart.queryByRole("button", { name: /Annabelle/ })).not.toBeInTheDocument();
        await user.click(carl);
        expect(api.saveProfile).toHaveBeenCalledWith({ avoid: ["u3", "u4"] });

        await openFold(user, "wishes");
        const wishSearch = screen.getByRole("textbox", { name: t("profile.wishes.searchAria") });
        const wishPart = within(wishSearch.closest("section")!);
        await user.type(wishSearch, "a");
        // Bert is not offered: he is on the avoid list (Carlos too, since the click above)
        await waitFor(() => expect(api.searchRaiders).toHaveBeenCalledTimes(2));
        expect(await wishPart.findByRole("button", { name: /Doris/ })).toBeInTheDocument();
        expect(wishPart.queryByRole("button", { name: /Bertram|Carlos|Annabelle/ })).not.toBeInTheDocument();
    });
});

describe("ProfilePage – Kalender-Abo (#312)", () => {
    const TOKEN = { id: "t1", name: "", hint: "ab12", createdAt: Date.UTC(2026, 8, 1), lastUsedAt: 0, uses: 0 };

    afterEach(() => {
        vi.mocked(api.createCalendarToken).mockReset();
    });

    it("is one folded line that warns the link is secret and shows a new link once", async () => {
        const { user } = setup();
        vi.mocked(api.createCalendarToken).mockResolvedValue({ tokens: [TOKEN], max: 3, configured: true, token: "s3cret", url: "https://example.org/cal/s3cret.ics" });
        await renderProfile();

        expect(screen.getByText(t("profile.fold.calendarNone"))).toBeInTheDocument();
        await openFold(user, "calendar");
        expect(screen.getByText("Der Link ist geheim:").tagName).toBe("STRONG");
        expect(screen.queryByText(t("profile.cal.onlyNow"))).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Link erzeugen" }));
        expect(api.createCalendarToken).toHaveBeenCalledTimes(1);
        expect(await screen.findByDisplayValue("https://example.org/cal/s3cret.ics")).toBeInTheDocument();
        expect(screen.getByText("nur jetzt sichtbar")).toBeInTheDocument();
        expect(screen.getByText(t("profile.cal.link", { hint: "ab12" }))).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("profile.cal.createMore") })).toBeInTheDocument();

        // folded again, the summary counts the links
        await openFold(user, "calendar");
        expect(screen.getByText(t("profile.fold.calendarActive", { count: 1 }))).toBeInTheDocument();
    });

    it("revokes a link after asking, and never asks the server for a secret back", async () => {
        const { user } = setup(profile(), { tokens: [TOKEN], max: 3, configured: true });
        vi.mocked(api.revokeCalendarToken).mockResolvedValue({ tokens: [], max: 3, configured: true, revoked: true });
        await renderProfile();

        await openFold(user, "calendar");
        await user.click(screen.getByRole("button", { name: t("profile.cal.revoke") }));
        const dialog = await findDialog(t("profile.cal.revokeTitle"));
        await user.click(within(dialog).getByRole("button", { name: t("profile.cal.revoke") }));

        await waitFor(() => expect(api.revokeCalendarToken).toHaveBeenCalledWith("t1"));
        expect(await screen.findByText(t("profile.cal.revoked"))).toBeInTheDocument();
        expect(screen.queryByText(t("profile.cal.link", { hint: "ab12" }))).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("profile.cal.create") })).toBeInTheDocument();
        expect(api.getCalendarTokens).toHaveBeenCalledTimes(1);
    });

    it("offers no link without a public base URL", async () => {
        const { user } = setup(profile(), { tokens: [], max: 3, configured: false });
        await renderProfile();
        await openFold(user, "calendar");
        expect(screen.getByText(t("profile.cal.noBaseUrl"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("profile.cal.create") })).not.toBeInTheDocument();
    });
});

describe("ProfilePage – adding a character", () => {
    it("offers the three ways when there is no character yet, above Meine Infos, each opening the one dialog on its tab", async () => {
        const { user } = setup(profile({ characters: [] }));
        renderPage(<ProfilePage />);

        expect(await screen.findByText(t("profile.first.title"))).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: t("profile.tabs.info"), selected: true })).toBeInTheDocument();
        expect(charTabs()).toEqual([]);

        await user.click(screen.getByRole("button", { name: new RegExp(t("profile.first.armoryTitle")) }));
        const dialog = await findDialog(t("profile.add.title"));
        expect(within(dialog).getByRole("radio", { name: t("profile.add.wayArmory") })).toHaveAttribute("aria-checked", "true");
    });

    it("opens the dialog on „Aus Logs“ from the [+] tab", async () => {
        const { user } = setup();
        await renderProfile();

        await user.click(screen.getByRole("tab", { name: t("profile.addCharacter") }));
        const dialog = await findDialog(t("profile.add.title"));
        expect(within(dialog).getByRole("radio", { name: t("profile.add.wayLog") })).toHaveAttribute("aria-checked", "true");
    });
});
