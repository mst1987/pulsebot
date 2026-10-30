// The calm line above the setup editor's stage (#981): who in "Angemeldet" has
// a shadowban - names as links only with read access, nothing without people.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { t } from "../../../../i18n";
import { inLang } from "../../../../test/i18n";
import { ShadowbanPoolLine } from "../ShadowbanPoolLine";

const PEOPLE = [{ userId: "1", name: "Dunkelmond" }, { userId: "2", name: "Grimm" }];

function show(people?: { userId: string; name: string }[] | null, canOpen?: boolean) {
    return render(<MemoryRouter><ShadowbanPoolLine people={people} canOpen={canOpen} /></MemoryRouter>);
}

describe("ShadowbanPoolLine", () => {
    it("is absent without the list and with an empty one", () => {
        expect(show(undefined).container).toBeEmptyDOMElement();
        expect(show(null).container).toBeEmptyDOMElement();
        expect(show([]).container).toBeEmptyDOMElement();
    });

    it("counts the people and names them as links with read access", () => {
        show(PEOPLE, true);
        const line = screen.getByRole("status");
        expect(line).toHaveTextContent(t("vermerke.poolLine", { count: 2 }));
        expect(line).toHaveTextContent("Dunkelmond, Grimm");
        expect(screen.getByRole("link", { name: "Dunkelmond" })).toHaveAttribute("href", "/vermerke?user=1");
        expect(screen.getByRole("img", { name: "Shadowban" })).toHaveAttribute("data-tip-sub", t("vermerke.poolLineTip"));
    });

    it("names them as plain text without read access, one person in the singular", () => {
        show([PEOPLE[0]]);
        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent(t("vermerke.poolLine", { count: 1 }));
        expect(screen.getByText("Dunkelmond")).toBeInTheDocument();
    });

    it("speaks English", async () => {
        await inLang("en", () => {
            show(PEOPLE);
            expect(screen.getByRole("status")).toHaveTextContent("2 people with a shadowban in the pool");
        });
    });
});
