// AllSettingsLink (#957 review): a full admin gets the deep link into Alle Server ›
// Einstellungen; everybody else the hint, the plain words or nothing.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { adminUser, renderPage } from "../../../test/render";
import { switchLang } from "../../../test/i18n";
import AllSettingsLink from "../AllSettingsLink";

const writer = () => adminUser({ isAdmin: false, access: { settings: { read: true, write: true } } });

afterEach(() => switchLang("de"));

describe("AllSettingsLink", () => {
    it("links a full admin straight to the section on Alle Server", () => {
        renderPage(<AllSettingsLink section="verbindungen">Zu den Verbindungen</AllSettingsLink>);
        expect(screen.getByRole("link", { name: "Zu den Verbindungen" })).toHaveAttribute("href", "/settings/all?section=verbindungen");
    });

    it("tells everybody else that a full admin sets it up", () => {
        renderPage(<AllSettingsLink section="verbindungen">Zu den Verbindungen</AllSettingsLink>, { user: writer() });
        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.getByText("Das richtet ein Voll-Admin unter Alle Server › Einstellungen ein.")).toBeInTheDocument();
    });

    it("keeps the words inside a sentence, with the hint as tooltip", () => {
        renderPage(<p>Siehe <AllSettingsLink inline section="spielversion">Spielversion</AllSettingsLink>.</p>, { user: writer() });
        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.getByText("Spielversion")).toHaveAttribute("data-tip", "Das richtet ein Voll-Admin unter Alle Server › Einstellungen ein.");
    });

    it("shows nothing for a head button", () => {
        const { container } = renderPage(<div data-testid="head"><AllSettingsLink hide section="verbindungen">Token</AllSettingsLink></div>, { user: writer() });
        expect(container.querySelector("[data-testid=head]")).toBeEmptyDOMElement();
    });

    it("words the hint in English", async () => {
        await switchLang("en");
        renderPage(<AllSettingsLink section="verbindungen">Connections</AllSettingsLink>, { user: writer() });
        expect(screen.getByText("A full admin sets this up under All servers › Settings.")).toBeInTheDocument();
    });
});
