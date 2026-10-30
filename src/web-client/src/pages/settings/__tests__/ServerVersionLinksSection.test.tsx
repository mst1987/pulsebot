// Einstellungen → Server → Links & Realm (#923, epic #926): per version a
// switch "Eigener Wert auf <Server>" for each of the four fields, the standard
// of all servers always under it, a wrong value said at the field, and a save
// that sends only this server's overrides.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { renderPage } from "../../../test/render";
import { inLang, switchLang } from "../../../test/i18n";
import { t } from "../../../i18n";
import ServerVersionLinksSection from "../ServerVersionLinksSection";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
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
        // each switch sits under its field's name, also while off
        for (const name of ["Armory-Link", "Warcraft-Logs-Link", "Region", "Realm"]) {
            expect(within(screen.getByRole("group", { name })).getByRole("switch")).toBeInTheDocument();
        }
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
        const input = screen.getByRole("textbox", { name: "Warcraft-Logs-Link" });
        // switched on, the field starts with the standard to edit from
        expect(input).toHaveValue("https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}");
        await user.clear(input);
        await user.type(input, "https://www.warcraftlogs.com/character/eu/x/{{char}");
        expect(screen.getByRole("link", { name: "Warcraft Logs" })).toHaveAttribute("href", "https://www.warcraftlogs.com/character/eu/x/Devihra");
        await user.click(saveButton());
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(api.saveVersionOverrides).toHaveBeenCalledWith(G1, { tbc: { wclUrlTemplate: "https://www.warcraftlogs.com/character/eu/x/{char}" } });
    });

    // #921: a tab loaded on this server whose session switched to another one
    // is refused with 409; the page says so and keeps what was typed
    it("names a server switch in another tab instead of the raw error", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveVersionOverrides).mockRejectedValueOnce({ code: "server_switched", message: "raw" });
        const onSaved = show();
        await user.click(switchOf(/realm/));
        await user.type(screen.getByRole("textbox", { name: "Realm" }), "x");
        await user.click(saveButton());
        expect(await screen.findByText(t("settings.serverSwitched"))).toBeInTheDocument();
        expect(screen.queryByText("raw")).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });

    it("says a wrong template at the field and does not save it", async () => {
        const user = userEvent.setup();
        show();
        await user.click(switchOf(/armory/));
        const input = screen.getByRole("textbox", { name: "Armory-Link" });
        await user.clear(input);
        await user.type(input, "https://armory.test/kein-platzhalter");
        expect(screen.getByText("Eine http(s)-Adresse mit {char}.")).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();
    });

    it("starts with the saved own values switched on; switching off sends the standard again", async () => {
        const user = userEvent.setup();
        show({ tbc: { blizzardRealmSlug: "spineshatter" } });
        expect(switchOf(/realm/)).toBeChecked();
        expect(screen.getByRole("textbox", { name: "Realm" })).toHaveValue("spineshatter");
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

    it("asks for a value when a switch is on and the field empty, and does not save", async () => {
        const user = userEvent.setup();
        show();
        await user.click(switchOf(/realm/));
        const input = screen.getByRole("textbox", { name: "Realm" });
        await user.clear(input);
        expect(screen.getByText(/Eigener Wert ist an, aber leer/)).toBeInTheDocument();
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByText(/Speichern geht erst/)).toBeInTheDocument();
        expect(saveButton()).toBeDisabled();
        await user.type(input, "spineshatter");
        expect(screen.queryByText(/Eigener Wert ist an, aber leer/)).not.toBeInTheDocument();
        expect(saveButton()).toBeEnabled();
    });

    it("offers no \"none\" region while the switch is on and starts with the standard region", async () => {
        const user = userEvent.setup();
        show();
        await user.click(switchOf(/region/));
        const select = screen.getByRole("combobox", { name: "Region" });
        expect(select).toHaveValue("eu");
        expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["EU", "US", "KR", "TW"]);
        await user.click(screen.getByRole("radio", { name: "Forever" }));
        await user.click(switchOf(/region/));
        // no standard region for Forever: the first one, never an empty "own" region
        expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("eu");
    });

    it("takes the server's answer as the new saved state", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveVersionOverrides).mockResolvedValueOnce(
            { config: { serverSettings: { [G1]: { versionOverrides: { tbc: { blizzardRealmSlug: "spineshatter" } } } } } as api.AdminConfig });
        show();
        await user.click(switchOf(/realm/));
        const input = screen.getByRole("textbox", { name: "Realm" });
        await user.clear(input);
        await user.type(input, "Spineshatter");
        await user.click(saveButton());
        // the server keeps the slug lower-case; the form shows what the server kept
        await waitFor(() => expect(screen.getByRole("textbox", { name: "Realm" })).toHaveValue("spineshatter"));
    });

    it("says when an own realm does not reach the links (no {realm} in the template)", async () => {
        const user = userEvent.setup();
        show({ tbc: { blizzardRealmSlug: "spineshatter" } });
        // the standard armory template has {realm}: no hint
        expect(screen.queryByText(/wirkt der Realm nur/)).not.toBeInTheDocument();
        await user.click(switchOf(/armory/));
        const input = screen.getByRole("textbox", { name: "Armory-Link" });
        await user.clear(input);
        await user.type(input, "https://own.test/{{char}");
        expect(screen.getByText(/In den Links wirkt der Realm nur, wenn die Vorlage \{realm\} enth/)).toBeInTheDocument();
    });

    it("speaks English", async () => {
        await inLang("en", () => {
            show();
            expect(screen.getByText(/Only for Pulse Raids and TBC Anniversary/)).toBeInTheDocument();
            expect(screen.getAllByRole("switch", { name: /Pulse Raids/ })).toHaveLength(4);
        });
    });

    it("asks for a value in English too", async () => {
        const user = userEvent.setup();
        // inLang does not wait for an async body; afterEach switches back to German
        await switchLang("en");
        show();
        await user.click(screen.getByRole("radio", { name: "Forever" }));
        await user.click(screen.getAllByRole("switch", { name: /Pulse Raids/ })[3]);
        expect(screen.getByText("Own value is on but empty. Enter a value or switch it off.")).toBeInTheDocument();
        expect(screen.getByText(/the realm only counts when the template contains \{realm\}/)).toBeInTheDocument();
    });
});
