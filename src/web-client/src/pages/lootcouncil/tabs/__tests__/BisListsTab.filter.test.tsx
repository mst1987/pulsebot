// BiS lists, "Welche Specs nebeneinander": the role segment (with "Keine" next to
// "Alle") and the spec toggles. An empty selection says so instead of showing an
// empty matrix.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import { bisListsData } from "../../../../test/councilFixtures";
import { BisListsTab } from "../BisListsTab";
import type { View } from "../../model/view";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getBisLists: vi.fn(),
    searchCouncilItems: vi.fn(),
}));

function data() {
    const d = bisListsData();
    const heal = { ...d.specs[0], key: "priest-holy", label: "Heilig", className: "Priest", spec: "Holy", role: "healer", listKey: "priest-holy" };
    d.specs = [d.specs[0], heal];
    d.columns = [d.columns[0], { ...d.columns[0], key: "priest-holy", label: "Heilig", role: "healer", users: [{ key: "priest-holy", label: "Heilig", ownList: true }] }];
    return d;
}

function Harness() {
    const [view, setView] = useState({ listTier: "t5", listOff: [] as string[], listFocus: 0 } as unknown as View);
    return (
        <>
            <BisListsTab view={view} patch={(p) => setView((v) => ({ ...v, ...p }))} />
            <output data-testid="off">{view.listOff.join(",")}</output>
        </>
    );
}

beforeEach(() => {
    vi.mocked(api.getBisLists).mockResolvedValue(data());
    vi.mocked(api.searchCouncilItems).mockResolvedValue({ items: [] } as Awaited<ReturnType<typeof api.searchCouncilItems>>);
});

describe("BiS list spec filter", () => {
    it("starts on Alle, narrows to a role, clears with Keine and picks single specs after", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const roles = await screen.findByRole("radiogroup", { name: "Rollen-Filter" });
        expect(within(roles).getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "true");
        expect(within(roles).getByRole("radio", { name: "Keine" })).toHaveAttribute("aria-checked", "false");

        await user.click(within(roles).getByRole("radio", { name: "Heiler" }));
        expect(screen.getByTestId("off")).toHaveTextContent("mage-arcane");
        expect(within(roles).getByRole("radio", { name: "Heiler" })).toHaveAttribute("aria-checked", "true");

        await user.click(within(roles).getByRole("radio", { name: "Keine" }));
        await waitFor(() => expect(screen.getByTestId("off")).toHaveTextContent("mage-arcane,priest-holy"));
        expect(within(roles).getByRole("radio", { name: "Keine" })).toHaveAttribute("aria-checked", "true");
        expect(within(roles).getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "false");
        expect(screen.getByText(/Keine Spec ausgewählt/)).toBeInTheDocument();
        expect(screen.queryByRole("table")).toBeNull();

        const arcane = screen.getByRole("button", { name: /Arkan/ });
        expect(arcane).toHaveAttribute("aria-pressed", "false");
        await user.click(arcane);
        expect(arcane).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByTestId("off")).toHaveTextContent(/^priest-holy$/);
        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(within(roles).getByRole("radio", { name: "Keine" })).toHaveAttribute("aria-checked", "false");
    });
});
