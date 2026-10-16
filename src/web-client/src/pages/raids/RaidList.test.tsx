// A cancelled raid (Event verwalten, #288) in the Raid-Events lists: red badge next to the
// struck-through title, the signup bar replaced by "abgesagt" plus the shortened reason,
// the full text in the tooltips; in a raid group each raid carries its own state.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PastRaid, UpcomingRaid } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { PastRaidList, UpcomingRaidList } from "./RaidList";

const FUTURE = Math.floor(Date.now() / 1000) + 3 * 86400;
const PAST_START = Math.floor(Date.now() / 1000) - 3 * 86400;

function upcoming(over: Partial<UpcomingRaid>): UpcomingRaid {
    return {
        id: "1000", title: "", startTime: FUTURE, channelId: "", channelName: "", categoryId: "", categoryName: "",
        contentIds: [], contentSources: [], softres: null, versionId: "tbc", signupCount: 23, raidSize: 25, raidSizeKnown: true, ...over,
    };
}

function past(over: Partial<PastRaid>): PastRaid {
    return {
        id: "2000", title: "", startTime: PAST_START, channelId: "", channelName: "", categoryId: "", categoryName: "",
        contentIds: [], contentSources: [], softres: null, versionId: "tbc", logs: [], pendingLogs: [], pendingLogCount: 0, lootCount: 0, ...over,
    };
}

const REASON = "Zu wenige Tanks angemeldet, wir holen den Raid nächste Woche nach und melden uns dann noch einmal bei allen.";
const CANCELLED = { cancelled: true, cancelReason: REASON, cancelledAt: Date.UTC(2026, 9, 14, 10, 0), cancelledByName: "Anna" };

function rowOf(title: string): HTMLElement {
    const row = screen.getByRole("link", { name: title }).closest<HTMLElement>("[role=\"row\"]");
    if (!row) throw new Error(`no row for ${title}`);
    return row;
}

const noop = () => undefined;
const showUpcoming = (events: UpcomingRaid[]) => renderPage(<UpcomingRaidList events={events} guildId="g1" canWrite onRepeat={noop} emptyMessage="leer" />);

describe("UpcomingRaidList: cancelled raids", () => {
    it("marks the row: badge, struck-through title class, no bar, reason with the full text in the tooltip", () => {
        showUpcoming([upcoming({ id: "1", title: "Hyjal + BT + Gruul", ...CANCELLED }), upcoming({ id: "2", title: "Kara", signupCount: 5 })]);
        const row = rowOf("Hyjal + BT + Gruul");
        expect(row).toHaveClass("is-cancelled");
        expect(within(row).getByText(t("raids.list.cancelled"))).toBeInTheDocument();
        expect(within(row).queryByText("23 / 25")).toBeNull();
        const note = within(row).getByText(t("raids.list.cancelledShort")).closest("[data-tip]") as HTMLElement;
        expect(note).toHaveTextContent(REASON);
        expect(note.getAttribute("data-tip")).toContain("Anna");
        expect(note.getAttribute("data-tip-sub")).toBe(REASON);

        const other = rowOf("Kara");
        expect(other).not.toHaveClass("is-cancelled");
        expect(within(other).getByText("5 / 25")).toBeInTheDocument();
        expect(within(other).queryByText(t("raids.list.cancelled"))).toBeNull();
    });

    it("keeps the raid in its list and works without a reason or author", () => {
        showUpcoming([upcoming({ id: "1", title: "Hyjal", cancelled: true })]);
        const row = rowOf("Hyjal");
        expect(within(row).getByText(t("raids.list.cancelledShort"))).toBeInTheDocument();
        const badge = within(row).getByText(t("raids.list.cancelled")).closest("[data-tip]") as HTMLElement;
        expect(badge.getAttribute("data-tip-sub")).toBe(t("raids.list.cancelledTipDefault"));
    });

    it("says in a raid group that the shared signup runs over a cancelled first raid", () => {
        showUpcoming([
            upcoming({ id: "1", title: "Zul'Aman", raidGroupId: "1", raidGroupIndex: 1, ...CANCELLED }),
            upcoming({ id: "3", title: "Zul'Aman 2", raidGroupId: "1", raidGroupIndex: 2 }),
        ]);
        const child = rowOf("Zul'Aman 2");
        expect(child).not.toHaveClass("is-cancelled");
        expect(child).toHaveTextContent(t("raids.list.groupSharedCancelled", { title: "Zul'Aman" }));
    });

    it("marks a further raid cancelled on its own", () => {
        showUpcoming([
            upcoming({ id: "1", title: "Zul'Aman", raidGroupId: "1", raidGroupIndex: 1 }),
            upcoming({ id: "3", title: "Zul'Aman 2", raidGroupId: "1", raidGroupIndex: 2, ...CANCELLED }),
        ]);
        expect(rowOf("Zul'Aman")).not.toHaveClass("is-cancelled");
        const child = rowOf("Zul'Aman 2");
        expect(child).toHaveClass("is-cancelled");
        expect(within(child).getByText(t("raids.list.cancelled"))).toBeInTheDocument();
        expect(within(child).getByText(t("raids.list.cancelledShort"))).toBeInTheDocument();
    });
});

describe("PastRaidList: cancelled raids", () => {
    it("marks a cancelled past raid and drops the log and loot nagging", () => {
        // the logs column and "Kein Loot" are the orga's: the orga's view
        renderPage(<PastRaidList events={[past({ id: "1", title: "Kara", ...CANCELLED }), past({ id: "2", title: "SSC", startTime: PAST_START + 60 })]} emptyMessage="leer" orga />);
        const row = rowOf("Kara");
        expect(row).toHaveClass("is-cancelled");
        expect(within(row).getByText(t("raids.list.cancelled"))).toBeInTheDocument();
        expect(within(row).queryByText(t("raids.list.noLogsBadge"))).toBeNull();
        expect(within(row).queryByText(t("raids.list.noLootBadge"))).toBeNull();
        // an ordinary raid without logs still gets them
        expect(within(rowOf("SSC")).getByText(t("raids.list.noLogsBadge"))).toBeInTheDocument();
    });
});
