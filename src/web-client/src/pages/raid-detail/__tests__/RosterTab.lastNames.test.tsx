// WoW Forever characters are "first name last name": on the roster a long one reads
// "Konstantinos M." and the tooltip keeps it whole, with the Discord name beside it.
// Every other version (no `lastNames` from the server) shows the name as it is.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttendancePerson, EventSignupEntry, RaidDetailData, SetupPlayer } from "../../../api";
import { adminUser, renderPage } from "../../../test/render";
import type { RaidCtx } from "../meta";
import RosterTab from "../RosterTab";

const LONG = "Konstantinos Morgenstern";
const SHORT = "Konstantinos M.";
const FITS = "Aldric Sturmwind";

const person = (over: Partial<AttendancePerson>): AttendancePerson => ({ id: "0", displayName: "", profile: null, ...over });
const slot = (name: string): SetupPlayer => ({ name, specName: "Holy", className: "Priest", classColor: "#ffffff", iconUrl: "", role: "healer" });
const entry = (over: Partial<EventSignupEntry>): EventSignupEntry => ({
    userId: "u0", name: "", at: 0, characters: [], status: "signed", character: "", className: "Priest", classColor: "#ffffff",
    spec: "", specLabel: "", specIcon: "", role: "healer", canAlso: [], comment: "", ...over,
});

function ctx(over: Partial<RaidDetailData>): RaidCtx {
    const data = {
        event: { id: "eh-kara", title: "Karazhan", channelId: "c1", channelName: "kara", signupsKnown: true, isPast: false, status: "active" },
        categoryName: "T4",
        attendanceRoleIds: ["r1"],
        membersError: null,
        setup: null,
        setupError: null,
        attendance: { responded: [], missing: [] },
        roleTargets: null,
        ...over,
    } as unknown as RaidDetailData;
    return { data, eventId: "eh-kara", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn(), orga: true, user: adminUser() };
}

const tipped = (text: string) => screen.getByText(text).closest("[data-tip]")!;

describe("the signup list", () => {
    const ownSignups = [entry({ userId: "u1", name: "marc", character: LONG }), entry({ userId: "u2", name: "aldi", character: FITS })];

    it("Forever: shortens a long name, the tooltip keeps it whole with the Discord name", () => {
        renderPage(<RosterTab ctx={ctx({ ownSignups, lastNames: true })} />);
        expect(screen.queryByText(LONG)).not.toBeInTheDocument();
        expect(tipped(SHORT)).toHaveAttribute("data-tip", LONG);
        expect(tipped(SHORT).getAttribute("data-tip-sub")).toContain("marc");
    });

    it("Forever: a name of exactly 16 characters stays whole", () => {
        renderPage(<RosterTab ctx={ctx({ ownSignups, lastNames: true })} />);
        expect(screen.getByText(FITS)).toBeInTheDocument();
    });

    it("another version: the same name stays as it is", () => {
        renderPage(<RosterTab ctx={ctx({ ownSignups })} />);
        expect(screen.getByText(LONG)).toBeInTheDocument();
        expect(screen.queryByText(SHORT)).not.toBeInTheDocument();
    });

    it("without a character it stays the Discord name, whatever its length", () => {
        const name = "ein sehr langer discord name";
        renderPage(<RosterTab ctx={ctx({ ownSignups: [entry({ userId: "u3", name })], lastNames: true })} />);
        expect(screen.getByText(name)).toBeInTheDocument();
    });
});

describe("the raid groups of a setup", () => {
    const setup = { total: 1, groups: [{ label: "Gruppe 1", players: [slot(LONG)] }] } as unknown as RaidDetailData["setup"];

    it("Forever: shortens the name, the tooltip keeps it whole", () => {
        renderPage(<RosterTab ctx={ctx({ setup, lastNames: true })} />);
        expect(tipped(SHORT)).toHaveAttribute("data-tip", LONG);
    });

    it("another version: the whole name", () => {
        renderPage(<RosterTab ctx={ctx({ setup })} />);
        expect(screen.getByText(LONG)).toBeInTheDocument();
    });
});

describe("the chip of somebody who has not reacted", () => {
    const attendance = { responded: [], missing: [person({ id: "u4", displayName: "marc", character: LONG })] } as unknown as RaidDetailData["attendance"];

    it("Forever: shortens the name, the tooltip keeps it and the Discord name", () => {
        renderPage(<RosterTab ctx={ctx({ attendance, lastNames: true })} />);
        const chip = screen.getByText(SHORT).closest("button")!;
        expect(chip).toHaveAttribute("data-tip", LONG);
        expect(chip.getAttribute("data-tip-sub")).toContain("@marc");
    });

    it("another version: the whole name", () => {
        renderPage(<RosterTab ctx={ctx({ attendance })} />);
        expect(screen.getByText(LONG).closest("button")).toHaveAttribute("data-tip", LONG);
    });
});
