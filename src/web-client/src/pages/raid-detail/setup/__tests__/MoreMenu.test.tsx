// The bar's "Aktionen" menu by keyboard: opening puts the focus on the first entry,
// the arrows move with wrap-around, Home / End jump, Tab closes, Esc closes and hands
// the focus back to the "Aktionen" button (not to the next control in the bar).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../../i18n";
import { MoreMenu, type MoreItem, type MoreSection } from "../Controls";

const item = (id: string, extra: Partial<MoreItem> = {}): MoreItem => ({ id, label: id, sub: `${id} sub`, icon: "inv_misc_questionmark", onSelect: vi.fn(), ...extra });

function show() {
    const items: (MoreItem | MoreSection | "sep")[] = [
        { section: "Raid" }, item("Eins"), item("Aus", { disabled: true }), item("Zwei"), "sep",
        { section: "Ansicht" }, item("Drei", { on: true }),
    ];
    render(<><MoreMenu items={items} /><button type="button">Setup posten</button></>);
    return screen.getByRole("button", { name: t("setup.editor.more") });
}

const focused = () => (document.activeElement as HTMLElement).textContent;

describe("MoreMenu keyboard", () => {
    it("focuses the first entry when opened with Enter or Space", async () => {
        const user = userEvent.setup();
        const btn = show();
        btn.focus();
        await user.keyboard("{Enter}");
        expect(screen.getByRole("menu")).toBeInTheDocument();
        expect(focused()).toContain("Eins");
        await user.keyboard("{Escape}");
        await user.keyboard(" ");
        expect(focused()).toContain("Eins");
    });

    it("moves with the arrows (wrapping, skipping disabled entries) and Home / End", async () => {
        const user = userEvent.setup();
        show().focus();
        await user.keyboard("{Enter}");
        await user.keyboard("{ArrowDown}");
        expect(focused()).toContain("Zwei");
        await user.keyboard("{ArrowDown}");
        expect(focused()).toContain("Drei");
        await user.keyboard("{ArrowDown}");
        expect(focused()).toContain("Eins");
        await user.keyboard("{ArrowUp}");
        expect(focused()).toContain("Drei");
        await user.keyboard("{Home}");
        expect(focused()).toContain("Eins");
        await user.keyboard("{End}");
        expect(focused()).toContain("Drei");
    });

    it("Esc closes and gives the focus back to the Aktionen button", async () => {
        const user = userEvent.setup();
        const btn = show();
        btn.focus();
        await user.keyboard("{Enter}{ArrowDown}{Escape}");
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(btn);
        expect(btn).toHaveAttribute("aria-expanded", "false");
    });

    it("Tab closes the menu", async () => {
        const user = userEvent.setup();
        show().focus();
        await user.keyboard("{Enter}");
        await user.tab();
        expect(screen.queryByRole("menu")).toBeNull();
    });
});
