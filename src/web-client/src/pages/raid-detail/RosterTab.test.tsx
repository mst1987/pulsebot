// The Raid-Detail roster (RosterTab): names and signup statuses as the raid
// lead sees them (#219; #435: formerly source scans in
// test/web-client/attendanceNames.test.js and signupStatus.test.js).
//   * a person reads as their character, the Discord name only in the tooltip
//     and the player dialog — never "DiscordName (Charname)",
//   * a status is a toned badge, and in the raid groups a small dot,
//   * both lists are sorted, and a person without a status counts as signed.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AttendancePerson, RaidDetailData, SetupPlayer } from "../../api";
import { t } from "../../i18n";
import { adminUser, renderPage } from "../../test/render";
import type { RaidCtx } from "./meta";
import RosterTab from "./RosterTab";

const person = (over: Partial<AttendancePerson>): AttendancePerson => ({ id: "0", displayName: "", profile: null, ...over });
const slot = (name: string): SetupPlayer => ({ name, specName: "Holy", className: "Priest", classColor: "#ffffff", iconUrl: "", role: "healer" });

function ctx(): RaidCtx {
    const data = {
        event: { id: "e1", title: "Karazhan", channelId: "c1", channelName: "kara", signupsKnown: true, isPast: false, status: "active" },
        attendanceRoleIds: ["r1"],
        membersError: null,
        setup: { total: 2, groups: [{ label: "Gruppe 1", players: [slot("Ahri"), slot("Zibbo")] }] },
        setupError: null,
        attendance: {
            responded: [
                person({ id: "u1", displayName: "ahri_dc", character: "Ahri", status: "tentative" }),
                person({ id: "u3", displayName: "carl", character: "Carlos", status: "late" }),
                person({ id: "u2", displayName: "bob" }),
            ],
            // deliberately unsorted
            missing: [person({ id: "u4", displayName: "zed" }), person({ id: "u5", displayName: "anna", character: "Anya" })],
        },
    } as unknown as RaidDetailData;
    // the raid lead's view: the attendance lists are the orga's (a raider's view at the end)
    return { data, eventId: "e1", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn(), orga: true, user: adminUser() };
}

/** The chip that shows `text`. */
const chip = (text: string) => screen.getByText(text).closest("button")!;

/** Opens "Reagiert, nicht im Setup" (the missing list is open from the start). */
async function openAside() {
    const closed = screen.getAllByRole("button", { expanded: false });
    await userEvent.setup().click(closed[closed.length - 1]);
}

describe("attendance names", () => {
    it("labels a person by their character name, never with the Discord name appended", () => {
        renderPage(<RosterTab ctx={ctx()} />);
        expect(chip("Anya")).toHaveAttribute("data-tip", "Anya");
        expect(screen.queryByText(/anna \(Anya\)|Anya \(anna\)/)).not.toBeInTheDocument();
        expect(within(chip("Anya")).queryByText(t("raidDetail.roster.noCharacter"))).not.toBeInTheDocument();
    });

    it("keeps the Discord name reachable in the tooltip and the player dialog", async () => {
        const c = ctx();
        renderPage(<RosterTab ctx={c} />);
        expect(chip("Anya").getAttribute("data-tip-sub")).toContain("@anna");
        await userEvent.setup().click(chip("Anya"));
        expect(c.openPlayer).toHaveBeenCalledWith(expect.objectContaining({ name: "Anya", discordName: "anna", status: "missing" }));
    });

    it("falls back to the Discord name when no character is assigned", async () => {
        const c = ctx();
        renderPage(<RosterTab ctx={c} />);
        const zed = chip("@zed");
        expect(zed).toHaveAttribute("data-tip", "zed");
        expect(within(zed).getByText("kein Charakter")).toBeInTheDocument();
        await userEvent.setup().click(zed);
        expect(c.openPlayer).toHaveBeenCalledWith(expect.objectContaining({ name: "zed", discordName: undefined }));
    });
});

describe("signup status display", () => {
    it("shows the status as a toned badge, and the missing count as a bad one", async () => {
        renderPage(<RosterTab ctx={ctx()} />);
        expect(screen.getByText(t("raidDetail.roster.noReactionCount", { count: 2 }))).toHaveClass("badge", "bad");
        await openAside();
        const late = within(chip("Carlos")).getByText("Kommt später");
        expect(late).toHaveClass("badge", "mid");
        expect(late.querySelector("svg, img")).toBeNull();
    });

    it("marks a maybe in the raid groups with a dot, a signed-up or unknown slot with none", () => {
        renderPage(<RosterTab ctx={ctx()} />);
        const ahri = chip("Ahri");
        expect(within(ahri).getByLabelText("Unsicher")).toHaveClass("rd-sig", "rd-sig-tentative");
        expect(ahri).toHaveAttribute("data-tip-sub", "Holy · Unsicher");
        expect(within(chip("Zibbo")).queryByLabelText(/./)).toBeNull();
    });

    it("sorts both lists by the name shown", async () => {
        const { container } = renderPage(<RosterTab ctx={ctx()} />);
        await openAside();
        const lists = [...container.querySelectorAll(".rd-chips")].map((list) => [...list.querySelectorAll("button")].map((b) => b.getAttribute("data-tip")));
        expect(lists).toEqual([["Anya", "zed"], ["bob", "Carlos"]]);
    });

    it("treats a person without a status as signed up, so nobody drops out", async () => {
        renderPage(<RosterTab ctx={ctx()} />);
        expect(screen.getByText("1 angemeldet")).toHaveClass("badge", "ok");
        expect(screen.getByText("1 unsicher")).toBeInTheDocument();
        await openAside();
        expect(chip("@bob").getAttribute("data-tip-sub")).toContain("Angemeldet");
    });
});

describe("the tab's one line instead of a card head", () => {
    it("repeats no tab name: the state left, the tab's actions right", () => {
        const { container } = renderPage(<RosterTab ctx={ctx()} />);
        expect(container.querySelector(".part-head")).toBeNull();
        expect(screen.queryByRole("heading")).not.toBeInTheDocument();
        // the ping of the missing ones is the line's action
        expect(container.querySelector(".rd-tabbar .rd-tabbar-act")).toHaveTextContent(t("raidDetail.roster.pingMissing"));
    });

    it("shows missing raider roles as a badge, and fixing it as its own link button", () => {
        const c = ctx();
        c.data = { ...c.data, attendanceRoleIds: [] };
        renderPage(<RosterTab ctx={c} />);
        const badge = screen.getByText(t("raidDetail.roster.noRoles"));
        expect(badge).toHaveClass("badge", "mid");
        expect(badge.closest("a, button")).toBeNull();
        const fix = screen.getByRole("link", { name: t("raidDetail.roster.setRoles") });
        expect(fix).toHaveAttribute("href", "/settings?section=kategorien");
        expect(fix).toHaveClass("btn");
    });

    // #658: a category with a roster expects its core + trial members, roles or not
    it("lists the missing ones for a roster without raider roles, and nothing when nobody is expected", () => {
        const c = ctx();
        c.data = { ...c.data, attendanceRoleIds: [], attendanceSource: "roster" };
        renderPage(<RosterTab ctx={c} />);
        expect(screen.queryByText(t("raidDetail.roster.noRoles"))).not.toBeInTheDocument();
        expect(screen.getByText(t("raidDetail.roster.noReactionCount", { count: 2 }))).toBeInTheDocument();
    });

    it("takes a null source as nobody expected, even with roles listed", () => {
        const c = ctx();
        c.data = { ...c.data, attendanceRoleIds: ["r1"], attendanceSource: null };
        renderPage(<RosterTab ctx={c} />);
        expect(screen.getByText(t("raidDetail.roster.noRoles"))).toBeInTheDocument();
    });
});

// Oct 2026: who has not reacted, who is not in the plan and the tab's actions are the orga's.
describe("the orga's part", () => {
    const zone = () => screen.queryByRole("region", { name: t("shell.orga.label") });

    it("sits in the orga zone for the orga: the ping, both lists and the roles hint", () => {
        renderPage(<RosterTab ctx={ctx()} />);
        expect(within(zone()!).getByRole("button", { name: new RegExp(t("raidDetail.roster.pingMissing")) })).toBeInTheDocument();
        expect(within(zone()!).getByText(t("raidDetail.roster.noReaction"))).toBeInTheDocument();
        expect(within(zone()!).getByText(t("raidDetail.roster.notInSetup"))).toBeInTheDocument();
        // the lineup itself is for everybody: outside the zone
        expect(within(zone()!).queryByText("Zibbo")).not.toBeInTheDocument();
    });

    it("is left out for a raider - even if the payload still carried the lists - and names open nothing", () => {
        const c = { ...ctx(), orga: false, openPlayer: undefined, user: undefined };
        renderPage(<RosterTab ctx={c} />);
        expect(zone()).not.toBeInTheDocument();
        expect(screen.queryByText(t("raidDetail.roster.noReaction"))).not.toBeInTheDocument();
        expect(screen.queryByText(t("raidDetail.roster.notInSetup"))).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: new RegExp(t("raidDetail.roster.pingMissing")) })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: t("raidDetail.roster.setRoles") })).not.toBeInTheDocument();
        expect(screen.queryByText(t("raidDetail.roster.noReactionCount", { count: 2 }))).not.toBeInTheDocument();
        // the lineup stays, as plain rows
        const row = screen.getByText("Zibbo").closest(".rd-pl")!;
        expect(row.tagName).toBe("DIV");
        expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("shows a raider no roles hint either", () => {
        const c = { ...ctx(), orga: false, openPlayer: undefined };
        c.data = { ...c.data, attendanceRoleIds: [], attendanceSource: null };
        renderPage(<RosterTab ctx={c} />);
        expect(screen.queryByText(t("raidDetail.roster.noRoles"))).not.toBeInTheDocument();
    });
});
