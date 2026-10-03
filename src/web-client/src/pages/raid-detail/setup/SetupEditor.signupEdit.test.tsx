// "Anmeldung bearbeiten" in the setup editor (#521): the pencil on a raider (and
// a right click) opens the dialog, the orga changes status and spec, the answer
// redraws the editor — the raider stays on their place with the new spec. The
// API is mocked at its transport (api/client), so the tests also pin the requests.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../api/client";
import type { SetupEditorData, SetupSignupEdit } from "../../../api";
import { t } from "../../../i18n";
import { SIGNUP_STATUS } from "../../../lib/signups";
import { specLabel } from "../../../lib/wowNames";
import { inLang } from "../../../test/i18n";
import { renderPage } from "../../../test/render";
import { EVENT_ID, MAGE, PRIEST, ROGUE, TANK, editorData, person, setupCtx } from "../../../test/fixtures/setupEditor";
import SetupEditor from "./SetupEditor";

vi.mock("../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

/** Signed up as "Bank", waiting in "Angemeldet". */
const WAITER = person("u-wait", "Wartebank", { status: "bench" });

const spec = (key: string, label: string, role: "healer" | "ranged" | "melee" | "tank", inProfile: boolean) => ({ key, label, icon: "", role, inProfile, gear: "" });

/** What GET /api/raids/setup/signup answers for Ignis: fire in the profile, arcane and frost not. */
const IGNIS_EDIT: SetupSignupEdit = {
    userId: MAGE.userId,
    status: "signed",
    characters: [{ character: "Ignis", spec: "Mage-Fire", status: "signed" }],
    statuses: ["signed", "tentative", "late", "bench", "absence"],
    options: [{
        character: "Ignis", key: "ignis", classId: "Mage", classLabel: "Magier", classColor: "#3fc7eb", classIcon: "", inProfile: true,
        specs: [spec("Mage-Fire", "Feuer", "ranged", true), spec("Mage-Arcane", "Arkan", "ranged", false), spec("Mage-Frost", "Frost", "ranged", false)],
    }],
};

let page: SetupEditorData;
let edit: SetupSignupEdit;

function withPool(people: Partial<Record<string, Partial<typeof MAGE>>> = {}): SetupEditorData {
    const p = (x: typeof MAGE) => ({ ...x, ...(people[x.userId] || {}) });
    return editorData({}, {
        groups: [
            { index: 1, slots: [{ ...p(TANK), pos: 1 }, { ...p(MAGE), pos: 2 }] },
            { index: 2, slots: [{ ...p(PRIEST), pos: 1 }] },
        ],
        bench: [p(ROGUE)],
        pool: [p(WAITER)],
    });
}

beforeEach(() => {
    page = withPool();
    edit = IGNIS_EDIT;
    vi.mocked(client.get).mockImplementation((path: string) => Promise.resolve(path.startsWith("/api/raids/setup/signup") ? edit : page));
    vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
});

async function show() {
    renderPage(<SetupEditor ctx={setupCtx()} />);
    await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
}

function slot(character: string): HTMLElement {
    const el = screen.getAllByText(character).map((e) => e.closest<HTMLElement>("[data-user]")).find(Boolean);
    if (!el) throw new Error(`no slot for ${character}`);
    return el;
}

const dialog = () => screen.getByRole("dialog");
const calls = (method: string, path: string) => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === method && p === path);

describe("Anmeldung bearbeiten", () => {
    it("changes status and spec of a placed raider — the answer keeps Ignis on the place, now as frost", async () => {
        const user = userEvent.setup();
        await show();
        await user.hover(slot("Ignis"));
        await user.click(within(screen.getByRole("complementary", { name: t("setup.person.tip.aria") })).getByRole("button", { name: new RegExp(t("setup.signupEdit.short")) }));
        await within(dialog()).findByRole("radio", { name: SIGNUP_STATUS.late.label });
        expect(client.get).toHaveBeenCalledWith(`/api/raids/setup/signup?event=${EVENT_ID}&user=${MAGE.userId}`);
        const save = within(dialog()).getByRole("button", { name: t("common.save") });
        expect(save).toBeDisabled();

        // a spec the profile does not list is offered too — dashed, and named in one line once picked
        const frost = within(dialog()).getByRole("radio", { name: specLabel("Mage-Frost", "Frost") });
        expect(frost).toHaveClass("se-edit-off");
        await user.click(within(dialog()).getByRole("radio", { name: SIGNUP_STATUS.late.label }));
        await user.click(frost);
        expect(within(dialog()).getByText(t("setup.signupEdit.notInProfileHint", { spec: specLabel("Mage-Frost", "Frost"), character: "Ignis" }))).toBeInTheDocument();

        page = withPool({ [MAGE.userId]: { spec: "Mage-Frost", specLabel: "Frost", status: "late" } });
        await user.click(save);
        await waitFor(() => expect(calls("PUT", "/api/raids/setup/signup")).toHaveLength(1));
        expect(calls("PUT", "/api/raids/setup/signup")[0][2]).toEqual({ event: EVENT_ID, userId: MAGE.userId, status: "late", from: "Ignis", character: "Ignis", spec: "Mage-Frost" });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        const group1 = screen.getByRole("region", { name: t("setup.group.title", { index: 1 }) });
        expect(within(group1).getByText("Ignis").closest("[data-user]")).toHaveTextContent(specLabel("Mage-Frost", "Frost"));
    });

    it("opens with a right click in 'Angemeldet' too; signing off hides character and spec", async () => {
        const user = userEvent.setup();
        edit = { ...IGNIS_EDIT, userId: WAITER.userId, status: "bench", characters: [{ character: "Wartebank", spec: "Mage-Fire", status: "bench" }], options: [{ ...IGNIS_EDIT.options[0], character: "Wartebank", key: "wartebank" }] };
        await show();
        await user.pointer({ keys: "[MouseRight]", target: slot("Wartebank") });
        const signed = await within(dialog()).findByRole("radio", { name: SIGNUP_STATUS.bench.label });
        expect(signed).toHaveAttribute("aria-checked", "true");
        expect(within(dialog()).getByRole("radiogroup", { name: t("setup.signupEdit.spec") })).toBeInTheDocument();
        await user.click(within(dialog()).getByRole("radio", { name: SIGNUP_STATUS.absence.label }));
        expect(within(dialog()).queryByRole("radiogroup", { name: t("setup.signupEdit.spec") })).not.toBeInTheDocument();
        expect(within(dialog()).getByText(t("setup.signupEdit.absenceHint"))).toBeInTheDocument();
        await user.click(within(dialog()).getByRole("button", { name: t("common.save") }));
        await waitFor(() => expect(calls("PUT", "/api/raids/setup/signup")).toHaveLength(1));
        expect(calls("PUT", "/api/raids/setup/signup")[0][2]).toEqual({ event: EVENT_ID, userId: WAITER.userId, status: "absence", from: "Wartebank" });
    });

    it("keeps the dialog open with the server's reason when the save is refused", async () => {
        const user = userEvent.setup();
        await show();
        vi.mocked(client.send).mockImplementation((method: string, path: string) => (method === "PUT" && path === "/api/raids/setup/signup"
            ? Promise.reject(Object.assign(new Error("Diese Spezialisierung passt nicht."), { status: 400, code: "spec" }))
            : Promise.resolve(page)));
        await user.hover(slot("Ignis"));
        await user.click(within(screen.getByRole("complementary", { name: t("setup.person.tip.aria") })).getByRole("button", { name: new RegExp(t("setup.signupEdit.short")) }));
        await user.click(await within(dialog()).findByRole("radio", { name: SIGNUP_STATUS.tentative.label }));
        await user.click(within(dialog()).getByRole("button", { name: t("common.save") }));
        expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Diese Spezialisierung passt nicht.");
    });

    it("has English words", async () => {
        expect(await inLang("en", () => t("setup.signupEdit.open"))).toBe("Edit signup …");
        expect(await inLang("en", () => t("setup.signupEdit.notInProfile"))).toBe("not in profile");
    });
});
