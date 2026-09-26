// The signup dialog (#256/#293/#306/#320) as the raider uses it: rendered with
// a mocked saveSignup, every check is about what the dialog offers and which
// signup a click sends. The pure pick rules are in lib/signupsPage.test.ts.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { OwnSignupRow } from "../api";
import { t } from "../i18n";
import { CAN_ALSO, GEAR_LABEL, SIGNUP_STATUS } from "../lib/signups";
import { specLabel } from "../lib/wowNames";
import { requireBackend } from "../test/backend";
import { switchLang } from "../test/i18n";
import { renderPage } from "../test/render";
import { CLASSES, PROFILE, counts, ownRow, signup } from "../test/signupFixtures";
import SignupDialog from "./SignupDialog";

vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), saveSignup: vi.fn() }));

const { SIGNUP_STATUSES } = requireBackend("utils/attendance");
const { CHARACTER_STATUSES } = requireBackend("services/signups/signupCharacters");

function show(row: OwnSignupRow = ownRow()) {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderPage(<SignupDialog row={row} profile={PROFILE} classes={CLASSES} onClose={onClose} onSaved={onSaved} />);
    return { onSaved, onClose, dialog: screen.getByRole("dialog") };
}

const radios = () => within(screen.getByRole("radiogroup")).getAllByRole("radio");
const radio = (status: string) => screen.getByRole("radio", { name: SIGNUP_STATUS[status as keyof typeof SIGNUP_STATUS].label });
const submitButton = () => screen.getByRole("button", { name: t("signups.signUp") });
const optionTexts = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);
const statusSelect = (n: number) => screen.getByRole("combobox", { name: t("signups.picks.statusAria", { n }) });
const startsWithAdd = (name: string) => name.startsWith(t("signups.picks.add"));
const addButton = () => screen.getByRole("button", { name: startsWithAdd });

beforeEach(() => {
    vi.mocked(api.saveSignup).mockReset();
    vi.mocked(api.saveSignup).mockResolvedValue({ signup: signup(), counts: counts({ attending: 4 }) });
});

afterEach(() => switchLang("de"));

describe("SignupDialog", () => {
    it("offers every status the backend knows, in the member's words", async () => {
        show();
        expect(radios().map((r) => r.textContent)).toEqual(SIGNUP_STATUSES.map((s: string) => t(`signups.status.${s}`)));
        expect(radio("signed")).toHaveAttribute("aria-checked", "true");

        await switchLang("en");
        expect(await screen.findByRole("radio", { name: "Signed up" })).toBeInTheDocument();
    });

    it("disables what the deadline no longer allows and says why", () => {
        show(ownRow({ deadlinePassed: true, allowedStatuses: ["late", "absence"] }));
        for (const s of ["signed", "tentative", "bench"]) {
            expect(radio(s)).toBeDisabled();
            expect(radio(s)).toHaveAttribute("data-tip-sub", t("signups.dialog.notAfterDeadline"));
        }
        expect(radio("late")).toBeEnabled();
        expect(radio("absence")).toBeEnabled();
        // "Dabei" is gone, so the dialog opens on the first status still allowed
        expect(radio("late")).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText(t("signups.dialog.deadlineHint"))).toBeInTheDocument();
    });

    it("picks character and spec from the profile, the spec with its gear level", async () => {
        const user = userEvent.setup();
        show();
        const character = screen.getByRole("combobox", { name: t("signups.picks.characterAria", { n: 1 }) });
        expect(optionTexts(character)).toEqual([`Zibbo${t("signups.picks.main")}`, "Zibbowar"]);
        expect(character).toHaveValue("zibbo");
        const spec = screen.getByRole("combobox", { name: t("signups.picks.specAria", { n: 1 }) });
        expect(optionTexts(spec)).toEqual([
            `${specLabel("Priest-Shadow", "Shadow")} · ${GEAR_LABEL.none}`,
            `${specLabel("Priest-Holy", "Holy")} · ${GEAR_LABEL.ready}`,
        ]);
        // the first spec with gear, not the first in the list
        expect(spec).toHaveValue("Priest-Holy");

        await user.selectOptions(character, "zibbowar");
        expect(screen.getByRole("combobox", { name: t("signups.picks.specAria", { n: 1 }) })).toHaveValue("Warrior-Protection");
    });

    it("sends every picked character in priority order (#293)", async () => {
        const user = userEvent.setup();
        const { onSaved } = show();
        expect(screen.queryByText(t("signups.picks.hint"), { exact: false })).not.toBeInTheDocument();

        await user.click(addButton());
        expect(screen.getByRole("combobox", { name: t("signups.picks.characterAria", { n: 2 }) })).toHaveValue("zibbowar");
        expect(screen.getByText("1")).toHaveAttribute("data-tip", t("signups.picks.firstChoice"));
        expect(screen.getByText("2")).toHaveAttribute("data-tip", t("signups.picks.canAlsoWith"));
        expect(screen.getByText(t("signups.picks.hint"), { exact: false })).toBeInTheDocument();
        // every character is on the list once — the profile has no third one to add
        expect(screen.queryByRole("button", { name: startsWithAdd })).not.toBeInTheDocument();

        // the warrior becomes the first choice
        await user.click(screen.getAllByRole("button", { name: t("signups.picks.moveDown") })[0]);
        expect(screen.getByRole("combobox", { name: t("signups.picks.characterAria", { n: 1 }) })).toHaveValue("zibbowar");

        await user.click(submitButton());
        expect(api.saveSignup).toHaveBeenCalledWith({
            eventId: "eh-kara",
            characters: [
                { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" },
                { character: "Zibbo", spec: "Priest-Holy", status: "signed" },
            ],
            status: "signed",
            // the warrior's own "kann auch" — never the tank role he signs up with
            canAlso: ["melee"],
            comment: "",
        });
        expect(onSaved).toHaveBeenCalledWith("eh-kara", signup(), counts({ attending: 4 }));
        expect(await screen.findByText(t("signups.dialog.toastSaved", { title: "Kara Freitag", status: SIGNUP_STATUS.signed.label }))).toBeInTheDocument();
    });

    it("prefills \"Ich kann auch\" from the profile and never offers the own role", async () => {
        const user = userEvent.setup();
        show();
        expect(screen.getByText(t("signups.dialog.canAlso"))).toBeInTheDocument();
        const chip = (r: keyof typeof CAN_ALSO) => screen.queryByRole("button", { name: CAN_ALSO[r].label });
        // Holy priest: healing is the own role, Shadow's ranged is prefilled
        expect(chip("healer")).not.toBeInTheDocument();
        expect(chip("ranged")).toHaveAttribute("aria-pressed", "true");
        expect(chip("tank")).toHaveAttribute("aria-pressed", "false");
        expect(chip("melee")).toHaveAttribute("aria-pressed", "false");

        // Shadow: ranged is now the own role, healing can be offered
        await user.selectOptions(screen.getByRole("combobox", { name: t("signups.picks.specAria", { n: 1 }) }), "Priest-Shadow");
        expect(chip("ranged")).not.toBeInTheDocument();
        expect(chip("healer")).toHaveAttribute("aria-pressed", "false");

        await user.click(chip("healer")!);
        await user.click(submitButton());
        expect(vi.mocked(api.saveSignup).mock.calls[0][0].canAlso).toEqual(["healer"]);
    });

    it("hints at a wish partner who is signed up, with the explanation in the tooltip", async () => {
        const user = userEvent.setup();
        show(ownRow({ wishPartners: [{ userId: "u2", name: "Alt" }, { userId: "u3", name: "Zap" }], wishes: true }));
        const badge = screen.getByText(t("signups.dialog.wishSignedUp", { count: 2, names: "Alt, Zap" }));
        const tip = badge.closest("[data-tip]");
        expect(tip).toHaveAttribute("data-tip", t("signups.dialog.wishTip"));
        expect(tip).toHaveAttribute("data-tip-sub", t("signups.dialog.wishOn"));

        // signing off makes the hint pointless
        await user.click(radio("absence"));
        expect(screen.queryByText(t("signups.dialog.wishSignedUp", { count: 2, names: "Alt, Zap" }))).not.toBeInTheDocument();
    });

    it("offers the calendar file and the public event page (#308)", () => {
        show(ownRow({ id: "eh kara" }));
        expect(screen.getByRole("link", { name: t("signups.dialog.calendar") })).toHaveAttribute("href", "/r/cal/eh%20kara.ics");
        expect(screen.getByRole("link", { name: t("signups.dialog.publicPage") })).toHaveAttribute("href", "/e/eh%20kara");
    });

    it("turns the comment into a required message to the raid lead with Vielleicht, per category", async () => {
        const user = userEvent.setup();
        show(ownRow({ noteMode: "required" }));
        // "Dabei" asks for a plain, optional comment
        expect(screen.getByLabelText(new RegExp(t("signups.dialog.comment")))).toHaveAttribute("aria-required", "false");
        expect(submitButton()).toBeEnabled();

        await user.click(radio("tentative"));
        const note = screen.getByLabelText(new RegExp(t("signups.dialog.note")));
        expect(note).toHaveAttribute("aria-required", "true");
        expect(screen.getByText(t("signups.dialog.required"))).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();

        await user.type(note, "x");
        expect(submitButton()).toBeDisabled();
        await user.type(note, "y");
        expect(submitButton()).toBeEnabled();
    });

    it("asks optionally for a message on Absagen, and not at all where the category says none", async () => {
        const user = userEvent.setup();
        show();
        await user.click(radio("absence"));
        expect(screen.getByLabelText(new RegExp(t("signups.dialog.note")))).toHaveAttribute("aria-required", "false");
        expect(screen.getByRole("button", { name: t("signups.dialog.signOff") })).toBeEnabled();
    });

    it("keeps the plain comment where the category asks for no message", async () => {
        const user = userEvent.setup();
        show(ownRow({ noteMode: "none" }));
        await user.click(radio("tentative"));
        expect(screen.getByLabelText(new RegExp(t("signups.dialog.comment")))).toBeInTheDocument();
        expect(screen.queryByText(t("signups.dialog.note"))).not.toBeInTheDocument();
    });

    it("names the message in English, too", async () => {
        const user = userEvent.setup();
        await switchLang("en");
        show(ownRow({ noteMode: "optional" }));
        await user.click(screen.getByRole("radio", { name: t("signups.status.tentative") }));
        expect(screen.getByLabelText(/Message to the raid lead/)).toBeInTheDocument();
    });

    it("shows what went wrong when the server refuses", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveSignup).mockRejectedValue({ code: "closed", message: "Anmeldung geschlossen" });
        const { onSaved } = show();
        await user.click(submitButton());
        expect(await screen.findByText("Anmeldung geschlossen")).toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });
});

// #320: the web sets the status per character, the way Discord has since #302.
describe("a status per character in the dialog (#320)", () => {
    it("shows no per-character status while only one character is picked", () => {
        show();
        expect(screen.queryByRole("combobox", { name: t("signups.picks.statusAria", { n: 1 }) })).not.toBeInTheDocument();
        expect(screen.getByText(t("signups.dialog.status"), { selector: "label" })).toBeInTheDocument();
    });

    it("is one quiet select per line — no absence, only what the phase still allows", async () => {
        const user = userEvent.setup();
        show();
        await user.click(addButton());
        expect(optionTexts(statusSelect(1))).toEqual(CHARACTER_STATUSES.map((s: string) => t(`signups.status.${s}`)));
        expect(optionTexts(statusSelect(2))).not.toContain(SIGNUP_STATUS.absence.label);
        // the big segment now sets them all
        expect(screen.getByText(t("signups.statusForAll"), { selector: "label" })).toBeInTheDocument();
    });

    it("limits the line's choice after the deadline", async () => {
        const user = userEvent.setup();
        show(ownRow({ deadlinePassed: true, allowedStatuses: ["late", "absence"] }));
        await user.click(addButton());
        expect(optionTexts(statusSelect(2))).toEqual([SIGNUP_STATUS.late.label]);
    });

    it("marks no segment option while the lines differ, and the segment sets them all again", async () => {
        const user = userEvent.setup();
        show();
        await user.click(addButton());
        await user.selectOptions(statusSelect(2), "late");
        expect(radios().filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
        expect(screen.getByText(t("signups.dialog.mixedStatus"))).toBeInTheDocument();

        await user.click(radio("tentative"));
        expect(statusSelect(1)).toHaveValue("tentative");
        expect(statusSelect(2)).toHaveValue("tentative");
        expect(radio("tentative")).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByText(t("signups.dialog.mixedStatus"))).not.toBeInTheDocument();
    });

    it("sends each character's own status, the signup's the first one's", async () => {
        const user = userEvent.setup();
        show();
        await user.click(addButton());
        await user.selectOptions(statusSelect(1), "late");
        await user.click(submitButton());
        expect(api.saveSignup).toHaveBeenCalledWith(expect.objectContaining({
            characters: [
                { character: "Zibbo", spec: "Priest-Holy", status: "late" },
                { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" },
            ],
            status: "late",
        }));
    });
});

// #306 — the waiting list reaches the raider, not only the roster.
describe("Warteliste im Dialog (#306)", () => {
    it("zeigt den Hinweis des Servers direkt nach dem Speichern", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveSignup).mockResolvedValue({
            signup: signup({ status: "bench" }), counts: counts(), waitlisted: true,
            notice: "Der Raid ist voll – du stehst auf der Warteliste.",
        });
        show();
        await user.click(submitButton());
        expect(await screen.findByText("Der Raid ist voll – du stehst auf der Warteliste.")).toBeInTheDocument();
        expect(screen.queryByText(t("signups.dialog.toastSaved", { title: "Kara Freitag", status: SIGNUP_STATUS.signed.label }))).not.toBeInTheDocument();
    });
});
