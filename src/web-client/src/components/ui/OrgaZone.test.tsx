// What only the orga sees (design canvas Oct 2026): the bar over an orga page, the zone
// around the orga's part of a page, the menu dot — each naming who sees it after all.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { SessionUser } from "../../api";
import { t } from "../../i18n";
import { OrgaBar, OrgaDot, OrgaZone } from "./OrgaZone";
import { pageAudience } from "../../lib/app/orgaArea";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    setViewAs: vi.fn(),
}));
vi.mock("../shell/Jobs", () => ({ useToast: () => vi.fn() }));

const audience = {
    signup: { everyone: true, roles: [], writers: [], accounts: 0 },
    raids: { everyone: false, roles: ["Mo Raider", "Raidleitung"], writers: ["Raidleitung"], accounts: 0 },
};
const lead: SessionUser = { id: "1", name: "Lead", isAdmin: false, access: {}, audience };
const admin: SessionUser = { id: "2", name: "Anna", isAdmin: true, access: {}, audience, canViewAs: true };

beforeEach(() => vi.mocked(api.setViewAs).mockReset());

describe("OrgaBar", () => {
    it("says on an orga page that raiders do not see it, and who does — a raider role that may read shows up", () => {
        render(<OrgaBar user={lead} audience={pageAudience(lead, { areas: ["raids"] })} />);
        const bar = screen.getByRole("note");
        expect(bar).toHaveTextContent(t("shell.orga.label"));
        expect(bar).toHaveTextContent(t("shell.orga.pageHidden"));
        expect(bar).toHaveTextContent(t("shell.orga.visibleFor", { who: "Admins · @Mo Raider · @Raidleitung" }));
        // only a full admin may look at it as a raider
        expect(screen.queryByRole("button", { name: t("shell.orga.asRaider") })).not.toBeInTheDocument();
    });

    it("shows nothing on a page every raider may open, or without the server's audience", () => {
        const { container } = render(<OrgaBar user={lead} audience={pageAudience(lead, { areas: ["signup"] })} />);
        expect(container).toBeEmptyDOMElement();
        const second = render(<OrgaBar user={{ ...lead, audience: undefined }} audience={pageAudience({ ...lead, audience: undefined }, { areas: ["raids"] })} />);
        expect(second.container).toBeEmptyDOMElement();
    });

    it("lets a full admin look at the page as a raider: the menu with the base access only", async () => {
        vi.mocked(api.setViewAs).mockResolvedValue({ viewAs: { roleIds: [] } });
        const assign = vi.fn();
        vi.stubGlobal("location", { ...window.location, assign });
        render(<OrgaBar user={admin} audience={pageAudience(admin, { areas: ["raids"] })} />);
        await userEvent.click(screen.getByRole("button", { name: t("shell.orga.asRaider") }));
        expect(api.setViewAs).toHaveBeenCalledWith({ roleIds: [] });
        expect(assign).toHaveBeenCalledWith("/");
        vi.unstubAllGlobals();
        // already looking as a role: no second way in
        render(<OrgaBar user={{ ...admin, viewAs: { roleIds: [], roleNames: [], at: 1 } }} audience={pageAudience(admin, { areas: ["raids"] })} />);
        expect(screen.getAllByRole("note")).toHaveLength(2);
        expect(screen.getAllByRole("button", { name: t("shell.orga.asRaider") })).toHaveLength(1);
    });
    it("marks a page only full admins open (Systemstatus) as seen by the admins alone", () => {
        render(<OrgaBar user={admin} audience={pageAudience(admin, { areas: [], adminOnly: true })} />);
        expect(screen.getByRole("note")).toHaveTextContent(t("shell.orga.visibleFor", { who: t("shell.orga.admins") }));
    });
});

describe("OrgaZone", () => {
    it("frames the orga's part of a page and names its readers, or its writers for a part that goes by the right to change", () => {
        const { rerender } = render(<OrgaZone user={lead} areas={["raids"]}><p>Inhalt</p></OrgaZone>);
        const zone = screen.getByRole("region", { name: t("shell.orga.label") });
        expect(zone).toHaveTextContent("Inhalt");
        expect(zone).toHaveTextContent(t("shell.orga.zoneHidden"));
        expect(zone).toHaveTextContent("@Mo Raider");
        rerender(<OrgaZone user={lead} areas={["raids"]} level="write"><p>Inhalt</p></OrgaZone>);
        expect(screen.getByRole("region", { name: t("shell.orga.label") })).not.toHaveTextContent("Mo Raider");
    });

    it("still frames the part without the server's audience, just without names", () => {
        render(<OrgaZone user={{ ...lead, audience: undefined }} areas={["raids"]}><p>Inhalt</p></OrgaZone>);
        const zone = screen.getByRole("region", { name: t("shell.orga.label") });
        expect(zone).toHaveTextContent(t("shell.orga.zoneHidden"));
        expect(zone).not.toHaveTextContent(t("shell.orga.admins"));
    });
});

describe("OrgaDot", () => {
    it("is a small mark with its meaning for screen readers and in its tooltip", () => {
        render(<OrgaDot />);
        expect(screen.getByRole("img", { name: t("shell.orga.label") })).toHaveAttribute("data-tip", t("shell.orga.label"));
    });
});
