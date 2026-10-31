// "Sprachkanal je Raid" of a category (docs/channels.md): the three sources, the
// fixed channel with "from raid 2 on", and the fields for temporary channels.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "../../../../api/discord/channels";
import { t } from "../../../../i18n";
import { DEFAULT_NAME_TEMPLATE, type TempVoiceSettings } from "../../../../lib/discord/tempVoice";
import { switchLang } from "../../../../test/i18n";
import TempVoiceFields from "../TempVoiceFields";

const cat = { id: "c1", name: "T6" } as Category;
const parents = [{ id: "p1", name: "Raids" }] as Category[];
const voiceChannels = [{ id: "v1", name: "Raid 1", category: "T6" }];

function Harness({ stored, fixed = "", onChange = () => {}, onVoice = () => {} }: {
    stored?: Partial<TempVoiceSettings>;
    fixed?: string;
    onChange?: (v: TempVoiceSettings) => void;
    onVoice?: (id: string) => void;
}) {
    const [value, setValue] = useState(stored);
    const [voice, setVoice] = useState(fixed);
    return (
        <TempVoiceFields cat={cat} name="T6" stored={value} voiceChannelId={voice} voiceChannels={voiceChannels} parents={parents}
            onChange={(_id, v) => { setValue(v); onChange(v); }}
            onVoiceChannel={(_id, id) => { setVoice(id); onVoice(id); }} />
    );
}

const radio = (key: string) => screen.getByRole("radio", { name: new RegExp(t(`settings.categories.tempVoiceMode${key}`)) });

describe("TempVoiceFields", () => {
    it("shows no fields without a channel and the fixed channel with its switch", async () => {
        const user = userEvent.setup();
        const onVoice = vi.fn();
        render(<Harness onVoice={onVoice} />);
        expect(radio("None")).toBeChecked();
        expect(screen.queryByText(t("settings.categories.tempChannels"))).toBeNull();
        await user.click(radio("Existing"));
        await user.selectOptions(screen.getByLabelText(t("settings.categories.tempVoiceChannel")), "v1");
        expect(onVoice).toHaveBeenLastCalledWith("v1");
        expect(screen.queryByText(t("settings.categories.tempChannels"))).toBeNull();
        await user.click(screen.getByRole("checkbox", { name: t("settings.categories.tempVoiceFromRaid2") }));
        expect(screen.getByText(t("settings.categories.tempChannels"))).toBeInTheDocument();
    });

    it("sets parent, name with tags, lead, close and the only-assigned switch for temporary channels", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness stored={{ mode: "temp" }} onChange={onChange} />);
        const preview = screen.getByTestId("temp-voice-preview");
        expect(preview.textContent).toContain("SSC · Sa 31.10.");
        expect(preview.textContent).toContain("SSC 2 · Sa 31.10.");
        await user.selectOptions(screen.getByLabelText(t("settings.categories.tempParent")), "p1");
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "temp", parentId: "p1", nameTemplate: DEFAULT_NAME_TEMPLATE }));
        await user.click(screen.getByRole("button", { name: "{leader}" }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nameTemplate: `${DEFAULT_NAME_TEMPLATE} {leader}` }));
        await user.click(screen.getByRole("button", { name: t("settings.categories.tempLeadMore") }));
        await user.click(screen.getByRole("button", { name: t("settings.categories.tempCloseMore") }));
        await user.click(screen.getByRole("checkbox", { name: t("settings.categories.tempOnlyAssigned") }));
        const last = onChange.mock.calls.at(-1)![0] as TempVoiceSettings;
        expect(last.leadMinutes).toBe(35);
        expect(last.closeAfterMinutes).toBe(65);
        expect(last.onlyAssigned).toBe(true);
        expect(screen.getByText(t("settings.categories.tempLeadExample", { time: "19:25" }))).toBeInTheDocument();
    });

    it("writes the preview's weekday in the category's language", () => {
        render(<TempVoiceFields cat={cat} name="T6" stored={{ mode: "temp" }} voiceChannelId="" voiceChannels={voiceChannels} parents={parents}
            lang="en" onChange={() => {}} onVoiceChannel={() => {}} />);
        expect(screen.getByTestId("temp-voice-preview").textContent).toContain("SSC 2 · Sat 31.10.");
    });

    it("names the rights the bot lacks under the chosen parent, Manage Permissions only for only-assigned", () => {
        const rights = { "": [], p1: ["MoveMembers", "ManageRoles"] };
        const show = (stored: Partial<TempVoiceSettings>, given: Record<string, string[]> | null = rights) => render(
            <TempVoiceFields cat={cat} name="T6" stored={stored} voiceChannelId="" voiceChannels={voiceChannels} parents={parents}
                rights={given} onChange={() => {}} onVoiceChannel={() => {}} />,
        );
        const label = (keys: string[]) => t("settings.categories.tempRightsMissing", { rights: keys.map((k) => t(`settings.categories.tempRight.${k}`)).join(", ") });
        const a = show({ mode: "temp" });
        expect(screen.queryByTestId("temp-voice-rights")).toBeNull();
        a.unmount();
        const b = show({ mode: "temp", parentId: "p1" });
        expect(screen.getByTestId("temp-voice-rights")).toHaveTextContent(label(["MoveMembers"]));
        b.unmount();
        const c = show({ mode: "temp", parentId: "p1", onlyAssigned: true });
        expect(screen.getByTestId("temp-voice-rights")).toHaveTextContent(label(["MoveMembers", "ManageRoles"]));
        c.unmount();
        // a parent the answer does not name falls back to the server's rights; unknown rights warn about nothing
        const d = show({ mode: "temp", parentId: "p9" }, { "": ["ManageChannels"] });
        expect(screen.getByTestId("temp-voice-rights")).toHaveTextContent(label(["ManageChannels"]));
        d.unmount();
        show({ mode: "temp", parentId: "p1" }, null);
        expect(screen.queryByTestId("temp-voice-rights")).toBeNull();
    });

    it("shows and takes the English placeholder names in the English UI, and stores the German ones", async () => {
        await switchLang("en");
        try {
            const user = userEvent.setup();
            const onChange = vi.fn();
            render(<Harness stored={{ mode: "temp" }} onChange={onChange} />);
            const input = screen.getByLabelText(t("settings.categories.tempName"));
            expect(input).toHaveValue("{raid} {no} · {date}");
            await user.click(screen.getByRole("button", { name: "{date}" }));
            expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nameTemplate: `${DEFAULT_NAME_TEMPLATE} {datum}` }));
            await user.clear(input);
            await user.type(input, "{{raid} {{time}");
            expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ nameTemplate: "{raid} {zeit}" }));
            expect(input).toHaveValue("{raid} {time}");
            expect(screen.getByTestId("temp-voice-preview").textContent).toContain("SSC 20:00");
        } finally {
            await switchLang("de");
        }
    });

    it("keeps an unknown stored parent selectable", () => {
        render(<Harness stored={{ mode: "temp", parentId: "gone" }} />);
        expect(screen.getByLabelText(t("settings.categories.tempParent"))).toHaveValue("gone");
    });
});
