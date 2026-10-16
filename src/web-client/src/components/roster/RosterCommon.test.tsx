// The pieces roster and character page share (design issue #218): the
// attendance bar with its tone and tooltip, and the icon link.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { switchLang } from "../../test/i18n";
import type { RosterAttendance } from "../../api";
import { AttendanceBar, GearStateBadge, IconLink, RoleBadge } from "./RosterCommon";

const SECONDS = Math.floor(Date.UTC(2026, 5, 15, 20, 0, 0) / 1000); // Mo 15.06.2026, as the API sends it
const WEEK = 7 * 86400;

function bar(pct: number) {
    const { container } = render(
        <AttendanceBar attendance={{ attended: pct, total: 100, pct, missed: [] }} categoryName="Montagsraid" />,
    );
    return container.querySelector(".ros-bar") as HTMLElement;
}

/** Renders the bar and opens its tooltip the way a keyboard user does (focus on the anchor). */
function openTip(attendance: RosterAttendance, categoryName = "Montagsraid") {
    const { container } = render(<AttendanceBar attendance={attendance} categoryName={categoryName} />);
    const anchor = container.querySelector(".rtip-anchor") as HTMLElement;
    fireEvent.focus(anchor);
    return { anchor, tip: screen.getByRole("tooltip") };
}

describe("AttendanceBar", () => {
    it.each([
        [100, "ok"], [80, "ok"], [79, "mid"], [60, "mid"], [59, "bad"], [0, "bad"],
    ])("tones %i %% as %s", (pct, tone) => {
        expect(bar(pct)).toHaveClass(tone);
    });

    it("names attended of total on the anchor and says when no counted raid was missed", () => {
        const { anchor, tip } = openTip({ attended: 80, total: 100, pct: 80, missed: [] });
        expect(anchor).toHaveAccessibleName("80 von 100 Raids · 80 %");
        expect(anchor).toHaveTextContent("80 %80/100");
        expect(tip).toHaveTextContent("80 von 100 Raids");
        expect(tip).toHaveTextContent("Keinen gezählten Raid verpasst.");
        expect(tip).toHaveTextContent("Montagsraid · aus Anmeldungen und Logs");
    });

    it("groups the nights by status (#677): Dabei, Bench, Nicht angemeldet, Abgemeldet, Urlaub, Nicht erschienen — each with its count and newest first", () => {
        const { tip } = openTip({
            attended: 3, total: 8, pct: 38,
            present: [
                { eventId: "p1", title: "Kara", startTime: SECONDS - WEEK, status: "present" },
                { eventId: "p2", title: "Kara", startTime: SECONDS, status: "present" },
                { eventId: "b1", title: "Kara", startTime: SECONDS - 6 * WEEK, status: "bench" },
            ],
            missed: [
                { eventId: "m1", title: "Kara", startTime: SECONDS - 3 * WEEK, reason: "abgemeldet", status: "absence" },
                { eventId: "m2", title: "Kara", startTime: SECONDS - 2 * WEEK, reason: "nicht im Log", status: "noShow" },
                { eventId: "m3", title: "Kara", startTime: SECONDS - 4 * WEEK, reason: "nicht im Log", status: "noShow" },
                { eventId: "m4", title: "Kara", startTime: SECONDS - 5 * WEEK, reason: "Urlaub", status: "vacation" },
                { eventId: "m5", title: "Kara", startTime: SECONDS - 7 * WEEK, reason: "keine Anmeldung", status: "noSignup" },
            ],
        });
        const groups = Array.from(tip.querySelectorAll(".ros-atip-grp"));
        const label = (g: Element) => g.querySelector(".ros-atip-lbl")!.childNodes[1].textContent;
        expect(groups.map(label)).toEqual(["Dabei", "Bench", "Nicht angemeldet", "Abgemeldet", "Urlaub", "Nicht erschienen"]);
        expect(groups.map((g) => g.getAttribute("data-att"))).toEqual(["present", "bench", "noSignup", "absence", "vacation", "noShow"]);
        expect(groups[0]).toHaveClass("ros-atip-present");
        expect(groups[1]).toHaveClass("ros-atip-present");
        expect(groups[0].querySelector("small")).toHaveTextContent("2 Raids");
        expect(Array.from(groups[0].querySelectorAll(".ros-atip-day")).map((d) => d.textContent)).toEqual(["Mo 15.06.", "Mo 08.06."]);
        expect(groups[5]).toHaveClass("ros-atip-absent");
        expect(Array.from(groups[5].querySelectorAll(".ros-atip-day")).map((d) => d.textContent)).toEqual(["Mo 01.06.", "Mo 18.05."]);
        expect(groups[3].querySelector("small")).toHaveTextContent("1 Raid");
        expect(tip).not.toHaveTextContent("Keinen gezählten Raid verpasst.");
    });

    it("shows a \"maybe\" the setup left out as its own neutral group, never as a missed raid", () => {
        const { tip } = openTip({
            attended: 1, total: 1, pct: 100,
            present: [{ eventId: "p1", title: "Kara", startTime: SECONDS, status: "present" }],
            missed: [{ eventId: "t1", title: "Kara", startTime: SECONDS - WEEK, reason: "vorläufig, nicht aufgestellt (zählt nicht)", status: "tentative" }],
        });
        const groups = Array.from(tip.querySelectorAll(".ros-atip-grp"));
        expect(groups.map((g) => g.getAttribute("data-att"))).toEqual(["present", "tentative"]);
        expect(groups[1]).toHaveClass("ros-atip-neutral");
        // nothing that counts was missed
        expect(tip).toHaveTextContent("Keinen gezählten Raid verpasst.");
    });

    it("marks a night set by hand and names who set it, when and why", () => {
        const at = Date.UTC(2026, 9, 9, 12);
        const { tip } = openTip({
            attended: 1, total: 1, pct: 100, missed: [],
            present: [{ eventId: "o", title: "Kara", startTime: SECONDS, status: "bench", override: { status: "bench", reason: "hat gewartet", by: "1", byName: "Marc", at } }],
        });
        expect(tip.querySelector(".ros-atip-day.is-manual")).toHaveTextContent("Mo 15.06.");
        expect(tip.querySelector(".ros-atip-manual")).toHaveTextContent("von Hand: Bench (Marc, 09.10.) · hat gewartet");
    });

    it("takes the attended nights from the character page's night list when there is no present list", () => {
        const { tip } = openTip({
            attended: 1, total: 2, pct: 50,
            missed: [{ eventId: "e1", title: "Kara", startTime: SECONDS, reason: "nicht im Log", status: "noShow" }],
            raids: [
                { eventId: "e1", title: "Kara", startTime: SECONDS, attended: false, reason: "nicht im Log", status: "noShow" },
                { eventId: "e0", title: "Kara", startTime: SECONDS - WEEK, attended: true, reason: "im Log", status: "present" },
            ],
        });
        expect(tip.querySelector(".ros-atip-present")).toHaveTextContent("Mo 08.06.");
        // dated from the API's unix seconds, not as January 1970
        expect(tip.querySelector(".ros-atip-absent")).toHaveTextContent("Mo 15.06.");
        expect(tip).not.toHaveTextContent(".01.");
    });

    it("closes again when the anchor loses the focus", () => {
        const { anchor } = openTip({ attended: 1, total: 1, pct: 100, missed: [] });
        fireEvent.blur(anchor);
        expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows a dash when no night was counted", () => {
        const { container } = render(<AttendanceBar attendance={undefined} categoryName="Pug" />);
        const el = container.querySelector("[data-tip]") as HTMLElement;
        expect(el).toHaveAttribute("data-tip", "Keine Raids gezählt");
        expect(el).toHaveTextContent("–");
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("words the attendance bar, the role and the gear badge in English", async () => {
        await switchLang("en");
        const { anchor, tip } = openTip({
            attended: 1, total: 3, pct: 33,
            missed: [
                { eventId: "e1", title: "Kara", startTime: SECONDS, reason: "nicht im Log", status: "noShow" },
                { eventId: "e2", title: "Kara", startTime: SECONDS - WEEK, reason: "Urlaub", status: "vacation" },
            ],
            present: [{ eventId: "e3", title: "Kara", startTime: SECONDS - 2 * WEEK, status: "bench" }],
        });
        expect(anchor).toHaveAccessibleName("1 of 3 raids · 33 %");
        // the server's status codes are worded in the menu language
        expect(tip).toHaveTextContent("No-show");
        expect(tip).toHaveTextContent("Vacation");
        expect(tip).toHaveTextContent("Bench");
        expect(tip).toHaveTextContent("Mon 15/06");
        expect(tip).toHaveTextContent("Montagsraid · from signups and logs");
        render(<RoleBadge role="healer" />);
        expect(screen.getByText("Healer")).toBeInTheDocument();
        render(<GearStateBadge gear={null} />);
        expect(screen.getByText("not evaluated")).toBeInTheDocument();
    });
});

describe("IconLink", () => {
    it("is an icon link named and explained by its tip, and nothing without a url", () => {
        const { rerender } = render(<IconLink href="https://wcl.example" icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" />);
        const link = screen.getByRole("link", { name: "Warcraft Logs" });
        expect(link).toHaveAttribute("data-tip", "Warcraft Logs");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link).not.toHaveAttribute("title");
        rerender(<IconLink href="" icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" />);
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
});
