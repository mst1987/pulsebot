// Einstellungen → Raid-Standardwerte, "Bot-Sprache": the saved value is shown,
// a click hands the other language to the draft.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BotLanguageCard from "./BotLanguageCard";

describe("BotLanguageCard", () => {
    it("shows the saved language and explains the setting", () => {
        render(<BotLanguageCard value="de" onChange={vi.fn()} />);
        const group = screen.getByRole("radiogroup", { name: "Sprache der Bot-Nachrichten" });
        expect(group.querySelector("[aria-checked=true]")).toHaveTextContent("Deutsch");
        expect(screen.getByText(/Standard für alle Raider.*\/language/)).toBeInTheDocument();
    });

    it("hands the other language to the draft", async () => {
        const onChange = vi.fn();
        render(<BotLanguageCard value="de" onChange={onChange} />);
        await userEvent.click(screen.getByRole("radio", { name: "English" }));
        expect(onChange).toHaveBeenCalledWith("en");
    });
});
