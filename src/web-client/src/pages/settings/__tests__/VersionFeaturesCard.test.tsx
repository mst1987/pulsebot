// Einstellungen → Spielversion, "Funktionen je Version" (#761): the matrix with a
// switch only where a feature is possible, the reason in the tooltip.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import VersionFeaturesCard from "../VersionFeaturesCard";
import type { CapabilityMatrix, FeatureCell } from "../../../lib/settings/versionFeatures";

const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "classic", label: "Classic Era", short: "Classic" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];
const FEATURES = ["logcheck", "lootCouncilBis", "simulation", "raidSheet", "softres", "armory", "wowheadLinks", "raidplanCatalog"];
const on: FeatureCell = { possible: true, enabled: true, on: true, reason: "", message: "", missing: [] };
const no = (reason: string, over: Partial<FeatureCell> = {}): FeatureCell => ({ possible: false, enabled: true, on: false, reason, message: "", missing: [], ...over });

// TBC can do everything; Forever today only the Wowhead links (#761)
const MATRIX: CapabilityMatrix = {
    features: FEATURES,
    versions: {
        tbc: Object.fromEntries(FEATURES.map((f) => [f, on])),
        classic: Object.fromEntries(FEATURES.map((f) => [f, f === "wowheadLinks" || f === "softres" ? on : no("no_rules")])),
        forever: {
            logcheck: no("rules_not_ready", { missing: ["a", "b", "c"], also: ["no_site"] }),
            lootCouncilBis: no("no_bis_data"),
            simulation: no("no_sim_data"),
            raidSheet: no("no_sheet_layout"),
            softres: no("no_softres_edition"),
            armory: no("armory_not_configured"),
            wowheadLinks: on,
            raidplanCatalog: no("no_catalog_entries"),
        },
    },
};

function show(disabled: Record<string, string[]> = {}) {
    const onChange = vi.fn();
    const view = render(<VersionFeaturesCard versions={VERSIONS} matrix={MATRIX} disabled={disabled} onChange={onChange} />);
    return { ...view, onChange };
}

const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;

describe("VersionFeaturesCard", () => {
    it("shows TBC all on and Forever with only the Wowhead links possible", () => {
        show();
        const switches = screen.getAllByRole("switch");
        // 8 TBC + 2 Classic + 1 Forever
        expect(switches).toHaveLength(11);
        for (const f of ["Logcheck", "BiS-Listen", "Simulation", "Raidsheet", "Softres", "Armory-Abruf", "Wowhead-Links", "Raidplan-Katalog"]) {
            expect(screen.getByRole("switch", { name: new RegExp(`^${f} · TBC`) })).toBeChecked();
        }
        expect(screen.getByRole("switch", { name: /^Wowhead-Links · Forever/ })).toBeChecked();
        expect(screen.queryByRole("switch", { name: /^Logcheck · Forever/ })).toBeNull();
    });

    it("says why a feature is not possible, naming every reason", () => {
        show();
        const logcheck = within(row("Logcheck")).getByLabelText(/^Logcheck · Forever: nicht möglich/);
        expect(logcheck).toHaveAttribute("data-tip", "nicht möglich");
        expect(logcheck.getAttribute("data-tip-sub")).toBe("Logcheck-Regeln für WoW Forever noch nicht fertig (3 offen). Keine Warcraft-Logs-Seite für WoW Forever eingetragen.");
        const bis = within(row("BiS-Listen")).getByLabelText(/^BiS-Listen · Forever: nicht möglich/);
        expect(bis.getAttribute("data-tip-sub")).toBe("Keine BiS-Daten für WoW Forever.");
        const sheet = within(row("Raidsheet")).getByLabelText(/^Raidsheet · Forever: nicht möglich/);
        expect(sheet.getAttribute("data-tip-sub")).toBe("Kein Raidsheet-Layout für WoW Forever.");
    });

    it("switches a feature off in the draft, in the matrix order", async () => {
        const user = userEvent.setup();
        const { onChange } = show({ tbc: ["softres"] });
        await user.click(screen.getByRole("switch", { name: /^Logcheck · TBC/ }));
        expect(onChange).toHaveBeenCalledWith("tbc", ["logcheck", "softres"]);
    });

    it("shows a feature switched off as 'aus' with its hint, and switches it back on", async () => {
        const user = userEvent.setup();
        const { onChange } = show({ tbc: ["softres"] });
        const softres = screen.getByRole("switch", { name: /^Softres · TBC/ });
        expect(softres).not.toBeChecked();
        const label = softres.closest("label") as HTMLElement;
        expect(label).toHaveAttribute("data-tip-sub", "Für TBC Anniversary ausgeschaltet.");
        expect(within(label).getByText("aus")).toBeInTheDocument();
        await user.click(softres);
        expect(onChange).toHaveBeenCalledWith("tbc", []);
    });

    it("renders nothing without a matrix (an older server)", () => {
        const { container } = render(<VersionFeaturesCard versions={VERSIONS} disabled={{}} onChange={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });
});
