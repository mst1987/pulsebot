// "Mein Profil › Raids leiten" (#1034): the own leader flags per game version as
// toggle chips. A click saves at once; there is no checkbox and nobody confirms.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { LeadVersion } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import { leadsSummary } from "../../../lib/roster/leaders";
import { LeadsPart } from "../LeadsPart";

const toast = vi.fn();
vi.mock("../../../components/shell/Jobs", () => ({ useToast: () => toast }));
vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    saveOwnLeads: vi.fn(),
}));

const KARA = { id: "kara", name: "Karazhan", short: "Kara", icon: "" };
const GRUUL = { id: "gruul", name: "Gruul's Lair", short: "Gruul", icon: "" };
const MC = { id: "mc", name: "Molten Core", short: "MC", icon: "" };

function version(id: string, label: string, short: string, instances: LeadVersion["instances"], leads: string[] = []): LeadVersion {
    return { id, label, short, instances, leads, by: "", at: 0 };
}

const TBC = () => version("tbc", "TBC Anniversary", "TBC", [KARA, GRUUL]);
const ERA = () => version("era", "Classic Era", "Era", [MC]);

/** The part with its own state, as the profile page holds it. */
function Harness({ initial }: { initial: LeadVersion[] }) {
    const [versions, setVersions] = useState(initial);
    return <LeadsPart versions={versions} onChange={setVersions} />;
}

beforeEach(() => {
    vi.mocked(api.saveOwnLeads).mockReset();
    toast.mockReset();
});

describe("LeadsPart", () => {
    it("shows one chip per instance, none pressed without a flag, and no checkbox", () => {
        render(<Harness initial={[TBC()]} />);
        const kara = screen.getByRole("button", { name: /Kara/ });
        expect(kara).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: /Gruul/ })).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByRole("checkbox")).toBeNull();
        // a single version needs no version heading
        expect(document.querySelector(".pf-leads-version")).toBeNull();
    });

    it("saves a click at once and shows the stored state", async () => {
        vi.mocked(api.saveOwnLeads).mockResolvedValue({ leadVersions: [{ ...TBC(), leads: ["kara"] }] });
        render(<Harness initial={[TBC()]} />);
        fireEvent.click(screen.getByRole("button", { name: /Kara/ }));
        expect(api.saveOwnLeads).toHaveBeenCalledWith("tbc", ["kara"]);
        await waitFor(() => expect(screen.getByRole("button", { name: /Kara/ })).toHaveAttribute("aria-pressed", "true"));
        expect(toast).not.toHaveBeenCalled();
    });

    it("removes a flag with a second click", async () => {
        vi.mocked(api.saveOwnLeads).mockResolvedValue({ leadVersions: [TBC()] });
        render(<Harness initial={[version("tbc", "TBC Anniversary", "TBC", [KARA, GRUUL], ["kara", "gruul"])]} />);
        fireEvent.click(screen.getByRole("button", { name: /Kara/ }));
        expect(api.saveOwnLeads).toHaveBeenCalledWith("tbc", ["gruul"]);
        await waitFor(() => expect(screen.getByRole("button", { name: /Gruul/ })).toHaveAttribute("aria-pressed", "false"));
    });

    it("rolls back and toasts when saving fails", async () => {
        vi.mocked(api.saveOwnLeads).mockRejectedValue(Object.assign(new Error("kaputt"), { status: 500 }));
        render(<Harness initial={[TBC()]} />);
        fireEvent.click(screen.getByRole("button", { name: /Kara/ }));
        await waitFor(() => expect(toast).toHaveBeenCalledWith("kaputt", "err"));
        expect(screen.getByRole("button", { name: /Kara/ })).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps the versions apart: a click in one version saves only that one", () => {
        vi.mocked(api.saveOwnLeads).mockResolvedValue({ leadVersions: [TBC(), ERA()] });
        render(<Harness initial={[TBC(), ERA()]} />);
        expect(screen.getByText("TBC Anniversary")).toBeInTheDocument();
        expect(screen.getByText("Classic Era")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /MC/ }));
        expect(api.saveOwnLeads).toHaveBeenCalledWith("era", ["mc"]);
    });

    it("says so when the person has no game version yet", () => {
        render(<Harness initial={[]} />);
        expect(screen.getByText(t("profile.leads.noVersion"))).toBeInTheDocument();
    });
});

describe("leadsSummary", () => {
    it("counts the instances with a word and names the versions", () => {
        expect(leadsSummary([TBC(), ERA()])).toBe("keine");
        expect(leadsSummary([version("tbc", "TBC Anniversary", "TBC", [KARA], ["kara"])])).toBe("1 Instanz · TBC");
        expect(leadsSummary([
            version("tbc", "TBC Anniversary", "TBC", [KARA, GRUUL], ["kara", "gruul"]),
            version("era", "Classic Era", "Era", [MC], ["mc"]),
        ])).toBe("3 Instanzen · TBC, Era");
    });

    describe("in English", () => {
        beforeEach(() => switchLang("en"));
        afterEach(() => switchLang("de"));

        it("reads in English", () => {
            expect(leadsSummary([TBC()])).toBe("none");
            expect(leadsSummary([version("tbc", "TBC Anniversary", "TBC", [KARA, GRUUL], ["kara", "gruul"])])).toBe("2 instances · TBC");
            render(<Harness initial={[]} />);
            expect(screen.getByText(/No game version yet/)).toBeInTheDocument();
        });
    });
});
