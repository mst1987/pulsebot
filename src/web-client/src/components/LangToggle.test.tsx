// The language switch (#435: the behaviour part of test/web-client/i18n.test.js,
// "the language switch"): kept in the browser, saved for the account, applied
// to <html lang>, and a failed save changes nothing.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { getLang, t } from "../i18n";
import { switchLang } from "../test/i18n";
import LangToggle from "./LangToggle";

vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), saveLang: vi.fn() }));

afterEach(() => switchLang("de"));

describe("the language switch", () => {
    it("remembers the choice in the browser and labels the document", async () => {
        render(<LangToggle />);
        expect(screen.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(screen.getByRole("button", { name: t("shell.lang.switchTo", { lang: "English" }) }));
        await waitFor(() => expect(getLang()).toBe("en"));
        expect(window.localStorage.getItem("eh-lang")).toBe("en");
        expect(document.documentElement).toHaveAttribute("lang", "en");
        expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
        expect(api.saveLang).not.toHaveBeenCalled();
    });

    it("saves it for the account too, and a failed save changes nothing", async () => {
        vi.mocked(api.saveLang).mockRejectedValue({ code: "http_500", message: "down" });
        render(<LangToggle account />);
        await userEvent.click(screen.getByRole("button", { name: t("shell.lang.switchTo", { lang: "English" }) }));
        expect(api.saveLang).toHaveBeenCalledWith("en");
        await waitFor(() => expect(getLang()).toBe("en"));
        expect(window.localStorage.getItem("eh-lang")).toBe("en");
    });

    it("does nothing on a click on the active language", async () => {
        render(<LangToggle account />);
        await userEvent.click(screen.getByRole("button", { name: "Deutsch" }));
        expect(api.saveLang).not.toHaveBeenCalled();
        expect(getLang()).toBe("de");
    });
});
