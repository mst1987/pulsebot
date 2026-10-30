// Notes in the raid detail's roster (#981): the mark right after the character
// in the role columns (the row is a button: symbol and tooltip only, no link),
// and nothing without the field - a raider's answer never carries it.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttendancePerson, EventSignupEntry, RaidDetailData } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import type { RaidCtx } from "../meta";
import RosterTab from "../RosterTab";

function entry(over: Partial<EventSignupEntry>): EventSignupEntry {
    return {
        userId: "u0", name: "", at: 0, characters: [], status: "signed", character: "", className: "Priest", classColor: "#ffffff",
        spec: "", specLabel: "", specIcon: "", role: "", canAlso: [], comment: "", ...over,
    };
}

const SIGNUPS: EventSignupEntry[] = [
    entry({ userId: "u1", name: "zibbo_dc", character: "Zibbo", role: "healer", specLabel: "Holy" }),
    entry({ userId: "u2", name: "war_dc", character: "Zibbowar", role: "tank", specLabel: "Protection" }),
];

function show(vermerke?: RaidDetailData["vermerke"], missing: AttendancePerson[] = [], orga = false) {
    const data = {
        event: { id: "eh-kara", title: "Karazhan", channelId: "c1", channelName: "kara", signupsKnown: true, isPast: false, status: "active" },
        categoryName: "T4",
        attendanceRoleIds: ["r1"],
        membersError: null,
        setup: null,
        setupError: null,
        attendance: { responded: [], missing },
        ownSignups: SIGNUPS,
        roleTargets: null,
        vermerke,
    } as unknown as RaidDetailData;
    const ctx: RaidCtx = { data, eventId: "eh-kara", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn(), orga };
    renderPage(<RosterTab ctx={ctx} />);
}

describe("Raid detail roster with notes (#981)", () => {
    it("puts the mark after the character, a plain symbol inside the row's button", () => {
        show({ u2: { level: "shadowban", reasons: { behavior: 1 } } });
        const mark = screen.getByRole("img", { name: t("vermerke.mark.aria", { summary: "Shadowban · Verhalten" }) });
        expect(mark.closest("button")).toHaveTextContent("Zibbowar");
        expect(mark.closest("a")).toBeNull();
        expect(document.querySelectorAll(".vm-mark")).toHaveLength(1);
    });

    it("draws no mark without the field", () => {
        show();
        expect(screen.getByText("Zibbo")).toBeInTheDocument();
        expect(document.querySelector(".vm-mark")).toBeNull();
    });

    it("marks a person chip in \"no reaction\" too, a plain symbol inside the chip button", () => {
        const silent: AttendancePerson = { id: "u9", displayName: "quiet_dc", character: "Quietus", profile: null };
        show({ u9: { level: "warning", reasons: { late_signoff: 2 } } }, [silent], true);
        const chip = screen.getByRole("button", { name: /Quietus/ });
        expect(chip).toHaveClass("rd-chip");
        const mark = chip.querySelector(".vm-mark");
        expect(mark).not.toBeNull();
        expect(mark?.closest("a")).toBeNull();
        expect(chip.querySelector("a")).toBeNull();
    });
});
