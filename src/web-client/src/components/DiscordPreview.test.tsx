// The recruitment editor's Discord preview: Discord's markdown rendered by the
// shared parser, the server's own emojis in place of their <:name:id> codes, and
// the apply button with the label the bot posts.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Emoji } from "../api";
import DiscordPreview from "./DiscordPreview";

const EMOJIS: Emoji[] = [{ id: "111", name: "holy", animated: false, code: "<:holy:111>", url: "https://cdn.example/holy.png" }];

describe("DiscordPreview", () => {
    it("renders Discord's markdown: headings, bold and italic", () => {
        render(<DiscordPreview content={"## Wir suchen\n**Heiler** und *Tanks*"} buttonLabel="" emojis={[]} />);
        expect(screen.getByRole("heading", { level: 2, name: "Wir suchen" })).toBeInTheDocument();
        expect(screen.getByText("Heiler").closest("strong")).not.toBeNull();
        expect(screen.getByText("Tanks").closest("em")).not.toBeNull();
    });

    it("shows a server emoji as its image and one the server does not have as :name:, like Discord", () => {
        render(<DiscordPreview content="<:holy:111> und <:gone:999>" buttonLabel="" emojis={EMOJIS} />);
        expect(screen.getByRole("img", { name: ":holy:" })).toHaveAttribute("src", "https://cdn.example/holy.png");
        const missing = screen.getByText(":gone:");
        expect(missing.tagName).toBe("SPAN");
        expect(missing).toHaveAttribute("data-tip", "Emoji nicht auf dem Server");
    });

    it("names a mentioned channel by its name", () => {
        render(<DiscordPreview content="Fragen in <#123>" buttonLabel="" emojis={[]} channels={[{ id: "123", name: "fragen", category: "" }]} />);
        expect(screen.getByText("#fragen")).toBeInTheDocument();
    });

    it("labels the button like the bot does: the own label, else Jetzt bewerben", () => {
        const { rerender } = render(<DiscordPreview content="x" buttonLabel="" emojis={[]} />);
        expect(screen.getByText("Jetzt bewerben")).toBeInTheDocument();
        rerender(<DiscordPreview content="x" buttonLabel="   " emojis={[]} />);
        expect(screen.getByText("Jetzt bewerben")).toBeInTheDocument();
        rerender(<DiscordPreview content="x" buttonLabel="Bewirb dich" emojis={[]} />);
        expect(screen.getByText("Bewirb dich")).toBeInTheDocument();
        expect(screen.queryByText("Jetzt bewerben")).not.toBeInTheDocument();
    });

    it("says so when there is no text yet", () => {
        render(<DiscordPreview content="" buttonLabel="" emojis={[]} />);
        expect(screen.getByText("Noch kein Text.")).toBeInTheDocument();
    });
});
