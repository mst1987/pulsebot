// The emoji picker (ui/EmojiPicker): button, panel, search, sections, keyboard.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmojiPicker from "../EmojiPicker";

// a few real emojis instead of the whole grid (test/emoji.ts)
vi.mock("../../../../lib/discord/emoji", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../../../lib/discord/emoji")>();
    const { fewEmojis } = await import("../../../../test/emoji");
    return { ...real, loadEmojis: (lang: string) => real.loadEmojis(lang).then(fewEmojis) };
});

afterEach(() => window.localStorage.clear());

async function openPicker(props: Partial<Parameters<typeof EmojiPicker>[0]> = {}) {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<EmojiPicker label="Emoji wählen" onPick={onPick} {...props} />);
    await user.click(screen.getByRole("button", { name: "Emoji wählen" }));
    const panel = screen.getByRole("dialog", { name: "Emoji wählen" });
    // the data arrives with the first open
    await within(panel).findAllByRole("button", { name: "Bär" });
    return { onPick, user, panel };
}

describe("EmojiPicker", () => {
    it("opens a panel with the search focused and Unicode's groups as sections", async () => {
        const { panel } = await openPicker();
        expect(screen.getByRole("button", { name: "Emoji wählen" })).toHaveAttribute("aria-expanded", "true");
        expect(within(panel).getByRole("searchbox", { name: "Emoji suchen" })).toHaveFocus();
        expect(within(panel).getByRole("region", { name: "Tiere & Natur" })).toBeInTheDocument();
        expect(within(panel).getByRole("region", { name: "Smileys & Emotionen" })).toBeInTheDocument();
        // no skin-tone components
        expect(within(panel).queryByRole("region", { name: "Komponenten" })).toBeNull();
    });

    it("puts the caller's sections first and marks the current emoji", async () => {
        const { panel } = await openPicker({ current: "🐻", sections: [{ key: "raid", label: "Passt zu Zul'Aman", emojis: ["🐻", "🦅"] }] });
        const regions = within(panel).getAllByRole("region");
        expect(regions[0]).toHaveAccessibleName("Passt zu Zul'Aman");
        const bear = within(regions[0]).getByRole("button", { name: "Bär" });
        expect(bear).toHaveAttribute("aria-pressed", "true");
        expect(within(regions[0]).getByRole("button", { name: "Adler" })).toHaveAttribute("aria-pressed", "false");
        // the button shows the current emoji instead of the smiley
        expect(screen.getByRole("button", { name: "Emoji wählen" })).toHaveTextContent("🐻");
    });

    it("picks with a click, closes and remembers the emoji for next time", async () => {
        const { onPick, user, panel } = await openPicker();
        await user.click(within(panel).getAllByRole("button", { name: "Bär" })[0]);
        expect(onPick).toHaveBeenCalledWith("🐻");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "Emoji wählen" })).toHaveFocus();

        await user.click(screen.getByRole("button", { name: "Emoji wählen" }));
        const again = screen.getByRole("dialog");
        const recent = await within(again).findByRole("region", { name: "Zuletzt benutzt" });
        expect(within(recent).getByRole("button", { name: "Bär" })).toBeInTheDocument();
    });

    it("searches the German names and picks the first hit with Enter", async () => {
        const { onPick, user, panel } = await openPicker();
        await user.type(within(panel).getByRole("searchbox"), "bär");
        const results = within(panel).getByRole("region", { name: "Suchergebnisse" });
        expect(within(results).getAllByRole("button")[0]).toHaveAccessibleName("Bär");
        await user.keyboard("{Enter}");
        expect(onPick).toHaveBeenCalledWith("🐻");
    });

    it("says so when nothing matches", async () => {
        const { user, panel } = await openPicker();
        await user.type(within(panel).getByRole("searchbox"), "xyzxyz");
        expect(within(panel).getByText("Kein Emoji gefunden.")).toBeInTheDocument();
    });

    it("moves through the grid with the arrows and names the focused emoji in the footer", async () => {
        const { onPick, user, panel } = await openPicker({ sections: [{ key: "s", label: "Vorschlag", emojis: ["🐻", "🦅", "🐆", "🐉", "🌴", "🗿", "🐍", "🔥", "💀", "🌳"] }] });
        const first = (name: string) => within(panel).getAllByRole("button", { name })[0];
        await user.keyboard("{ArrowDown}");
        expect(first("Bär")).toHaveFocus();
        // nine to a row: down from the first emoji is the tenth
        await user.keyboard("{ArrowDown}");
        expect(first("Laubbaum")).toHaveFocus();
        await user.keyboard("{ArrowUp}{ArrowRight}");
        expect(first("Adler")).toHaveFocus();
        expect(panel.querySelector(".emo-foot")).toHaveTextContent("Adler");
        await user.keyboard("{ArrowLeft}{ArrowUp}");
        expect(within(panel).getByRole("searchbox")).toHaveFocus();
        await user.keyboard("{ArrowDown}{Enter}");
        expect(onPick).toHaveBeenCalledWith("🐻");
    });

    it("closes with Escape and hands the focus back", async () => {
        const { user } = await openPicker();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "Emoji wählen" })).toHaveFocus();
    });

    it("shows the hint while nothing is focused", async () => {
        const { panel } = await openPicker({ hint: "Setzt das Emoji an den Anfang." });
        expect(panel.querySelector(".emo-foot")).toHaveTextContent("Setzt das Emoji an den Anfang.");
    });
});

describe("EmojiPicker with the server's emojis", () => {
    const AXT = { id: "e1", name: "axt", url: "https://cdn.discordapp.com/emojis/e1.png?size=64" };
    const ZWERG = { id: "e2", name: "zwerg", url: "https://cdn.discordapp.com/emojis/e2.png?size=64" };
    const custom = { label: "Server", emojis: [AXT, ZWERG] };

    it("puts them first as pictures and picks them by id, not into the Unicode pick", async () => {
        const onPickCustom = vi.fn();
        const { onPick, user, panel } = await openPicker({ custom, onPickCustom, sections: [{ key: "raid", label: "Passt zu Zul'Aman", emojis: ["🐻"] }] });
        const regions = within(panel).getAllByRole("region");
        expect(regions[0]).toHaveAccessibleName("Server");
        const axt = within(regions[0]).getByRole("button", { name: ":axt:" });
        expect(axt.querySelector("img")).toHaveAttribute("src", AXT.url);
        await user.click(axt);
        expect(onPickCustom).toHaveBeenCalledWith(AXT);
        expect(onPick).not.toHaveBeenCalled();
        // never into "zuletzt benutzt"
        await user.click(screen.getByRole("button", { name: "Emoji wählen" }));
        await within(screen.getByRole("dialog")).findAllByRole("button", { name: "Bär" });
        expect(within(screen.getByRole("dialog")).queryByRole("region", { name: "Zuletzt benutzt" })).toBeNull();
    });

    it("finds them by name before Unicode's hits, Enter picks the first", async () => {
        const onPickCustom = vi.fn();
        const { user, panel } = await openPicker({ custom, onPickCustom });
        await user.type(within(panel).getByRole("searchbox"), "zwe");
        const results = within(panel).getByRole("region", { name: "Suchergebnisse" });
        expect(within(results).getAllByRole("button")[0]).toHaveAccessibleName(":zwerg:");
        await user.keyboard("{Enter}");
        expect(onPickCustom).toHaveBeenCalledWith(ZWERG);
    });

    it("shows the current server emoji on the button and marks it", async () => {
        const { panel } = await openPicker({ custom, onPickCustom: vi.fn(), currentCustom: ZWERG });
        expect(screen.getByRole("button", { name: "Emoji wählen" }).querySelector("img")).toHaveAttribute("src", ZWERG.url);
        expect(within(panel).getByRole("button", { name: ":zwerg:" })).toHaveAttribute("aria-pressed", "true");
        expect(within(panel).getByRole("button", { name: ":axt:" })).toHaveAttribute("aria-pressed", "false");
    });

    it("leaves them out without onPickCustom", async () => {
        const { panel } = await openPicker({ custom });
        expect(within(panel).queryByRole("region", { name: "Server" })).toBeNull();
    });
});
