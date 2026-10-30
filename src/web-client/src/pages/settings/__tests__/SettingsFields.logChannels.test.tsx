// The log channel rows of Einstellungen → Log-Auswertung (#921): one row per
// channel with its game version. A channel added here has no version yet (the
// server takes the category's on save), "Nach Log-Seite" is the empty version.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { LogChannelInput, TextChannel } from "../../../api";
import { LogChannelsField } from "../SettingsFields";

const versions = [{ id: "tbc", label: "TBC Anniversary" }, { id: "forever", label: "WoW Forever" }];
const channels: TextChannel[] = [{ id: "c1", name: "logs", category: "Raids TBC" }, { id: "c2", name: "forever-logs", category: "" }];

function Harness({ start, chans = channels, spy }: { start: LogChannelInput[]; chans?: TextChannel[]; spy: (e: LogChannelInput[]) => void }) {
    const [entries, setEntries] = useState(start);
    return <LogChannelsField entries={entries} channels={chans} versions={versions} onChange={(e) => { setEntries(e); spy(e); }} />;
}

describe("LogChannelsField", () => {
    it("shows each channel with its category and version", () => {
        render(<Harness start={[{ channelId: "c1", versionId: "tbc" }, { channelId: "c2", versionId: "" }]} spy={vi.fn()} />);
        expect(screen.getByText("#logs")).toBeInTheDocument();
        expect(screen.getByText("Raids TBC")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Spielversion für #logs" })).toHaveValue("tbc");
        expect(screen.getByRole("combobox", { name: "Spielversion für #forever-logs" })).toHaveValue("");
        // a saved channel always has a version, so "Aus der Kategorie" is not offered
        expect(screen.queryByRole("option", { name: "Aus der Kategorie" })).not.toBeInTheDocument();
    });

    it("adds a picked channel without a version, which can then get one", async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<Harness start={[]} spy={spy} />);
        await user.selectOptions(screen.getByRole("combobox"), "c2");
        expect(spy).toHaveBeenLastCalledWith([{ channelId: "c2" }]);
        const version = screen.getByRole("combobox", { name: "Spielversion für #forever-logs" });
        expect(version).toHaveValue("__auto");
        await user.selectOptions(version, "forever");
        expect(spy).toHaveBeenLastCalledWith([{ channelId: "c2", versionId: "forever" }]);
        // once picked, the channel keeps a version of its own
        expect(screen.queryByRole("option", { name: "Aus der Kategorie" })).not.toBeInTheDocument();
    });

    it("keeps an unknown channel and an unknown version visible", () => {
        render(<Harness start={[{ channelId: "999", versionId: "classic" }]} spy={vi.fn()} />);
        expect(screen.getByText("999")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Spielversion für 999" })).toHaveValue("classic");
    });

    it("takes typed ids while the bot is offline, each once", async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<Harness start={[{ channelId: "1", versionId: "tbc" }]} chans={[]} spy={spy} />);
        await user.type(screen.getByRole("textbox"), "1, 2, 2{Enter}");
        expect(spy).toHaveBeenLastCalledWith([{ channelId: "1", versionId: "tbc" }, { channelId: "2" }]);
    });

    it("removes a channel", async () => {
        const user = userEvent.setup();
        const spy = vi.fn();
        render(<Harness start={[{ channelId: "c1", versionId: "tbc" }]} spy={spy} />);
        await user.click(screen.getByRole("button", { name: "Kanal entfernen" }));
        expect(spy).toHaveBeenLastCalledWith([]);
    });
});
