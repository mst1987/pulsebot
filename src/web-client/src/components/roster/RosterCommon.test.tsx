// The pieces roster and character page share (design issue #218): the
// attendance bar with its tone and tooltip, and the icon link.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendanceBar, IconLink } from "./RosterCommon";

const SECONDS = Math.floor(Date.UTC(2026, 5, 15, 20, 0, 0) / 1000); // Mo 15.06.2026, as the API sends it

function bar(pct: number) {
    const { container } = render(
        <AttendanceBar attendance={{ attended: pct, total: 100, pct, missed: [] }} categoryName="Montagsraid" />,
    );
    return container.querySelector("[data-tip]") as HTMLElement;
}

describe("AttendanceBar", () => {
    it.each([
        [100, "ok"], [80, "ok"], [79, "mid"], [60, "mid"], [59, "bad"], [0, "bad"],
    ])("tones %i %% as %s", (pct, tone) => {
        expect(bar(pct)).toHaveClass(tone);
    });

    it("says attended of total in its tooltip", () => {
        const el = bar(80);
        expect(el).toHaveAttribute("data-tip", "80 von 100 Raids · 80 %");
        expect(el).toHaveTextContent("80 %80/100");
        expect(el.getAttribute("data-tip-sub")).toContain("Keinen gezählten Raid verpasst.");
    });

    it("dates a missed night from the API's unix seconds, not as January 1970", () => {
        const { container } = render(
            <AttendanceBar
                attendance={{ attended: 1, total: 2, pct: 50, missed: [{ eventId: "e1", title: "Kara", startTime: SECONDS, reason: "nicht im Log" }] }}
                categoryName="Montagsraid"
            />,
        );
        const sub = container.querySelector("[data-tip]")?.getAttribute("data-tip-sub") || "";
        expect(sub).toContain("Gefehlt: Mo 15.06. (nicht im Log).");
        expect(sub).not.toContain(".01.");
    });

    it("shows a dash when no night was counted", () => {
        const { container } = render(<AttendanceBar attendance={undefined} categoryName="Pug" />);
        const el = container.querySelector("[data-tip]") as HTMLElement;
        expect(el).toHaveAttribute("data-tip", "Keine Raids gezählt");
        expect(el).toHaveTextContent("–");
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
