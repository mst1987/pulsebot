// What only the orga sees (design canvas Oct 2026): the chip in the top bar of an orga page, the zone
// around the orga's part of a page — each naming who sees it after all. The menu shows no mark
// (design C): a dot on every orga entry reported nothing new.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { SessionUser } from "../../../../api";
import { t } from "../../../../i18n";
import { OrgaChip, OrgaZone } from "../OrgaZone";
import { pageAudience } from "../../../../lib/app/orgaArea";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    setViewAs: vi.fn(),
}));
vi.mock("../../../shell/Jobs", () => ({ useToast: () => vi.fn() }));

const audience = {
    signup: { everyone: true, roles: [], writers: [], accounts: 0 },
    raids: { everyone: false, roles: ["Mo Raider", "Raidleitung"], writers: ["Raidleitung"], accounts: 0 },
};
const lead: SessionUser = { id: "1", name: "Lead", isAdmin: false, access: {}, audience };
const admin: SessionUser = { id: "2", name: "Anna", isAdmin: true, access: {}, audience, canViewAs: true };

beforeEach(() => vi.mocked(api.setViewAs).mockReset());

describe("OrgaChip", () => {
    it("says on an orga page that raiders do not see it, and who does — a raider role that may read shows up", () => {
        render(<OrgaChip user={lead} audience={pageAudience(lead, { areas: ["raids"] })} />);
        const bar = screen.getByRole("note");
        expect(bar).toHaveTextContent(t("shell.orga.label"));
        // the explanation is the tooltip and the accessible name
        const who = t("shell.orga.visibleFor", { who: "Admins · @Mo Raider · @Raidleitung" });
        expect(bar).toHaveAccessibleName(expect.stringContaining(who));
        expect(bar).toHaveAccessibleName(expect.stringContaining(t("shell.orga.pageHidden")));
        const lbl = bar.querySelector(".orga-chip-lbl")!;
        expect(lbl).toHaveAttribute("data-tip", t("shell.orga.pageHidden"));
        expect(lbl).toHaveAttribute("data-tip-sub", who);
        // only a full admin may look at it as a raider
        expect(screen.queryByRole("button", { name: t("shell.orga.asRaider") })).not.toBeInTheDocument();
    });

    it("shows nothing on a page every raider may open, or without the server's audience", () => {
        const { container } = render(<OrgaChip user={lead} audience={pageAudience(lead, { areas: ["signup"] })} />);
        expect(container).toBeEmptyDOMElement();
        const second = render(<OrgaChip user={{ ...lead, audience: undefined }} audience={pageAudience({ ...lead, audience: undefined }, { areas: ["raids"] })} />);
        expect(second.container).toBeEmptyDOMElement();
    });

    it("lets a full admin look at the page as a raider: the menu with the base access only", async () => {
        vi.mocked(api.setViewAs).mockResolvedValue({ viewAs: { roleIds: [] } });
        const assign = vi.fn();
        vi.stubGlobal("location", { ...window.location, assign });
        render(<OrgaChip user={admin} audience={pageAudience(admin, { areas: ["raids"] })} />);
        await userEvent.click(screen.getByRole("button", { name: t("shell.orga.asRaider") }));
        expect(api.setViewAs).toHaveBeenCalledWith({ roleIds: [] });
        expect(assign).toHaveBeenCalledWith("/");
        vi.unstubAllGlobals();
        // already looking as a role: no second way in
        render(<OrgaChip user={{ ...admin, viewAs: { roleIds: [], roleNames: [], at: 1 } }} audience={pageAudience(admin, { areas: ["raids"] })} />);
        expect(screen.getAllByRole("note")).toHaveLength(2);
        expect(screen.getAllByRole("button", { name: t("shell.orga.asRaider") })).toHaveLength(1);
    });
    it("marks a page only full admins open (Systemstatus) as seen by the admins alone", () => {
        render(<OrgaChip user={admin} audience={pageAudience(admin, { areas: [], adminOnly: true })} />);
        expect(screen.getByRole("note")).toHaveAccessibleName(expect.stringContaining(t("shell.orga.visibleFor", { who: t("shell.orga.admins") })));
    });
});

describe("OrgaZone", () => {
    it("frames the orga's part of a page and names the orga: admins and the orga roles", () => {
        render(<OrgaZone user={{ ...lead, isOrga: true, orgaRoles: ["Gildenleitung", "Raidleitung"] }}><p>Inhalt</p></OrgaZone>);
        const zone = screen.getByRole("region", { name: t("shell.orga.label") });
        expect(zone).toHaveTextContent("Inhalt");
        expect(zone).toHaveTextContent(t("shell.orga.zoneHidden"));
        expect(zone).toHaveTextContent(t("shell.orga.visibleFor", { who: "Admins · @Gildenleitung · @Raidleitung" }));
        // a raider role never: it is no orga, whatever it may read
        expect(zone).not.toHaveTextContent("Mo Raider");
    });

    it("names the admins alone while no orga role is set", () => {
        render(<OrgaZone user={{ ...lead, isOrga: true, orgaRoles: undefined }}><p>Inhalt</p></OrgaZone>);
        expect(screen.getByRole("region", { name: t("shell.orga.label") })).toHaveTextContent(t("shell.orga.visibleFor", { who: t("shell.orga.admins") }));
    });

    // #729: who sees it without being the global orga is the orga of a category (a roster's manager)
    it("tells the orga of a category that it is theirs, not the admins'", () => {
        const manager = { ...lead, orgaCategories: ["c1"], orgaRoles: ["Raidleitung"] };
        render(<OrgaZone user={manager}><p>Inhalt</p></OrgaZone>);
        const zone = screen.getByRole("region", { name: t("shell.orga.label") });
        expect(zone).toHaveTextContent(t("shell.orga.visibleForCategory"));
        expect(zone).not.toHaveTextContent(t("shell.orga.admins"));
        render(<OrgaZone user={manager} categories><p>Block</p></OrgaZone>);
        expect(screen.getByText(new RegExp(t("shell.orga.visibleForCategories")))).toBeInTheDocument();
    });
});
