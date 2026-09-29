// The loot history's "Charaktere" tab per game version (#543): the main version
// first, another version or "Alle" one click away.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotatedCharacter } from "../../api";
import { renderPage } from "../../test/render";
import { CharactersTab } from "./CharactersTab";

function char(character: string, versionIds: string[]): AnnotatedCharacter {
    return {
        key: character.toLowerCase(), character, realm: "", count: 1, categoryIds: [], items: [],
        className: "Mage", spec: "Frost", source: "export", reportId: "", classColor: "", iconUrl: "", versionIds,
    };
}

const CHARS = [char("Anna", ["tbc"]), char("Devi Res", ["forever"])];
const VERSIONS = [
    { id: "tbc", label: "TBC Anniversary", short: "TBC", count: 1 },
    { id: "forever", label: "WoW Forever", short: "Forever", count: 1 },
];

beforeEach(() => localStorage.clear());

describe("CharactersTab per game version (#543)", () => {
    it("shows the main version first and switches to another one or all", async () => {
        const user = userEvent.setup();
        renderPage(<CharactersTab chars={CHARS} categories={[]} onChanged={() => undefined} versions={VERSIONS} mainVersion="tbc" />);
        expect(screen.getByText("Anna")).toBeInTheDocument();
        expect(screen.queryByText("Devi Res")).not.toBeInTheDocument();

        const picker = screen.getByRole("radiogroup", { name: "Spielversion" });
        await user.click(within(picker).getByRole("radio", { name: "Forever · 1" }));
        expect(screen.getByText("Devi Res")).toBeInTheDocument();
        expect(screen.queryByText("Anna")).not.toBeInTheDocument();

        await user.click(within(screen.getByRole("radiogroup", { name: "Spielversion" })).getByRole("radio", { name: "Alle" }));
        expect(screen.getByText("Anna")).toBeInTheDocument();
        expect(screen.getByText("Devi Res")).toBeInTheDocument();
    });

    it("has no filter with a single version", () => {
        renderPage(<CharactersTab chars={[CHARS[0]]} categories={[]} onChanged={() => undefined} versions={[VERSIONS[0]]} mainVersion="tbc" />);
        expect(screen.queryByRole("radiogroup", { name: "Spielversion" })).not.toBeInTheDocument();
        expect(screen.getByText("Anna")).toBeInTheDocument();
    });
});
