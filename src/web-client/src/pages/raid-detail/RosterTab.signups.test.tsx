// The Raid-Detail roster of an own event (#256/#306): the signups in role
// columns, "kann auch" and the comment only in the tooltip, and one badge that
// says how many wait on the bench. (#435: formerly source scans in
// test/web-client/signupsPage.test.js.)
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EventSignupEntry, RaidDetailData } from "../../api";
import { t } from "../../i18n";
import { CAN_ALSO } from "../../lib/signups";
import { renderPage } from "../../test/render";
import { ROLE_META, type RaidCtx } from "./meta";
import RosterTab from "./RosterTab";

function entry(over: Partial<EventSignupEntry>): EventSignupEntry {
    return {
        userId: "u0", name: "", at: 0, characters: [], status: "signed", character: "", className: "Priest", classColor: "#ffffff",
        spec: "", specLabel: "", specIcon: "", role: "", canAlso: [], comment: "", ...over,
    };
}

const SIGNUPS: EventSignupEntry[] = [
    entry({ userId: "u1", name: "zibbo_dc", character: "Zibbo", role: "healer", specLabel: "Holy", canAlso: ["ranged"], comment: "komme direkt von der Arbeit" }),
    entry({ userId: "u2", name: "war_dc", character: "Zibbowar", role: "tank", specLabel: "Protection", status: "tentative" }),
    entry({ userId: "u3", name: "alt_dc", character: "Alt", role: "ranged", specLabel: "Frost", status: "bench" }),
    entry({ userId: "u4", name: "zap_dc", character: "Zap", role: "ranged", specLabel: "Arcane", status: "bench" }),
    entry({ userId: "u5", name: "gone_dc", character: "Gone", role: "melee", status: "absence", comment: "Urlaub" }),
];

function show(ownSignups: EventSignupEntry[] = SIGNUPS) {
    const data = {
        event: { id: "eh-kara", title: "Karazhan", channelId: "c1", channelName: "kara", signupsKnown: true, isPast: false, status: "active" },
        categoryName: "T4",
        attendanceRoleIds: ["r1"],
        membersError: null,
        setup: null,
        setupError: null,
        attendance: { responded: [], missing: [] },
        ownSignups,
    } as unknown as RaidDetailData;
    const openPlayer = vi.fn();
    const ctx: RaidCtx = { data, eventId: "eh-kara", onChanged: vi.fn(), openModal: vi.fn(), openPlayer };
    renderPage(<RosterTab ctx={ctx} />);
    return { openPlayer };
}

/** The role column headed `label`. */
function column(label: string): HTMLElement {
    return screen.getByText(label, { selector: ".kicker" }).closest<HTMLElement>(".rd-group")!;
}

describe("Raid detail roster of an own event", () => {
    it("lists the signups in role columns, the sign-offs left out", () => {
        show();
        expect(within(column(ROLE_META.healer.label)).getByText("Zibbo")).toBeInTheDocument();
        expect(within(column(ROLE_META.tank.label)).getByText("Zibbowar")).toBeInTheDocument();
        expect(within(column(ROLE_META.ranged.label)).getByText("Alt")).toBeInTheDocument();
        expect(within(column(ROLE_META.melee.label)).queryByText("Gone")).not.toBeInTheDocument();
    });

    it("keeps \"kann auch\" and the comment in the tooltip, not in the row", async () => {
        const { openPlayer } = show();
        const zibbo = screen.getByRole("button", { name: /Zibbo\b(?!war)/ });
        expect(zibbo).toHaveAttribute("data-tip", "Zibbo");
        const sub = zibbo.getAttribute("data-tip-sub");
        expect(sub).toContain(t("raidDetail.roster.canAlso", { roles: CAN_ALSO.ranged.label }));
        expect(sub).toContain(t("common.quoted", { text: "komme direkt von der Arbeit" }));
        expect(sub).toContain("@zibbo_dc");
        expect(zibbo).not.toHaveTextContent("komme direkt von der Arbeit");
        // two small marks say there is more to read
        expect(within(zibbo).getByLabelText(t("raidDetail.roster.canAlso", { roles: CAN_ALSO.ranged.label }))).toHaveTextContent("+1");
        expect(within(zibbo).getByLabelText(t("raidDetail.roster.comment"))).toBeInTheDocument();

        await userEvent.setup().click(zibbo);
        expect(openPlayer).toHaveBeenCalledWith(expect.objectContaining({ name: "Zibbo", discordName: "zibbo_dc", status: "signed", role: "healer" }));
    });

    it("says how many wait on the bench, with the names in the tooltip (#306)", () => {
        show();
        const badge = screen.getByText(t("raidDetail.roster.benchCount", { count: 2 }));
        expect(badge.closest("[data-tip]")).toHaveAttribute("data-tip-sub", t("raidDetail.roster.benchSub", { names: "Alt, Zap" }));
        // the sign-offs are one badge, their comment in its tooltip
        const absent = screen.getByText(t("raidDetail.roster.absentCount", { count: 1 }));
        expect(absent.closest("[data-tip]")).toHaveAttribute("data-tip-sub", `Gone ${t("common.quoted", { text: "Urlaub" })}`);
    });

    it("shows no bench badge while nobody waits", () => {
        show(SIGNUPS.filter((s) => s.status !== "bench"));
        expect(screen.queryByText(t("raidDetail.roster.benchCount", { count: 0 }))).not.toBeInTheDocument();
        expect(screen.queryByText(t("raidDetail.roster.benchCount", { count: 2 }))).not.toBeInTheDocument();
    });

    it("says so when nobody has signed up yet", () => {
        show([]);
        expect(screen.getByText(t("raidDetail.roster.ownEmpty"))).toBeInTheDocument();
    });
});
