// The loot history's "Charaktere" tab per game version (#543): the characters
// of the version the menu's content switch shows (#563); no filter of its own.
import { screen } from "@testing-library/react";
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

beforeEach(() => localStorage.clear());

describe("CharactersTab per game version (#543, #563)", () => {
    it("shows only the characters of the version it is handed", () => {
        const view = renderPage(<CharactersTab chars={CHARS} categories={[]} onChanged={() => undefined} version="tbc" />);
        expect(screen.getByText("Anna")).toBeInTheDocument();
        expect(screen.queryByText("Devi Res")).not.toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: "Spielversion" })).not.toBeInTheDocument();
        view.unmount();

        renderPage(<CharactersTab chars={CHARS} categories={[]} onChanged={() => undefined} version="forever" />);
        expect(screen.getByText("Devi Res")).toBeInTheDocument();
        expect(screen.queryByText("Anna")).not.toBeInTheDocument();
    });

    it("shows everyone without a version (no session content)", () => {
        renderPage(<CharactersTab chars={CHARS} categories={[]} onChanged={() => undefined} />);
        expect(screen.getByText("Anna")).toBeInTheDocument();
        expect(screen.getByText("Devi Res")).toBeInTheDocument();
    });
});
