// The Verlauf tab (#655): the roster's history newest first in words - who,
// when, what - and "Mehr zeigen" for the next page; English.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import HistoryTab from "./HistoryTab";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { historyEntry } from "./rosters.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRosterHistory: vi.fn(),
}));

const FIRST = [
    historyEntry({ what: "role-give-failed", detail: "@Raider Mo/Do: no_permission", by: "", byName: "" }),
    historyEntry({ what: "member", detail: "via Discord · status core → pause" }),
    historyEntry({ what: "role-given", detail: "@Raider Mo/Do" }),
];

beforeEach(() => {
    vi.mocked(api.getRosterHistory).mockReset();
    vi.mocked(api.getRosterHistory)
        .mockResolvedValueOnce({ entries: FIRST, total: 4, offset: 0, limit: 50 })
        .mockResolvedValueOnce({ entries: [historyEntry({ what: "created", detail: "migration", userId: "", userName: "" })], total: 4, offset: 3, limit: 50 });
});
afterEach(() => switchLang("de"));

describe("HistoryTab", () => {
    it("lists the changes newest first in words, with who did them", async () => {
        renderPage(<HistoryTab rosterId="r1" reloadKey={0} />);
        expect(await screen.findByText("Rolle @Raider Mo/Do konnte Thorgrim nicht gegeben werden: Dem Bot fehlt das Recht „Rollen verwalten“.")).toBeInTheDocument();
        expect(screen.getByText("Thorgrim: Status Stamm → Pause (über Discord)")).toBeInTheDocument();
        expect(screen.getByText("Rolle @Raider Mo/Do an Thorgrim gegeben")).toBeInTheDocument();
        expect(screen.getByText("vom Bot")).toBeInTheDocument();
        expect(screen.getAllByText("von Marc")).toHaveLength(2);
        expect(screen.getByText("4 Einträge")).toBeInTheDocument();
        expect(api.getRosterHistory).toHaveBeenCalledWith("r1", { offset: 0, limit: 50 });
    });

    it("loads the next page on 'Mehr zeigen'", async () => {
        renderPage(<HistoryTab rosterId="r1" reloadKey={0} />);
        await userEvent.click(await screen.findByRole("button", { name: "1 weiteren zeigen" }));
        expect(await screen.findByText("Roster aus den Raider-Rollen der Kategorie übernommen")).toBeInTheDocument();
        expect(api.getRosterHistory).toHaveBeenLastCalledWith("r1", { offset: 3, limit: 50 });
        await waitFor(() => expect(screen.queryByRole("button", { name: /weitere/ })).not.toBeInTheDocument());
    });

    it("says so when there is nothing yet", async () => {
        vi.mocked(api.getRosterHistory).mockReset();
        vi.mocked(api.getRosterHistory).mockResolvedValue({ entries: [], total: 0, offset: 0, limit: 50 });
        renderPage(<HistoryTab rosterId="r1" reloadKey={0} />);
        expect(await screen.findByText("Noch keine Einträge.")).toBeInTheDocument();
    });

    it("speaks English", async () => {
        await switchLang("en");
        renderPage(<HistoryTab rosterId="r1" reloadKey={0} />);
        expect(await screen.findByText("Role @Raider Mo/Do given to Thorgrim")).toBeInTheDocument();
        expect(screen.getByText("Thorgrim: status Core → Paused (via Discord)")).toBeInTheDocument();
        expect(screen.getByText("by the bot")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Show 1 more" })).toBeInTheDocument();
    });
});
