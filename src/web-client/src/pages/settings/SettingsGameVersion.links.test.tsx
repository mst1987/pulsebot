// Einstellungen → Spielversion, "Links und Armory je Version" (#542): one
// version at a time behind a switcher, TBC shows the values it always had,
// Forever starts empty, a wrong value is said at the field, and the preview
// shows where the links go (or that there is none).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { VersionSettingsCard } from "./SettingsGameVersion";
import { blockOf, emptyBlock, type VersionSettingsBlock } from "../../lib/settings/versionLinks";
import { inLang } from "../../test/i18n";

const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC" },
    { id: "classic", label: "WoW Classic", short: "Classic" },
    { id: "forever", label: "WoW Forever", short: "Forever" },
];
const TBC = blockOf({
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
});

const CLASSIC_STD = blockOf({
    blizzardRegion: "eu", blizzardNamespace: "profile-classic1x-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/{region}/vanilla/{realm}/{char}",
    wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
    wowheadPath: "classic", softresEdition: "classic",
});
const DEFAULTS = { tbc: blockOf({ wowheadPath: "tbc", softresEdition: "tbc" }), classic: CLASSIC_STD, forever: emptyBlock() };

function Harness({ onChange, mainVersion = "tbc" }: { onChange: (id: string, b: VersionSettingsBlock) => void; mainVersion?: string }) {
    const [value, setValue] = useState<Record<string, VersionSettingsBlock>>({ tbc: TBC, classic: emptyBlock(), forever: emptyBlock() });
    return (
        <VersionSettingsCard
            versions={VERSIONS} mainVersion={mainVersion} value={value} defaults={DEFAULTS}
            raidsheets={[{ id: "tier45", name: "Tier 4 / Tier 5" }]}
            onChange={(id, block) => { onChange(id, block); setValue((cur) => ({ ...cur, [id]: block })); }}
        />
    );
}

describe("VersionSettingsCard (#542)", () => {
    it("opens on the main version and shows the TBC values with working preview links", () => {
        render(<Harness onChange={vi.fn()} />);
        expect(screen.getByRole("textbox", { name: "Realm" })).toHaveValue("thunderstrike");
        expect(screen.getByRole("textbox", { name: "Namespace" })).toHaveValue("profile-classicann-eu");
        expect(screen.getByRole("textbox", { name: "Wowhead-Pfad" })).toHaveValue("tbc");
        expect(screen.getByRole("combobox", { name: "Softres-Edition" })).toHaveValue("tbc");
        expect(screen.getByRole("link", { name: "Armory" })).toHaveAttribute("href", "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/Devihra");
        expect(screen.getByRole("link", { name: "Wowhead" })).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=32837");
    });

    it("switches to Forever: empty fields, no links, and a value entered goes to Forever only", async () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        await userEvent.click(screen.getByRole("radio", { name: "Forever" }));
        expect(screen.getByRole("textbox", { name: "Realm" })).toHaveValue("");
        expect(screen.queryByRole("link", { name: "Armory" })).toBeNull();
        expect(screen.getByText("keine Armory")).toBeInTheDocument();
        await userEvent.type(screen.getByRole("textbox", { name: "Wowhead-Pfad" }), "classic");
        expect(onChange).toHaveBeenLastCalledWith("forever", expect.objectContaining({ wowheadPath: "classic", blizzardRealmSlug: "" }));
        expect(screen.getByRole("link", { name: "Wowhead" })).toHaveAttribute("href", "https://www.wowhead.com/classic/item=32837");
    });

    it("says at the field what the server would refuse", async () => {
        render(<Harness onChange={vi.fn()} />);
        const armory = screen.getByRole("textbox", { name: "Armory-Link" });
        await userEvent.clear(armory);
        await userEvent.type(armory, "https://armory.test/no-placeholder");
        expect(screen.getByRole("alert")).toHaveTextContent("Eine http(s)-Adresse mit {char}.");
        expect(armory).toHaveAttribute("aria-invalid", "true");
    });

    it("offers the raidsheets as the version's template and marks the main version", async () => {
        render(<Harness onChange={vi.fn()} mainVersion="forever" />);
        expect(screen.getByText("Hauptversion")).toBeInTheDocument();
        const sheet = screen.getByRole("combobox", { name: "Raidsheet-Vorlage" });
        expect(within(sheet).getAllByRole("option").map((o) => o.textContent)).toEqual(["nur per Stichwort", "Tier 4 / Tier 5"]);
    });

    it("speaks English", async () => {
        await inLang("en", () => {
            render(<Harness onChange={vi.fn()} />);
            expect(screen.getByText("Links and armory per version")).toBeInTheDocument();
            expect(screen.getByRole("textbox", { name: "Wowhead path" })).toHaveValue("tbc");
        });
    });
});

describe("VersionSettingsCard standard values (#553)", () => {
    it("says for which version the values count", () => {
        render(<Harness onChange={vi.fn()} />);
        expect(screen.getByText("Diese Werte gelten nur für TBC Anniversary. Leeres Feld = Link wird weggelassen.")).toBeInTheDocument();
    });

    it("takes Classic's standard values over, realm stays, links follow once a realm is set", async () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        await userEvent.click(screen.getByRole("radio", { name: "Classic" }));
        await userEvent.click(screen.getByRole("button", { name: "Standardwerte übernehmen" }));
        expect(onChange).toHaveBeenLastCalledWith("classic", expect.objectContaining({ wowheadPath: "classic", softresEdition: "classic", blizzardRealmSlug: "" }));
        expect(screen.getByRole("textbox", { name: "Namespace" })).toHaveValue("profile-classic1x-eu");
        expect(screen.queryByRole("link", { name: "Warcraft Logs" })).toBeNull();
        await userEvent.type(screen.getByRole("textbox", { name: "Realm" }), "firemaw");
        expect(screen.getByRole("link", { name: "Warcraft Logs" })).toHaveAttribute("href", "https://vanilla.warcraftlogs.com/character/eu/firemaw/Devihra");
        // everything taken over: nothing left to take
        expect(screen.getByRole("button", { name: "Standardwerte übernehmen" })).toBeDisabled();
    });

    it("has nothing to take over for Forever", async () => {
        render(<Harness onChange={vi.fn()} />);
        await userEvent.click(screen.getByRole("radio", { name: "Forever" }));
        const button = screen.getByRole("button", { name: "Standardwerte übernehmen" });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("data-tip-sub", "Für WoW Forever sind noch keine Standardwerte bekannt.");
    });

    it("speaks English", async () => {
        await inLang("en", () => {
            render(<Harness onChange={vi.fn()} />);
            expect(screen.getByRole("button", { name: "Use standard values" })).toBeInTheDocument();
            expect(screen.getByText("These values apply only to TBC Anniversary. Empty field = the link is left out.")).toBeInTheDocument();
        });
    });
});
