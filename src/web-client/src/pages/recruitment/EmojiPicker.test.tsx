// The recruitment editor's emoji picker: a WoW icon on its button (no emoji),
// the server's emojis in a searchable panel, and a pick inserts the emoji code
// at the cursor of the textarea it belongs to.
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Emoji } from "../../api";
import { switchLang } from "../../test/i18n";
import EmojiPicker from "./EmojiPicker";

const EMOJIS: Emoji[] = [
    { id: "111", name: "holy", animated: false, code: "<:holy:111>", url: "https://cdn.example/holy.png" },
    { id: "222", name: "resto", animated: false, code: "<:resto:222>", url: "https://cdn.example/resto.png" },
];

function Harness({ value, onChange, emojis = EMOJIS }: { value: string; onChange: (next: string) => void; emojis?: Emoji[] }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    return (
        <>
            <textarea ref={ref} aria-label="Text" defaultValue={value} />
            <EmojiPicker emojis={emojis} textareaRef={ref} value={value} onChange={onChange} />
        </>
    );
}

describe("EmojiPicker", () => {
    it("labels its button Server-Emoji with a WoW icon instead of an emoji", () => {
        render(<Harness value="" onChange={() => undefined} />);
        const button = screen.getByRole("button", { name: /Server-Emoji/ });
        expect(button.querySelector("img[src*='/inv_misc_head_murloc_01.jpg']")).not.toBeNull();
        expect(button.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(button).toHaveAttribute("data-tip", "Server-Emoji einfügen");
    });

    it("inserts the picked emoji's code at the cursor", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness value="Hallo Welt" onChange={onChange} />);
        const text = screen.getByRole("textbox", { name: "Text" }) as HTMLTextAreaElement;
        text.setSelectionRange(6, 6);

        await user.click(screen.getByRole("button", { name: /Server-Emoji/ }));
        expect(screen.getByRole("button", { name: /Server-Emoji/ })).toHaveAttribute("aria-expanded", "true");
        await user.click(screen.getByRole("button", { name: ":resto:" }));
        expect(onChange).toHaveBeenCalledWith("Hallo <:resto:222>Welt");
    });

    it("filters the panel by name", async () => {
        const user = userEvent.setup();
        render(<Harness value="" onChange={() => undefined} />);
        await user.click(screen.getByRole("button", { name: /Server-Emoji/ }));
        await user.type(screen.getByPlaceholderText(/Emoji suchen/), "hol");
        expect(screen.getByRole("button", { name: ":holy:" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: ":resto:" })).not.toBeInTheDocument();
        await user.type(screen.getByPlaceholderText(/Emoji suchen/), "xyz");
        expect(screen.getByText("Keine Treffer.")).toBeInTheDocument();
    });

    it("stays away on a server without emojis", () => {
        render(<Harness value="" onChange={() => undefined} emojis={[]} />);
        expect(screen.queryByRole("button", { name: /Server-Emoji/ })).not.toBeInTheDocument();
    });
});

describe("EmojiPicker in English", () => {
    afterEach(() => switchLang("de"));

    it("labels its button and search in English", async () => {
        await switchLang("en");
        const user = userEvent.setup();
        render(<Harness value="" onChange={() => undefined} />);
        const button = screen.getByRole("button", { name: /Server emoji/ });
        expect(button).toHaveAttribute("data-tip", "Insert server emoji");
        await user.click(button);
        await user.type(screen.getByPlaceholderText(/Search emoji/), "xyz");
        expect(screen.getByText("No matches.")).toBeInTheDocument();
    });
});
