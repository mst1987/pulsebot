// Aufruf-Vorlagen: the list, the editor as a dialog over it (?edit=<id|new>),
// the Discord message it will post previewed next to the fields, and the
// "Entwurf" badge for a changed text. Markdown in the preview becomes React
// nodes — never injected HTML.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderPage } from "../test/render";
import { switchLang } from "../test/i18n";
import NotifyTemplatesPage from "./NotifyTemplatesPage";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getNotifyTemplates: vi.fn(),
    saveNotifyTemplate: vi.fn(),
    deleteNotifyTemplate: vi.fn(),
}));

const KARA = { id: "n1", name: "Kara-Reminder", title: "Anmeldung offen!", body: "Bitte **alle** eintragen" };

beforeEach(() => {
    vi.mocked(api.getNotifyTemplates).mockReset().mockResolvedValue({ templates: [KARA] });
});

const preview = () => screen.getByLabelText("Vorschau der Discord-Nachricht");

describe("Aufruf-Vorlagen", () => {
    it("has no back link above the title — the breadcrumb is the way back", async () => {
        renderPage(<NotifyTemplatesPage />, { route: "/raids/templates" });
        expect(await screen.findByRole("heading", { name: /Aufruf-Vorlagen/ })).toBeInTheDocument();
        expect(screen.getByText("Kara-Reminder")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /Zurück/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/Zurück zur Event-Übersicht/)).not.toBeInTheDocument();
    });

    it("previews the Discord message next to the fields and flags a draft", async () => {
        const user = userEvent.setup();
        renderPage(<NotifyTemplatesPage />, { route: "/raids/templates?edit=n1" });
        const dialog = await screen.findByRole("dialog");
        expect(within(preview()).getByText("Anmeldung offen!")).toBeInTheDocument();
        expect(within(dialog).queryByText("Entwurf")).not.toBeInTheDocument();

        const title = within(dialog).getByLabelText("Titel der Nachricht");
        await user.clear(title);
        await user.type(title, "Heute Kara");
        expect(within(preview()).getByText("Heute Kara")).toBeInTheDocument();
        expect(within(dialog).getByText("Entwurf")).toHaveAttribute("data-tip", "Entwurf");
    });

    it("renders markdown as React nodes, never as injected HTML", async () => {
        const user = userEvent.setup();
        renderPage(<NotifyTemplatesPage />, { route: "/raids/templates?edit=new" });
        const body = await screen.findByRole("textbox", { name: /^Text/ });
        await user.click(body);
        await user.paste("**fett** und *kursiv* ~~weg~~ `code` <@&123> <#456>\n<img src=x onerror=alert(1)>");

        const msg = preview();
        expect(within(msg).getByText("fett").tagName).toBe("B");
        expect(within(msg).getByText("kursiv").tagName).toBe("I");
        expect(within(msg).getByText("weg").tagName).toBe("S");
        expect(within(msg).getByText("code").tagName).toBe("CODE");
        expect(within(msg).getAllByText("@Rolle").length).toBeGreaterThan(1);
        expect(within(msg).getByText("#kanal")).toBeInTheDocument();
        // HTML stays text, as it would in Discord
        expect(msg.querySelector("img[src=\"x\"]")).toBeNull();
        expect(msg).toHaveTextContent("<img src=x onerror=alert(1)>");
    });
});

describe("Aufruf-Vorlagen in English", () => {
    afterEach(() => switchLang("de"));

    it("names the list, the editor and the Discord preview in English", async () => {
        await switchLang("en");
        renderPage(<NotifyTemplatesPage />, { route: "/raids/templates?edit=n1" });
        const dialog = await screen.findByRole("dialog");
        expect(screen.getByRole("heading", { name: /Call templates/ })).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Message title")).toHaveValue("Anmeldung offen!");
        const msg = screen.getByLabelText("Preview of the Discord message");
        expect(within(msg).getByText("@role")).toBeInTheDocument();
        expect(within(msg).getByText(/^Today at /)).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    });
});
