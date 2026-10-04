// "Vorlage anwenden" per game version (#544): an event is offered the templates of its own version; those of other
// versions are folded away, and applying one of them warns first and then says so to the server.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { Besetzung, RaidplanBoss, RaidplanTemplateSummary, RaidplanView } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { raidDetail } from "../../test/fixtures/raidDetail";
import type { RaidCtx } from "./meta";
import RaidplanTab from "./RaidplanTab";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const BOSS: RaidplanBoss = {
    key: "forever-ony/trash", instanceId: "forever-ony", instanceName: "Onyxias Hort (Forever)", name: "Trash", iconUrl: "", mapUrl: "",
    mapSource: "", ownMap: false, instanceMap: false, trash: true,
};
const BES: Besetzung = { size: 40, counts: { tank: 4, healer: 10, dps: 26, melee: 0, ranged: 0 }, groups: 8, split: false };
const tpl = (id: string, name: string, versionId: string): RaidplanTemplateSummary => ({ id, name, category: "", description: "", guildId: "", versionId, instanceIds: [], bossCount: 1 });

function view(): RaidplanView {
    return {
        eventId: "own1", event: { id: "own1", title: "Onyxia", startTime: 0 }, versionId: "forever", canWrite: true,
        plan: { version: 1, status: "draft", publicPath: "", templateId: "", templateName: "", bosses: {}, updatedAt: 0 },
        bosses: [BOSS], besetzung: BES, catalog: { mobs: [], spells: [] }, roster: [], hasApprovedSetup: true,
        profiles: [], templates: [tpl("t-tbc", "Montags-BT", "tbc"), tpl("t-fv", "Ony-Aufstellung", "forever")],
        limits: { tokensPerBoss: 60, targetsPerBoss: 10, usersPerTarget: 5, title: 60, notes: 500, mapBytes: 1, profileName: 40, profileCategory: 40 },
    };
}

const ctx = (): RaidCtx => ({ data: raidDetail(), eventId: "own1", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn() });

class NoResize {
    observe() { /* nothing to measure in jsdom */ }
    unobserve() { /* nothing to measure in jsdom */ }
    disconnect() { /* nothing to measure in jsdom */ }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", NoResize);
    vi.mocked(client.get).mockImplementation((path: string) => (path.startsWith("/api/raidplan?") ? Promise.resolve(view()) : Promise.reject({ code: "not_mocked", message: path })));
    vi.mocked(client.send).mockReset().mockResolvedValue(view());
});

/** "Vorlage wählen" sits in the strip's "Mehr" menu since Oct 2026. */
async function openTemplates(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: t("raidBoard.views.more") }));
    await user.click(screen.getByRole("menuitem", { name: new RegExp(t("raidBoard.template.pick")) }));
}

describe("RaidplanTab: templates of the event's game version", () => {
    it("lists the event's version's templates, folds the others away and warns before applying one of them", async () => {
        const user = userEvent.setup();
        renderPage(<RaidplanTab ctx={ctx()} />);
        await openTemplates(user);
        const dialog = await screen.findByRole("dialog");
        const other = within(dialog).getByText(t("raidBoard.template.otherVersions", { count: 1 })).closest("details")!;
        expect(other).not.toHaveAttribute("open");
        // the own version's template stands in the list, the other one only inside the folded part
        const own = within(dialog).getByRole("button", { name: /Ony-Aufstellung/ });
        expect(other.contains(own)).toBe(false);
        expect(other.contains(within(dialog).getByText("Montags-BT"))).toBe(true);

        await user.click(within(other).getByText(t("raidBoard.template.otherVersions", { count: 1 })));
        await user.click(within(other).getByRole("button", { name: /Montags-BT/ }));
        const warn = (await screen.findByText(t("raidBoard.template.otherTitle"))).closest("dialog")!;
        expect(warn).toHaveTextContent("TBC-Vorlage");
        await user.click(within(warn).getByRole("button", { name: t("raidBoard.template.otherAction") }));
        expect(client.send).toHaveBeenCalledWith("POST", "/api/raidplan/apply", { event: "own1", templateId: "t-tbc", version: 1, otherVersion: true });
    });

    it("applies a template of the same version without the warning", async () => {
        const user = userEvent.setup();
        renderPage(<RaidplanTab ctx={ctx()} />);
        await openTemplates(user);
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: /Ony-Aufstellung/ }));
        expect(screen.queryByText(t("raidBoard.template.otherTitle"))).not.toBeInTheDocument();
        expect(client.send).toHaveBeenCalledWith("POST", "/api/raidplan/apply", { event: "own1", templateId: "t-fv", version: 1 });
    });
});
