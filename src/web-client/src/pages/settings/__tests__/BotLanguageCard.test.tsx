// Einstellungen → Raid-Standardwerte, "Bot-Sprache" (#924): with a server picked
// an own value over the global default, without one the default itself.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BotLanguageCard from "../BotLanguageCard";

const base = { value: "de" as const, own: true, defaultValue: "en" as const, server: "Pulse", canEditDefault: true };

describe("BotLanguageCard", () => {
    it("shows the server's own language and explains the setting", () => {
        render(<BotLanguageCard {...base} onChange={vi.fn()} />);
        const group = screen.getByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(group.querySelector("[aria-checked=true]")).toHaveTextContent("Deutsch");
        expect(screen.getByText(/Standard für alle Raider.*\/language/)).toBeInTheDocument();
    });

    it("hands the other language to the draft as the server's own value", async () => {
        const onChange = vi.fn();
        render(<BotLanguageCard {...base} onChange={onChange} />);
        await userEvent.click(screen.getByRole("radio", { name: "English" }));
        expect(onChange).toHaveBeenCalledWith({ botLanguage: "en", botLanguageOwn: true });
    });

    it("drops the own value with \"Standard verwenden\"", async () => {
        const onChange = vi.fn();
        render(<BotLanguageCard {...base} onChange={onChange} />);
        await userEvent.click(screen.getByRole("button", { name: "Standard verwenden" }));
        expect(onChange).toHaveBeenCalledWith({ botLanguage: "en", botLanguageOwn: false });
    });

    it("edits the default without a server, read-only for limited accounts", async () => {
        const onChange = vi.fn();
        const { unmount } = render(<BotLanguageCard {...base} own={false} server="" onChange={onChange} />);
        await userEvent.click(screen.getByRole("radio", { name: "English" }));
        expect(onChange).toHaveBeenCalledWith({ botLanguage: "en", botLanguageOwn: false });
        unmount();
        render(<BotLanguageCard {...base} own={false} server="" canEditDefault={false} onChange={onChange} />);
        expect(screen.queryByRole("radiogroup")).toBeNull();
    });
});
