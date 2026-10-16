// "Mein Profil", part 2: the hour per weekday on "Meine Infos", the professions
// and the wish items on a character's tab - rendered against a mocked API.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GameClass, GameSpec, ProfileCharacter, ProfileData, ProfilePatch, ProfileRaiding, RaiderProfile } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import ProfilePage from "./ProfilePage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    getCalendarTokens: vi.fn(),
    getRaiderAttendance: vi.fn(),
    getProfileRaiding: vi.fn(),
    searchProfileItems: vi.fn(),
}));

function spec(classId: string, id: string, label: string, role: GameSpec["role"]): GameSpec {
    return { key: `${classId}-${id}`, id, classId, label, role, buffRole: "caster", icon: `icon_${id}`, canTank: role === "tank", canHeal: role === "healer" };
}
const DRUID: GameClass = { id: "Druid", label: "Druide", color: "#ff7d0a", icon: "classicon_druid", specs: [spec("Druid", "Restoration", "Wiederherstellung", "healer")] };

const HELM = { itemId: 30236, name: "Helm of the Vanquished Champion", icon: "inv_helmet_01", iconUrl: "https://example.org/helm.jpg", quality: 4, link: "https://www.wowhead.com/tbc/item=30236" };
const BORKA: ProfileCharacter = {
    key: "borka", name: "Borka", versionId: "tbc", realm: "", className: "Druid", source: "manual", armory: null, armoryUrl: "",
    specs: [], canOfftank: false, canHeal: false, suggested: { canOfftank: false, canHeal: true }, possible: { canOfftank: true, canHeal: true }, claimedBy: [],
    professions: [], wishItems: [HELM],
};

function profile(over: Partial<RaiderProfile> = {}): RaiderProfile {
    return {
        userId: "u1", name: "Anna", characters: [BORKA], canOfftank: false, canHeal: false, suggested: { canOfftank: false, canHeal: false },
        availability: ["mi"], availabilityFrom: {}, preferredRaids: [], wishes: [], avoidEnabled: false, avoid: [], note: "", updatedAt: 0,
        ...over,
    };
}

const PROFESSIONS = { professions: [{ id: "alpha", label: "Alpha-Beruf", labelEn: "Alpha trade", icon: "" }, { id: "beta", label: "Beta-Beruf", labelEn: "Beta trade", icon: "" }, { id: "gamma", label: "Gamma-Beruf", labelEn: "Gamma trade", icon: "" }], skillMax: 300 };

function data(p: RaiderProfile = profile(), professions = { professions: [], skillMax: null } as ProfileData["professionsByVersion"] extends Record<string, infer L> | undefined ? L : never): ProfileData {
    return {
        profile: p, isNew: false, classes: [DRUID],
        roles: { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" }, raidGroups: [],
        weekdays: ["mo", "di", "mi", "do", "fr", "sa", "so"].map((id) => ({ id, label: id })),
        gearLevels: [{ id: "usable", label: "brauchbar" }],
        limits: { characters: 12, wishes: 3, avoid: 3, note: 200, professions: 2, wishItems: 10, timeStep: 15 },
        professionsByVersion: { tbc: professions },
    };
}

const raiding = (lootCouncil: boolean): ProfileRaiding => ({
    versionId: "tbc", dungeonTimes: false, rosters: [],
    characters: { borka: { loot: { count: 0, lastAt: 0, items: [] }, dungeons: null, lootCouncil } },
});

/** The server's answer to a save: the patch applied as the store would (only what this suite sends). */
function answer(p: RaiderProfile, patch: ProfilePatch): RaiderProfile {
    const characters = p.characters.map((c) => {
        const edit = patch.characters?.find((x) => x.key === c.key);
        if (!edit) return c;
        return {
            ...c,
            professions: edit.professions ?? c.professions,
            wishItems: edit.wishItems ? edit.wishItems.map((id) => (id === HELM.itemId ? HELM : { ...HELM, itemId: id, name: `Item ${id}` })) : c.wishItems,
        };
    });
    return { ...p, ...(patch.availabilityFrom ? { availabilityFrom: patch.availabilityFrom } : {}), characters };
}

function setup(p = profile(), professions?: Parameters<typeof data>[1], lootCouncil = true) {
    let current = p;
    vi.mocked(api.getProfile).mockResolvedValue(data(p, professions));
    vi.mocked(api.saveProfile).mockImplementation(async (patch) => { current = answer(current, patch); return { profile: current }; });
    vi.mocked(api.getCalendarTokens).mockResolvedValue({ tokens: [], max: 3, configured: true });
    vi.mocked(api.getRaiderAttendance).mockResolvedValue({ userId: "u1", name: "Anna", own: true, orga: false, categories: [] });
    vi.mocked(api.getProfileRaiding).mockResolvedValue(raiding(lootCouncil));
    vi.mocked(api.searchProfileItems).mockResolvedValue({ items: [{ id: 28830, name: "Dragonspine Trophy", iconUrl: "", quality: 4 }] });
    return { user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());

describe("Wann ich kann - ab wann", () => {
    it("starts a chosen day without an hour at 19:00 with +, steps in quarter hours, and × gives back the whole evening", async () => {
        const { user } = setup();
        renderPage(<ProfilePage />, { route: "/profile" });
        const group = await screen.findByRole("group", { name: t("profile.days.fromAria", { day: t("profile.weekday.mi") }) });
        expect(within(group).getByText(t("profile.days.wholeEvening"))).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: t("profile.days.earlier") })).toBeDisabled();

        await user.click(within(group).getByRole("button", { name: t("profile.days.later") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ availabilityFrom: { mi: "19:00" } }));
        await user.click(within(group).getByRole("button", { name: t("profile.days.later") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ availabilityFrom: { mi: "19:15" } }));
        expect(within(group).getByText(t("profile.days.from", { time: "19:15" }))).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: t("profile.days.clear") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ availabilityFrom: {} }));
    });

    it("names the hour in the folded line", async () => {
        const { user } = setup(profile({ availabilityFrom: { mi: "19:30" } }));
        renderPage(<ProfilePage />, { route: "/profile" });
        await screen.findByRole("group", { name: t("profile.days.fromAria", { day: t("profile.weekday.mi") }) });
        await user.click(screen.getAllByRole("button", { name: t("profile.fold.days") }).find((b) => b.hasAttribute("aria-expanded"))!);
        expect(screen.getByText(t("profile.days.tagFrom", { day: t("profile.weekday.mi"), time: "19:30" }))).toBeInTheDocument();
    });
});

describe("Berufe", () => {
    it("is no part at all while the version has no list", async () => {
        setup();
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        await screen.findByRole("button", { name: t("profile.char.edit") });
        expect(screen.queryByText(t("profile.fold.professions"))).not.toBeInTheDocument();
    });

    it("invites without pressure, takes two professions at most and moves the skill with − and +", async () => {
        const { user } = setup(profile(), PROFESSIONS);
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        expect(await screen.findByText(t("profile.prof.none"))).toBeInTheDocument();
        await user.click(screen.getAllByRole("button", { name: t("profile.fold.professions") }).find((b) => b.hasAttribute("aria-expanded"))!);
        expect(screen.getByText(t("profile.prof.invite", { max: 2 }))).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Alpha-Beruf" }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ characters: [{ key: "borka", professions: [{ id: "alpha", skill: 0 }] }] }));
        await user.click(screen.getByRole("button", { name: t("profile.prof.more") }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ characters: [{ key: "borka", professions: [{ id: "alpha", skill: 5 }] }] }));
        await user.click(screen.getByRole("button", { name: "Beta-Beruf" }));
        // two chosen: no more chips to add
        expect(await screen.findByText("Beta-Beruf")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Gamma-Beruf" })).not.toBeInTheDocument();
    });

    it("names the professions in the page's language and follows a switch", async () => {
        setup(profile({ characters: [{ ...BORKA, professions: [{ id: "alpha", skill: 150 }] }] }), PROFESSIONS);
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        expect(await screen.findByText(t("profile.prof.withSkill", { name: "Alpha-Beruf", skill: 150 }))).toBeInTheDocument();
        await switchLang("en");
        try {
            expect(await screen.findByText(t("profile.prof.withSkill", { name: "Alpha trade", skill: 150 }))).toBeInTheDocument();
        } finally {
            await switchLang("de");
        }
    });
});

describe("Wunsch-Items", () => {
    it("are no part for a character outside a Loot-Council roster without any", async () => {
        setup(profile({ characters: [{ ...BORKA, wishItems: [] }] }), undefined, false);
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        await screen.findByText(t("profile.roster.none"));
        expect(screen.queryByText(t("profile.fold.wishItems"))).not.toBeInTheDocument();
    });

    it("stay to read and take out after the character left the Loot-Council roster - no search, a calm word why", async () => {
        const { user } = setup(profile(), undefined, false);
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        const section = (await screen.findByText(t("profile.fold.wishItems"))).closest("section")!;
        await user.click(within(section).getAllByRole("button", { name: t("profile.fold.wishItems") }).find((b) => b.hasAttribute("aria-expanded"))!);
        expect(within(section).getByText(t("profile.wishItems.readOnly"))).toBeInTheDocument();
        expect(within(section).queryByPlaceholderText(t("profile.wishItems.search"))).not.toBeInTheDocument();
        await user.click(within(section).getByRole("button", { name: t("profile.wishItems.remove", { name: HELM.name }) }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ characters: [{ key: "borka", wishItems: [] }] }));
    });

    it("keep two picks and a × made before the first answer: each save builds on what the page shows", async () => {
        const { user } = setup();
        // the server answers only when told to
        const answers: (() => void)[] = [];
        let current = profile();
        vi.mocked(api.saveProfile).mockImplementation((patch) => new Promise((resolve) => {
            answers.push(() => { current = answer(current, patch); resolve({ profile: current }); });
        }));
        vi.mocked(api.searchProfileItems).mockImplementation(async (q) => ({
            items: q.startsWith("Drag") ? [{ id: 28830, name: "Dragonspine Trophy", iconUrl: "", quality: 4 }] : [{ id: 32837, name: "Warglaive of Azzinoth", iconUrl: "", quality: 5 }],
        }));
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        const section = (await screen.findByText(t("profile.fold.wishItems"))).closest("section")!;
        await user.click(within(section).getAllByRole("button", { name: t("profile.fold.wishItems") }).find((b) => b.hasAttribute("aria-expanded"))!);
        const input = within(section).getByPlaceholderText(t("profile.wishItems.search"));

        await user.type(input, "Dragon");
        await user.click(await within(section).findByText("Dragonspine Trophy"));
        // the found item shows at once, before any answer
        expect(within(section).getByText("Dragonspine Trophy")).toBeInTheDocument();
        await user.type(input, "Warglaive");
        await user.click(await within(section).findByText("Warglaive of Azzinoth"));
        await user.click(within(section).getByRole("button", { name: t("profile.wishItems.remove", { name: HELM.name }) }));

        // the saves go out one after the other, each with the list the page showed then
        await waitFor(() => expect(answers).toHaveLength(1));
        answers[0]();
        await waitFor(() => expect(answers).toHaveLength(2));
        answers[1]();
        await waitFor(() => expect(answers).toHaveLength(3));
        answers[2]();
        await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(3));
        expect(vi.mocked(api.saveProfile).mock.calls.map(([p]) => p.characters?.[0].wishItems)).toEqual([
            [30236, 28830], [30236, 28830, 32837], [28830, 32837],
        ]);
        await waitFor(() => expect(within(section).queryByRole("link", { name: HELM.name })).not.toBeInTheDocument());
        expect(within(section).getByText("Item 28830")).toBeInTheDocument();
        expect(within(section).getByText("Item 32837")).toBeInTheDocument();
    });

    it("are marked orga-only, take a found item and let one go", async () => {
        const { user } = setup();
        renderPage(<ProfilePage />, { route: "/profile?char=borka" });
        const fold = await screen.findByText(t("profile.fold.wishItems"));
        const section = fold.closest("section")!;
        expect(within(section).getByText(t("profile.fold.orgaOnly"))).toHaveAttribute("data-tip-sub", t("profile.wishItems.orgaOnlySub"));
        await user.click(within(section).getAllByRole("button", { name: t("profile.fold.wishItems") }).find((b) => b.hasAttribute("aria-expanded"))!);
        expect(within(section).getByRole("link", { name: HELM.name })).toHaveAttribute("href", HELM.link);

        await user.type(within(section).getByPlaceholderText(t("profile.wishItems.search")), "Dragon");
        await user.click(await within(section).findByText("Dragonspine Trophy"));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ characters: [{ key: "borka", wishItems: [30236, 28830] }] }));
        expect(api.searchProfileItems).toHaveBeenCalledWith("Dragon", "tbc");

        await user.click(within(section).getByRole("button", { name: t("profile.wishItems.remove", { name: HELM.name }) }));
        await waitFor(() => expect(api.saveProfile).toHaveBeenLastCalledWith({ characters: [{ key: "borka", wishItems: [28830] }] }));
    });
});
