// Raid-Vorlagen (#266) as the orga sees them: one compact row per template
// (icons, name, label, size/tanks/healers), a remembered game-version filter,
// the editor as a dialog held in the url, short on top and the rest behind
// "Mehr", and tanks/healers proposed on a size change. Rule set: the server's
// real one; the API is mocked at its transport (api/client).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { GameVersion, RaidTemplate } from "../api";
import { t } from "../i18n";
import { proposeComposition } from "../lib/raidTemplates";
import { requireBackend } from "../test/backend";
import { switchLang } from "../test/i18n";
import { adminUser, renderPage } from "../test/render";
import RaidTemplatesPage from "./RaidTemplatesPage";

vi.mock("../api/client", async (orig) => ({ ...(await orig<typeof import("../api/client")>()), get: vi.fn(), send: vi.fn() }));

const { publicVersions } = requireBackend("config/gameVersions");
const versions: GameVersion[] = publicVersions();
const tbc = versions.find((v) => v.id === "tbc")!;

function template(id: string, name: string, over: Partial<RaidTemplate> = {}): RaidTemplate {
    return {
        id, name, versionId: "tbc", instanceIds: ["kara"], size: 10,
        composition: { tank: 2, healer: 3, melee: null, ranged: null },
        requiredBuffs: [], signupDeadline: null, durationMinutes: null, fairness: false, wishes: false,
        raidhelperTemplateId: "", ...over,
    };
}

const TEMPLATES: RaidTemplate[] = [
    template("t1", "Kara Donnerstag"),
    template("t2", "Ony", { versionId: "classic", instanceIds: ["ony"], size: 40, composition: { tank: 4, healer: 10, melee: null, ranged: null } }),
    template("t3", "Altes Raid-Helper-Event", { instanceIds: [], size: null, needsSize: true, incomplete: true }),
];

beforeEach(() => {
    vi.mocked(client.get).mockImplementation((path: string) => {
        if (path === "/api/raid-templates") return Promise.resolve({ templates: TEMPLATES, categoryNames: {} });
        if (path === "/api/game-versions") return Promise.resolve({ versions, defaultVersion: "tbc" });
        return Promise.reject({ code: "not_mocked", message: path });
    });
    vi.mocked(client.send).mockResolvedValue(TEMPLATES[0]);
});

function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
}

async function show(route = "/raids/raid-templates") {
    const view = renderPage(<><RaidTemplatesPage /><Where /></>, { route, user: adminUser() });
    await screen.findByRole("heading", { name: "Raid-Vorlagen" });
    return view;
}

const row = (name: string) => screen.getByText(name).closest<HTMLElement>("button")!;
const rowNames = () => TEMPLATES.map((tpl) => tpl.name).filter((name) => screen.queryByText(name));
const where = () => screen.getByTestId("where").textContent;

describe("the Raid-Vorlagen list", () => {
    it("draws one compact row per template: name, then size, tanks and healers", async () => {
        await show();
        expect(within(row("Kara Donnerstag")).getByText("Größe").nextSibling).toHaveTextContent("10");
        expect(within(row("Kara Donnerstag")).getByText("Tanks").nextSibling).toHaveTextContent("2");
        expect(within(row("Kara Donnerstag")).getByText("Heiler").nextSibling).toHaveTextContent("3");
        // a migrated template without size: badges instead of made-up numbers
        const old = row("Altes Raid-Helper-Event");
        expect(within(old).getByText("Infos fehlen")).toBeInTheDocument();
        expect(within(old).getByText("Größe ergänzen")).toBeInTheDocument();
        expect(within(old).getByText("Tanks").nextSibling).toHaveTextContent("–");
    });

    it("filters by game version with a segment that is remembered", async () => {
        const user = userEvent.setup();
        const view = await show();
        expect(rowNames()).toEqual(["Kara Donnerstag", "Ony", "Altes Raid-Helper-Event"]);
        const filter = screen.getAllByRole("radiogroup", { name: "Spielversion" })[0];
        await user.click(within(filter).getByRole("radio", { name: tbc.short }));
        expect(rowNames()).toEqual(["Kara Donnerstag", "Altes Raid-Helper-Event"]);

        view.unmount();
        await show();
        expect(rowNames()).toEqual(["Kara Donnerstag", "Altes Raid-Helper-Event"]);
    });
});

describe("the Raid-Vorlagen page in English", () => {
    afterEach(() => switchLang("de"));

    it("names the list and the editor in English", async () => {
        await switchLang("en");
        renderPage(<RaidTemplatesPage />, { route: "/raids/raid-templates?edit=t2", user: adminUser() });
        await screen.findByRole("heading", { name: "Raid templates" });
        expect(within(row("Altes Raid-Helper-Event")).getByText("Info missing")).toBeInTheDocument();
        expect(within(row("Kara Donnerstag")).getByText("Healers").nextSibling).toHaveTextContent("3");
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText(/^More:/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Signup deadline (hours before start)")).toBeInTheDocument();
        expect(within(dialog).getByRole("checkbox", { name: "Wishes" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
});

describe("the Raid-Vorlagen editor", () => {
    it("opens a template in a dialog held in the url, and Abbrechen closes it", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(row("Kara Donnerstag"));
        expect(where()).toBe("/raids/raid-templates?edit=t1");
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Kara Donnerstag");
        await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
        expect(where()).toBe("/raids/raid-templates");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens straight from a link", async () => {
        await show("/raids/raid-templates?edit=t2");
        expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Name" })).toHaveValue("Ony");
    });

    it("keeps the dialog short: size, tanks and healers first, everything else behind Mehr", async () => {
        await show("/raids/raid-templates?edit=t1");
        const dialog = screen.getByRole("dialog");
        // "Mehr" is a closed disclosure (<details>)
        const more = within(dialog).getByText(/^Mehr:/).closest("details")!;
        expect(more).not.toHaveAttribute("open");
        const size = within(dialog).getByRole("radiogroup", { name: t("raidPlan.fields.size") });
        const tanks = within(dialog).getByRole("button", { name: t("raidPlan.comp.tankMore") });
        for (const first of [size, tanks]) {
            expect(more.contains(first)).toBe(false);
            expect(first.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        for (const later of [
            within(more).getByText(t("raidPlan.fields.look")),
            within(more).getByText(t("raidPlan.fields.buffs")),
            within(more).getByLabelText("Anmeldeschluss (Stunden vor Start)"),
            within(more).getByLabelText("Raid-Helper-Vorlage (ID)"),
            within(more).getByRole("checkbox", { name: "Fairness" }),
            within(more).getByRole("checkbox", { name: "Wünsche" }),
        ]) expect(later).toBeInTheDocument();
    });

    it("keeps the „Größe ergänzen“ hint beside the size of a template without one", async () => {
        await show("/raids/raid-templates?edit=t3");
        const size = within(screen.getByRole("dialog")).getByRole("radiogroup", { name: t("raidPlan.fields.size") });
        expect(within(size.parentElement!).getByText("Größe ergänzen")).toBeInTheDocument();
    });

    it("proposes tanks and healers when the size changes, and saves the draft", async () => {
        const user = userEvent.setup();
        await show("/raids/raid-templates?edit=t1");
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: new RegExp(tbc.instances.find((i) => i.id === "gruul")!.short) }));
        const proposal = proposeComposition(tbc, ["kara", "gruul"], 25);
        await user.click(within(within(dialog).getByRole("radiogroup", { name: t("raidPlan.fields.size") })).getByRole("radio", { name: "25" }));
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
        const [method, path, body] = vi.mocked(client.send).mock.calls[0];
        expect([method, path]).toEqual(["PATCH", "/api/raid-templates"]);
        expect(body).toMatchObject({ id: "t1", size: 25, instanceIds: ["kara", "gruul"], composition: { tank: proposal.tank, healer: proposal.healer } });
    });
});
