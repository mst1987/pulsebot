// Einstellungen → Dungeon-Bestzeiten: the switch "Neue Gildenrekorde posten"
// with its channel, and the save bar's lines for it.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DungeonRecordsCard, { type DungeonRecords } from "./DungeonRecordsCard";
import { draftChanges } from "../../lib/settings/settingsLogic";
import { toDraft } from "./settingsDraft";
import type { AdminConfig } from "../../api";

const CHANNELS = [{ id: "123456789012345678", name: "rekorde", category: "Gilde" }];

describe("DungeonRecordsCard", () => {
    it("is off by default and shows the channel only once it is on", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<DungeonRecordsCard value={{ post: false, channelId: "" }} channels={CHANNELS} onChange={onChange} />);
        expect(screen.getByRole("switch", { name: /Neue Gildenrekorde posten/ })).not.toBeChecked();
        expect(screen.queryByRole("combobox")).toBeNull();
        await user.click(screen.getByRole("switch"));
        expect(onChange).toHaveBeenCalledWith({ post: true, channelId: "" });
        const on: DungeonRecords = { post: true, channelId: "" };
        rerender(<DungeonRecordsCard value={on} channels={CHANNELS} onChange={onChange} />);
        expect(screen.getByText("Ohne Kanal wird nichts gepostet.")).toBeInTheDocument();
        await user.selectOptions(screen.getByRole("combobox"), "123456789012345678");
        expect(onChange).toHaveBeenLastCalledWith({ post: true, channelId: "123456789012345678" });
    });

    it("reads the setting into the draft and names a change in the save bar", () => {
        const draft = toDraft({ dungeonRecords: { post: false, channelId: "" } } as unknown as AdminConfig);
        expect(draft.dungeonRecords).toEqual({ post: false, channelId: "" });
        expect(toDraft({} as AdminConfig).dungeonRecords).toEqual({ post: false, channelId: "" });
        const names = { role: (id: string) => id, user: (id: string) => id, area: (id: string) => id, category: (id: string) => id };
        const lines = draftChanges(draft, { ...draft, dungeonRecords: { post: true, channelId: "123456789012345678" } }, names);
        expect(lines).toEqual(["Gildenrekorde posten: an", "Kanal für Gildenrekorde"]);
    });
});
