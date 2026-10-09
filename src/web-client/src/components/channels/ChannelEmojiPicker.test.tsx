// The emoji button beside a channel name (channels/ChannelEmojiPicker).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChannelEmojiPicker from "./ChannelEmojiPicker";

// a few real emojis instead of the whole grid (test/emoji.ts)
vi.mock("../../lib/discord/emoji", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../lib/discord/emoji")>();
    const { fewEmojis } = await import("../../test/emoji");
    return { ...real, loadEmojis: (lang: string) => real.loadEmojis(lang).then(fewEmojis) };
});

afterEach(() => window.localStorage.clear());

async function open(props: Partial<Parameters<typeof ChannelEmojiPicker>[0]> & { value: string }) {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChannelEmojiPicker host="body" onChange={onChange} {...props} />);
    await user.click(screen.getByRole("button", { name: "Emoji für den Kanalnamen" }));
    const panel = screen.getByRole("dialog", { name: "Emoji für den Kanalnamen" });
    await within(panel).findAllByRole("button", { name: "Bär" });
    return { onChange, user, panel };
}

describe("ChannelEmojiPicker", () => {
    it("suggests the raid's emojis first, then the category's", async () => {
        const { panel } = await open({
            value: "🐍・mi-15-10-za", instanceIds: ["za"], raidLabel: "Zul'Aman",
            channelNames: ["🐍・mi-08-10-ssc", "🔥・do-09-10-tk", "🐍・mi-01-10-ssc"],
        });
        const [raid, category] = within(panel).getAllByRole("region");
        expect(raid).toHaveAccessibleName("Passt zu Zul'Aman");
        expect(within(raid).getAllByRole("button")[0]).toHaveAccessibleName("Bär");
        expect(category).toHaveAccessibleName("In dieser Kategorie");
        expect(within(category).getAllByRole("button").map((b) => b.textContent)).toEqual(["🐍", "🔥"]);
        // the inherited snake is what the name has now
        expect(within(category).getByRole("button", { name: "Schlange" })).toHaveAttribute("aria-pressed", "true");
    });

    it("replaces the inherited emoji with the picked one", async () => {
        const { onChange, user, panel } = await open({ value: "🐍・mi-15-10-za", instanceIds: ["za"] });
        await user.click(within(panel).getAllByRole("button", { name: "Bär" })[0]);
        expect(onChange).toHaveBeenCalledWith("🐻・mi-15-10-za");
    });

    it("puts the emoji in front with the category's separator", async () => {
        const { onChange, user, panel } = await open({ value: "mi-15-10-za", instanceIds: ["za"], channelNames: ["🐍│mi-08-10-ssc"] });
        await user.click(within(panel).getAllByRole("button", { name: "Bär" })[0]);
        expect(onChange).toHaveBeenCalledWith("🐻│mi-15-10-za");
    });

    it("names the raid generically without a label and leaves out empty rows", async () => {
        const { panel } = await open({ value: "mi-15-10", instanceIds: ["za"] });
        expect(within(panel).getByRole("region", { name: "Passt zum Raid" })).toBeInTheDocument();
        expect(within(panel).queryByRole("region", { name: "In dieser Kategorie" })).toBeNull();
    });
});
