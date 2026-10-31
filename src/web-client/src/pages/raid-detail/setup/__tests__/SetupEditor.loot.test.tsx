// "Loot verteilen" in the setup editor (#1037): "Loot: n Überschneidungen" in the summary line, the
// list of contested items in "Details" (item links to Wowhead of the raid's version, spec wishes as text),
// the status of the loaded data, and "Loot-Daten laden" — the POST with `loadLoot`, polling while the
// job runs and a new proposal once it is done. The API is mocked at its transport.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../../../api/client";
import type { SetupEditorData, SetupLootCheck, SetupLootStatus } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import { editorData, setupCtx } from "../../../../test/fixtures/setupEditor";
import SetupEditor from "../SetupEditor";
import { LootPanel } from "../LootPanel";

vi.mock("../../../../api/client", async (orig) => ({ ...(await orig<typeof import("../../../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const CHECK: SetupLootCheck = {
    on: true,
    conflicts: 2,
    sources: { softres: 6, bis: 3, spec: 1, none: 0 },
    items: [
        // invented ids: the test checks the link, not the game data
        { itemId: 900001, name: "Testklinge", icon: "", quality: 4, spec: false, count: 3, eventIds: ["e1", "e2"], conflictIn: ["e1"] },
        { itemId: "spec:Mage-Fire", name: "Feuer-Magier", icon: "", quality: null, spec: true, count: 2, eventIds: ["e1", "e2"], conflictIn: [] },
    ],
};
const STORED: SetupLootStatus = { job: null, progress: null, counts: { signups: 50, gear: 31, softres: 10, bis: 5, spec: 3 }, at: Date.now(), wowheadPath: "tbc" };

function lootData(loot: SetupLootStatus | null = STORED, check: SetupLootCheck | undefined = CHECK): SetupEditorData {
    const base = editorData();
    return editorData({ loot }, { checks: { ...base.setup!.checks, ...(check ? { loot: check } : {}) } });
}

describe("LootPanel (#1037)", () => {
    it("lists the contested items with Wowhead links of the raid's version, spec wishes as plain text", () => {
        render(<LootPanel status={STORED} check={CHECK} busy={false} onLoad={() => {}} />);
        const list = screen.getByRole("list", { name: t("setup.loot.listAria") });
        const items = within(list).getAllByRole("listitem");
        expect(items).toHaveLength(2);
        const link = within(items[0]).getByRole("link");
        expect(link.getAttribute("href")).toContain("/tbc/item=900001");
        expect(items[0]).toHaveTextContent(t("setup.loot.wanted", { count: 3 }));
        expect(items[0]).toHaveTextContent(t("setup.loot.conflictIn", { count: 1 }));
        expect(within(items[1]).queryByRole("link")).toBeNull();
        expect(items[1]).toHaveTextContent(`${t("setup.loot.specItem")}: Feuer-Magier`);
        expect(items[1]).toHaveTextContent(t("setup.loot.spread"));
        expect(screen.getByRole("status")).toHaveTextContent(t("setup.loot.status", { gear: 31, signups: 50 }));
        expect(screen.getByText(t("setup.loot.sources", CHECK.sources))).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("setup.loot.reload") })).toBeEnabled();
    });

    it("drops the links for a version without Wowhead, never falls back to TBC", () => {
        render(<LootPanel status={{ ...STORED, wowheadPath: "" }} check={CHECK} busy={false} onLoad={() => {}} />);
        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.getByText("Testklinge")).toBeInTheDocument();
    });

    it("shows the progress while the job runs and blocks the button", () => {
        render(<LootPanel status={{ ...STORED, job: { status: "running", error: "" }, progress: { done: 12, total: 40 } }} check={CHECK} busy={false} onLoad={() => {}} />);
        expect(screen.getByRole("status")).toHaveTextContent(t("setup.loot.progress", { done: 12, total: 40 }));
        expect(screen.getByRole("button", { name: t("setup.loot.loading") })).toBeDisabled();
    });

    it("says what is missing without data, and the error of a failed job", () => {
        render(<LootPanel status={{ job: { status: "error", error: "softres down" }, progress: null, counts: null, at: 0 }} check={undefined} busy={false} onLoad={() => {}} />);
        expect(screen.getByRole("status")).toHaveTextContent(t("setup.loot.notLoaded"));
        expect(screen.getByText(t("setup.loot.failed", { error: "softres down" }))).toBeInTheDocument();
        expect(screen.queryByRole("list")).toBeNull();
        expect(screen.getByRole("button", { name: t("setup.loot.load") })).toBeEnabled();
    });
});

describe("Loot verteilen im Setup-Editor (#1037)", () => {
    let page: SetupEditorData;
    beforeEach(() => {
        page = lootData();
        vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
        vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
    });
    afterEach(() => vi.useRealTimers());

    async function show() {
        renderPage(<SetupEditor ctx={setupCtx()} />);
        await screen.findByRole("region", { name: t("setup.group.title", { index: 1 }) });
    }

    it("counts the overlaps in the summary line, and says nothing while the goal is off", async () => {
        await show();
        expect(screen.getByLabelText(t("setup.line.aria"))).toHaveTextContent(t("setup.loot.line", { count: 2 }));
    });

    it("says nothing in the line without the goal", async () => {
        page = lootData(STORED, { ...CHECK, on: false });
        await show();
        expect(screen.getByLabelText(t("setup.line.aria"))).not.toHaveTextContent(t("setup.loot.line", { count: 2 }));
    });

    it("hides the panel from who gets no loot status (no raid group, no orga)", async () => {
        const user = userEvent.setup();
        page = lootData(null);
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.line.details") }));
        expect(screen.queryByRole("button", { name: t("setup.loot.load") })).toBeNull();
        expect(screen.queryByRole("button", { name: t("setup.loot.reload") })).toBeNull();
    });

    it("starts the job with loadLoot, polls while it runs and proposes anew once it is done", async () => {
        const user = userEvent.setup();
        page = lootData({ ...STORED, counts: null, at: 0 }, undefined);
        await show();
        await user.click(screen.getByRole("button", { name: t("setup.line.details") }));
        const running = lootData({ ...STORED, counts: null, at: 0, job: { status: "running", error: "" }, progress: { done: 0, total: 40 } }, undefined);
        vi.mocked(client.send).mockImplementation(() => Promise.resolve(running));
        vi.mocked(client.get).mockImplementation(() => Promise.resolve(running));
        await user.click(screen.getByRole("button", { name: t("setup.loot.load") }));
        const posts = () => vi.mocked(client.send).mock.calls.filter(([m, p]) => m === "POST" && p === "/api/raids/setup/propose");
        expect(posts()[0][2]).toMatchObject({ loadLoot: true });
        expect(await screen.findByRole("button", { name: t("setup.loot.loading") })).toBeDisabled();

        // the job finishes: the next poll brings "done", and the editor proposes once more without loadLoot
        page = lootData({ ...STORED, job: { status: "done", error: "" } });
        vi.mocked(client.get).mockImplementation(() => Promise.resolve(page));
        vi.mocked(client.send).mockImplementation(() => Promise.resolve(page));
        await act(async () => { await new Promise((r) => setTimeout(r, 3100)); });
        await waitFor(() => expect(posts()).toHaveLength(2));
        expect(posts()[1][2]).not.toHaveProperty("loadLoot");
    }, 10000);
});
