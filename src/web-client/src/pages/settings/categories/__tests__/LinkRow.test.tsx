// One link row of a Discord centre: emoji field, quick pick and the button preview.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { t } from "../../../../i18n";
import { cleanLinks, previewEmoji, type LinkValue } from "../../../../lib/discord/buttonEmoji";
import LinkRow from "../LinkRow";

function Harness({ start }: { start: LinkValue }) {
    const [row, setRow] = useState(start);
    return <LinkRow row={row} n={1} groupId="g" onChange={(p) => setRow({ ...row, ...p })} onRemove={() => {}} />;
}

const emojiInput = () => screen.getByLabelText(t("settings.categories.linkEmojiAria", { n: 1 }));

describe("LinkRow", () => {
    it("shows the emoji before the text in the button preview", async () => {
        const user = userEvent.setup();
        render(<Harness start={{ label: "WCL Einladung", url: "https://x.example" }} />);
        await user.type(emojiInput(), "📊");
        expect(document.querySelector(".link-preview")?.textContent).toBe("📊WCL Einladung↗");
    });

    it("shows a custom Discord emoji as the picture from Discord's CDN", () => {
        render(<Harness start={{ label: "WCL", url: "https://x.example", emoji: "<a:party:123456789012345678>" }} />);
        const img = document.querySelector(".link-preview img");
        expect(img?.getAttribute("src")).toBe("https://cdn.discordapp.com/emojis/123456789012345678.gif?size=32");
    });

    it("picks an emoji from the quick list and lets a second click clear it", async () => {
        const user = userEvent.setup();
        render(<Harness start={{ label: "WCL", url: "https://x.example" }} />);
        await user.click(screen.getByRole("button", { name: t("settings.categories.linkEmojiPick") }));
        await user.click(screen.getByRole("button", { name: "🧙" }));
        expect(emojiInput()).toHaveValue("🧙");
        await user.click(screen.getByRole("button", { name: "🧙" }));
        expect(emojiInput()).toHaveValue("");
    });
});

describe("cleanLinks / previewEmoji", () => {
    it("trims, drops empty rows and sends no emoji key without an emoji", () => {
        expect(cleanLinks([
            { label: " A ", url: " https://a.example ", emoji: " 📊 " },
            { label: "B", url: "https://b.example", emoji: "  " },
            { label: "", url: "" },
        ])).toEqual([{ label: "A", url: "https://a.example", emoji: "📊" }, { label: "B", url: "https://b.example" }]);
    });

    it("reads empty, unicode and custom emoji", () => {
        expect(previewEmoji("  ")).toBeNull();
        expect(previewEmoji("📊")).toEqual({ kind: "unicode", text: "📊" });
        expect(previewEmoji("<:wcl:123456789012345678>")).toMatchObject({ kind: "custom", id: "123456789012345678", animated: false });
    });
});
