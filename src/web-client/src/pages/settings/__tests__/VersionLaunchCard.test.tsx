// "Neue Version starten" (#745): the card shows the server's checklist, a
// switch only on the manual items, and stores a mark right away.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { renderPage } from "../../../test/render";
import VersionLaunchCard from "../VersionLaunchCard";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getVersionLaunch: vi.fn(),
    markVersionLaunch: vi.fn(),
}));

const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];

function checklist(talkDone = false): api.LaunchChecklist {
    return {
        versionId: "forever", label: "WoW Forever", short: "Forever", done: talkDone ? 3 : 2, total: 10,
        items: [
            { id: "categories", kind: "auto", status: "done", optional: false, mark: null, total: 2, missing: [], target: [{ id: "c2", name: "Mittwoch" }] },
            { id: "rosters", kind: "auto", status: "open", optional: false, mark: null, categories: 1, problems: [{ categoryId: "c2", name: "Mittwoch", rosterId: "", problems: ["missing"] }] },
            { id: "talk", kind: "manual", status: talkDone ? "done" : "open", optional: false, mark: talkDone ? { at: 1, byName: "Orga" } : null },
            { id: "mainVersion", kind: "auto", status: "open", optional: true, mark: null, mainVersion: "tbc", isMain: false, hidden: false },
        ],
    };
}

beforeEach(() => {
    vi.mocked(api.getVersionLaunch).mockResolvedValue({ checklist: checklist() });
    vi.mocked(api.markVersionLaunch).mockResolvedValue({ checklist: checklist(true) });
});

describe("VersionLaunchCard (#745)", () => {
    it("lists the items with their state, a switch only for the manual one", async () => {
        renderPage(<VersionLaunchCard versions={VERSIONS} canExport={false} />);
        expect(await screen.findByText("Roster mit Rollen und Managern")).toBeInTheDocument();
        expect(api.getVersionLaunch).toHaveBeenCalledWith("");
        expect(screen.getByText("2 von 10 erledigt")).toBeInTheDocument();
        const rosters = screen.getByText("Roster mit Rollen und Managern").closest("li")!;
        expect(within(rosters).getByText("offen")).toBeInTheDocument();
        expect(within(rosters).getByText("0 / 1")).toBeInTheDocument();
        expect(within(rosters).getByRole("link", { name: /Roster/ })).toHaveAttribute("href", "/roster");
        expect(within(rosters).queryByRole("switch")).not.toBeInTheDocument();
        expect(screen.getAllByRole("switch")).toHaveLength(1);
        expect(screen.getByText("optional")).toBeInTheDocument();
    });

    it("stores a mark at once and shows the fresh list", async () => {
        const user = userEvent.setup();
        renderPage(<VersionLaunchCard versions={VERSIONS} canExport={false} />);
        const mark = await screen.findByRole("switch", { name: /Raid-Listen und Erinnerungen geprüft: erledigt/ });
        expect(mark).not.toBeChecked();
        await user.click(mark);
        expect(api.markVersionLaunch).toHaveBeenCalledWith("forever", "talk", true);
        expect(await screen.findByText("3 von 10 erledigt")).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: /Raid-Listen und Erinnerungen/ })).toBeChecked();
    });

    it("switches the target version", async () => {
        const user = userEvent.setup();
        renderPage(<VersionLaunchCard versions={VERSIONS} canExport={false} />);
        await screen.findByText("Roster mit Rollen und Managern");
        await user.click(screen.getByRole("radio", { name: /TBC/ }));
        expect(api.getVersionLaunch).toHaveBeenLastCalledWith("tbc");
    });

    it("says when the list cannot be loaded", async () => {
        vi.mocked(api.getVersionLaunch).mockRejectedValue({ code: "x", message: "kaputt" });
        renderPage(<VersionLaunchCard versions={VERSIONS} canExport={false} />);
        expect(await screen.findByText(/Checkliste nicht ladbar/)).toBeInTheDocument();
    });
});
