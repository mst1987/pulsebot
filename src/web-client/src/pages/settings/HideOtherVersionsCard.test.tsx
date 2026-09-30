// Einstellungen → Spielversion, "Andere Versionen ausblenden" (#563): the
// switch, the warning about coming raids of other versions, the archive export
// and the preview of the top bar.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HideOtherVersionsCard from "./HideOtherVersionsCard";

const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "classic", label: "Classic Era", short: "Classic" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];
// Wed 04.11.2026 and Sun 08.11.2026, 19:30 UTC
const UPCOMING = {
    tbc: [{ id: "a", title: "BT", startTime: Date.UTC(2026, 10, 4, 19, 30) / 1000 }, { id: "b", title: "Hyjal", startTime: Date.UTC(2026, 10, 8, 19, 30) / 1000 }],
    forever: [{ id: "f", title: "Ony", startTime: Date.UTC(2026, 10, 5, 19, 30) / 1000 }],
};

function show(over: Partial<Parameters<typeof HideOtherVersionsCard>[0]> = {}) {
    const onChange = vi.fn();
    const view = render(
        <HideOtherVersionsCard versions={VERSIONS} mainVersion="forever" hidden={false} upcoming={UPCOMING} canExport onChange={onChange} {...over} />,
    );
    return { ...view, onChange };
}

describe("HideOtherVersionsCard", () => {
    it("explains the switch with the main version and the versions it hides", async () => {
        const user = userEvent.setup();
        const { onChange } = show();
        const box = screen.getByRole("checkbox", { name: "Andere Versionen ausblenden" });
        expect(box).not.toBeChecked();
        expect(screen.getByText(/Alle sehen nur noch Forever\. TBC, Classic verschwindet/)).toBeInTheDocument();
        await user.click(box);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("warns about the coming raids of other versions only while switched on", () => {
        const { rerender, onChange } = show();
        expect(screen.queryByRole("status")).toBeNull();
        rerender(<HideOtherVersionsCard versions={VERSIONS} mainVersion="forever" hidden upcoming={UPCOMING} canExport onChange={onChange} />);
        const warning = screen.getByRole("status");
        expect(warning).toHaveTextContent("Es gibt noch 2 kommende Raids anderer Versionen");
        expect(warning).toHaveTextContent("04.11.");
        expect(warning).toHaveTextContent("08.11.");
        // the main version's own raid is no reason to warn
        expect(warning).not.toHaveTextContent("05.11.");
    });

    it("has no warning when nothing of another version is coming", () => {
        show({ hidden: true, upcoming: { forever: UPCOMING.forever } });
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("offers the archive export as CSV and JSON to a full admin only", () => {
        const { unmount } = show();
        const csv = screen.getByRole("link", { name: /TBC, Classic-Archiv exportieren/ });
        expect(csv).toHaveAttribute("href", "/api/settings/archive-export?format=csv");
        expect(screen.getByRole("link", { name: "als JSON" })).toHaveAttribute("href", "/api/settings/archive-export?format=json");
        unmount();
        show({ canExport: false });
        expect(screen.queryByRole("link", { name: /exportieren/ })).toBeNull();
    });

    it("names only the versions with data in the export", () => {
        show({ dataVersions: ["tbc", "forever"] });
        expect(screen.getByRole("link", { name: /^TBC-Archiv exportieren/ })).toBeInTheDocument();
    });

    it("has no export when no other version has data", () => {
        show({ dataVersions: ["forever"] });
        expect(screen.queryByRole("link", { name: /exportieren/ })).toBeNull();
    });

    it("previews the top bar: the segment while off, the quiet hint while on", () => {
        const { container, rerender, onChange } = show();
        expect(container.querySelectorAll(".gv-hide-bar .seg-opt")).toHaveLength(3);
        rerender(<HideOtherVersionsCard versions={VERSIONS} mainVersion="forever" hidden upcoming={{}} canExport onChange={onChange} />);
        expect(container.querySelector(".gv-hide-bar .seg-opt")).toBeNull();
        expect(container.querySelector(".gv-hide-bar .cswitch-quiet")).toHaveTextContent("Forever");
    });
});
