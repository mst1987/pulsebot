// Einstellungen → Server → Links & Realm (#923, epic #926): per version a
// switch "Eigener Wert auf <Server>" for each of the four fields, the standard
// of all servers always under it, a wrong value said at the field, and a save
// that sends only this server's overrides.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import { inLang, switchLang } from "../../test/i18n";
import ServerVersionLinksSection from "./ServerVersionLinksSection";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    saveVersionOverrides: vi.fn(),
}));

const G1 = "111111111111111111";
const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];
const STANDARD = {
    tbc: {
        blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike",
        armoryUrlTemplate: "https://armory.test/{region}/{realm}/{char}",
        wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
        wowheadPath: "tbc",
    },
};

function show(saved?: api.VersionOverrides, onSaved = vi.fn()) {
    renderPage(
        <ServerVersionLinksSection
            versions={VERSIONS} mainVersion="tbc" standard={STANDARD} saved={saved}
            serverName="Pulse Raids" guildId={G1} onSaved={onSaved}
        />,
    );
    return onSaved;
}

const switchOf = (field: RegExp) => screen.getAllByRole("switch", { name: /Pulse Raids/ })[["armory", "wcl", "region", "realm"].findIndex((k) => field.test(k))];
const saveButton = () => screen.getByRole("button", { name: "Speichern" });

beforeEach(() => {
    vi.mocked(api.saveVersionOverrides).mockReset();
    vi.mocked(api.saveVersionOverrides).mockImplementation(async (_g, versionOverrides) => (
        { config: { serverSettings: { [G1]: { versionOverrides } } } as api.AdminConfig }));
});
afterEach(() => switchLang("de"));

describe("ServerVersionLinksSection (#923)", () => {
    it("shows the standard of all servers under every field, all switches off, nothing to save", () => {
        show();
        expect(screen.getAllByRole("switch", { name: /Eigener Wert auf Pulse Raids/ })).toHaveLength(4);
        for (const s of screen.getAllByRole("switch")) expect(s).not.toBeChecked();
        expect(screen.getByText("https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}")).toBeInTheDocument();
        expect(screen.getByText("EU")).toBeInTheDocument();
        expect(screen.getByText("thunderstrike")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Armory" })).toHaveAttribute("href", "https://armory.test/eu/thunderstrike/Devihra");
        expect(saveButton()).toBeDisabled();
    });

    it("sends only this server's own log link; the preview follows it", async () => {
        const user = userEvent.setup();
        const onSaved = show();
        await user.click(switchOf(/wcl/));
        const input = screen.getByLabelText("Warcraft-Logs-Link");
        // switched on, the field starts with the standard to edit from
        expect(input).toHaveValue("https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}");
        await user.clear(input);
        await user.type(input, "https://www.warcraftlogs.com/character/eu/x/{{char}");
        expect(screen.getByRole("link", { name: "Warcraft Logs" })).toHaveAttribute("href", "https://www.warcraftlogs.com/character/eu/x/Devihra");
        await user.click(saveButton());
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(api.saveVersionOverrides).toHaveBeenCalledWith(G1, { tbc: { wclUrlTemplate: "https://www.warcraftlogs.com/character/eu/x/{char}" } });
    });

    it("says a wrong template at the field and does not save it", async () => {
        const user = userEvent.setup();
        show();
        await user.click(switchOf(/armory/));
        const input = screen.getByLabelText("Armory-Link");
        await user.clear(input);
        await user.type(input, "https://armory.test/kein-platzhalter");
        expect(screen.getByText("Eine http(s)-Adresse mit {char}.")).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();
    });

    it("starts with the saved own values switched on; switching off sends the standard again", async () => {
        const user = userEvent.setup();
        show({ tbc: { blizzardRealmSlug: "spineshatter" } });
        expect(switchOf(/realm/)).toBeChecked();
        expect(screen.getByLabelText("Realm")).toHaveValue("spineshatter");
        expect(screen.getByRole("link", { name: "Armory" })).toHaveAttribute("href", "https://armory.test/eu/spineshatter/Devihra");
        await user.click(switchOf(/realm/));
        await user.click(saveButton());
        await waitFor(() => expect(api.saveVersionOverrides).toHaveBeenCalledWith(G1, {}));
    });

    it("keeps each version apart: Forever has no standard, so nothing is set there", async () => {
        const user = userEvent.setup();
        show();
        await user.click(screen.getByRole("radio", { name: "Forever" }));
        expect(screen.getAllByText("nicht gesetzt")).toHaveLength(4);
        expect(screen.getByText("keine Armory")).toBeInTheDocument();
    });

    it("speaks English", async () => {
        await inLang("en", () => {
            show();
            expect(screen.getByText(/Only for Pulse Raids and TBC Anniversary/)).toBeInTheDocument();
            expect(screen.getAllByRole("switch", { name: /Pulse Raids/ })).toHaveLength(4);
        });
    });
});
