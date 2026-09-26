// The one button system (design issue #221): Button, IconButton, SplitButton.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, SplitButton, buttonClass } from "./Button";
import { t } from "../../i18n";

describe("Button", () => {
    it("is a plain button that runs its action", async () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Speichern</Button>);
        const btn = screen.getByRole("button", { name: "Speichern" });
        expect(btn).toHaveAttribute("type", "button");
        await userEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("is inert and busy while its job runs", async () => {
        const onClick = vi.fn();
        render(<Button variant="run" running onClick={onClick}>Auswerten</Button>);
        const btn = screen.getByRole("button", { name: "Auswerten" });
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute("aria-busy", "true");
        await userEvent.click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("maps variant and size to the classes a link styled as a button shares", () => {
        expect(buttonClass()).toBe("btn");
        expect(buttonClass("danger", "sm", true)).toBe("btn btn-danger btn-sm has-icon");
    });
});

describe("IconButton", () => {
    it("is named and explained by its tip, never by a native title", async () => {
        const onClick = vi.fn();
        render(<IconButton icon="inv_misc_map_01" tip="Karte öffnen" tipSub="Zeigt die Karte" onClick={onClick} />);
        const btn = screen.getByRole("button", { name: "Karte öffnen" });
        expect(btn).toHaveAttribute("data-tip", "Karte öffnen");
        expect(btn).toHaveAttribute("data-tip-sub", "Zeigt die Karte");
        expect(btn).not.toHaveAttribute("title");
        await userEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("lets a more specific aria-label win over the tip", () => {
        render(<IconButton icon="inv_misc_map_01" tip="Löschen" aria-label="Eintrag Alpha löschen" />);
        expect(screen.getByRole("button", { name: "Eintrag Alpha löschen" })).toHaveAttribute("data-tip", "Löschen");
    });
});

describe("SplitButton", () => {
    function renderSplit() {
        const main = vi.fn();
        const discord = vi.fn();
        render(
            <SplitButton
                label="Posten"
                onClick={main}
                options={[
                    { id: "discord", label: "In Discord posten", onSelect: discord },
                    { id: "off", label: "Gesperrt", onSelect: vi.fn(), disabled: true },
                ]}
            />,
        );
        return { main, discord };
    }

    it("runs the main action and opens its variants from the caret", async () => {
        const { main, discord } = renderSplit();
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Posten" }));
        expect(main).toHaveBeenCalledTimes(1);

        const caret = screen.getByRole("button", { name: t("common.moreOptions") });
        expect(caret).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        await user.click(caret);
        expect(caret).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("menuitem", { name: "Gesperrt" })).toBeDisabled();
        await user.click(screen.getByRole("menuitem", { name: "In Discord posten" }));
        expect(discord).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes its menu on Escape and on a click outside", async () => {
        renderSplit();
        const user = userEvent.setup();
        const caret = screen.getByRole("button", { name: t("common.moreOptions") });
        await user.click(caret);
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        await user.click(caret);
        await user.click(document.body);
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
});
