// "Mein Profil" (#255) as the raider sees it: the page renders against a
// mocked profile API and every check is about what is on screen and which
// request a click sends. The stylesheet and routing promises that cannot be
// rendered stay in test/web-client/conventions/profilePage.test.js.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { CalendarTokens, GameClass, GameSpec, ProfileCharacter, ProfileData, ProfilePatch, RaiderProfile, RaiderRef } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
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
        key: "borka", name: "Borka", realm: "Thunderstrike", className: "Druid", main: true, source: "manual",
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
    key: "frosti", name: "Frosti", className: "Mage", main: false, canHeal: true,
    suggested: { canOfftank: false, canHeal: false }, possible: { canOfftank: false, canHeal: false },
});

const ANNA: RaiderRef = { userId: "u2", name: "anna", main: "Annabelle", className: "Mage" };
const BERT: RaiderRef = { userId: "u3", name: "bert", main: "Bertram", className: "Druid" };
const CARL: RaiderRef = { userId: "u4", name: "carl", main: "Carlos", className: "Mage" };
const DORA: RaiderRef = { userId: "u5", name: "dora", main: "Doris", className: "Druid" };
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

/** What the server answers to a PUT: the patch applied (characters by key). */
function applyPatch(p: RaiderProfile, patch: ProfilePatch): RaiderProfile {
    const { characters, wishes, avoid, ...rest } = patch;
    return {
        ...p,
        ...rest,
        characters: p.characters.map((c) => {
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
    return { user: userEvent.setup() };
}

async function renderProfile(route = "/profile") {
    renderPage(<ProfilePage />, { route });
    await screen.findByRole("tablist", { name: t("profile.charactersAria") });
}

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
const expandButtons = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));

beforeEach(() => {
    vi.clearAllMocks();
});

describe("ProfilePage – loading", () => {
    it("shows the raid loader with its own text while the profile loads, not a bare empty box", async () => {
        vi.mocked(api.getProfile).mockReturnValue(new Promise(() => undefined));
        vi.mocked(api.getCalendarTokens).mockResolvedValue(NO_TOKENS);
        renderPage(<ProfilePage />);
        expect(await screen.findByText(t("profile.loading"))).toBeInTheDocument();
    });
});

describe("ProfilePage – folded side column", () => {
    it("has the six parts in order, only „Wann ich kann“ open at first, and opening one closes the other", async () => {
        const { user } = setup();
        await renderProfile();

        const toggles = expandButtons();
        expect(toggles.map((b) => b.getAttribute("aria-label"))).toEqual(
            ["days", "raids", "wishes", "avoid", "note", "calendar"].map((k) => t(`profile.fold.${k}`)),
        );
        expect(toggles.filter((b) => b.getAttribute("aria-expanded") === "true")).toEqual([toggles[0]]);
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
});

describe("ProfilePage – the selected character", () => {
    it("keeps „kann offtanken / heilen“ on the selected character and saves it for that character only", async () => {
        const { user } = setup();
        await renderProfile();

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
        } finally {
            await switchLang("de");
        }
    });

    it("shows the gear level as a segment that saves the spec's gear, and the log evidence as a badge with a tooltip", async () => {
        const { user } = setup();
        await renderProfile();

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
        const nameless = character({ key: "tanky", name: "Tanky", main: false, claimedBy: [{ userId: "u8", name: "" }] });
        const { user } = setup(profile({ characters: [BORKA, claimed, nameless] }));
        await renderProfile();

        const chip = screen.getByRole("tab", { name: /Frosti/ });
        const warn = within(chip).getByText("!");
        expect(warn).toHaveAttribute("data-tip", t("profile.char.claimed"));
        expect(warn).toHaveAttribute("data-tip-sub", t("profile.char.claimedChip", { names: "Ann" }));
        expect(within(screen.getByRole("tab", { name: /Borka/ })).queryByText("!")).not.toBeInTheDocument();

        await user.click(chip);
        const badge = screen.getByText("vergeben an Ann");
        expect(badge).toHaveAttribute("data-tip-sub", t("profile.char.claimedCard", { names: "Ann" }));

        await user.click(screen.getByRole("tab", { name: /Tanky/ }));
        expect(screen.getByText(t("profile.char.claimedBy", { name: t("profile.char.otherAccount") }))).toBeInTheDocument();
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
    it("offers the three ways when there is no character yet, each opening the one dialog on its tab", async () => {
        const { user } = setup(profile({ characters: [] }));
        renderPage(<ProfilePage />);

        expect(await screen.findByText(t("profile.first.title"))).toBeInTheDocument();
        // no head action while the three ways are the page
        expect(screen.queryByRole("button", { name: t("profile.addCharacter") })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: new RegExp(t("profile.first.armoryTitle")) }));
        const dialog = await findDialog(t("profile.add.title"));
        expect(within(dialog).getByRole("radio", { name: t("profile.add.wayArmory") })).toHaveAttribute("aria-checked", "true");
    });

    it("opens the dialog on „Aus Logs“ from the head action", async () => {
        const { user } = setup();
        await renderProfile();

        await user.click(screen.getByRole("button", { name: t("profile.addCharacter") }));
        const dialog = await findDialog(t("profile.add.title"));
        expect(within(dialog).getByRole("radio", { name: t("profile.add.wayLog") })).toHaveAttribute("aria-checked", "true");
    });
});
