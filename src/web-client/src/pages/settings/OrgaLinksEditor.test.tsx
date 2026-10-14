// The links of a category's Orga-Zentrale: rows like the organizer's, saved through their own API.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { OrgaLink } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import OrgaLinksEditor from "./OrgaLinksEditor";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    saveOrgaLinks: vi.fn(),
}));

const WCL = { label: "WCL", url: "https://www.warcraftlogs.com/x" };

function show(links: OrgaLink[] = [], maxLinks = 5) {
    const onSaved = vi.fn();
    renderPage(<OrgaLinksEditor categoryId="c1" links={links} maxLinks={maxLinks} onSaved={onSaved} />);
    return { onSaved };
}

const labelInput = (n: number) => screen.getByRole("textbox", { name: t("settings.categories.linkLabelAria", { n }) });
const urlInput = (n: number) => screen.getByLabelText(t("settings.categories.linkUrlAria", { n }));
const addButton = () => screen.getByRole("button", { name: t("settings.categories.linkAdd") });
const saveButton = () => screen.getByRole("button", { name: t("settings.categories.linksSave") });

beforeEach(() => {
    vi.mocked(api.saveOrgaLinks).mockReset().mockImplementation(async (categoryId, links) => ({ categoryId, links }));
});

describe("OrgaLinksEditor", () => {
    it("names itself as the orga's links and starts without rows", () => {
        show();
        expect(screen.getByText(t("settings.categories.orgaLinks"))).toBeInTheDocument();
        expect(screen.getByText(t("settings.categories.orgaLinksSub"))).toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("lists the saved links and stops adding at the limit", async () => {
        const user = userEvent.setup();
        show([WCL], 2);
        expect(labelInput(1)).toHaveValue("WCL");
        expect(urlInput(1)).toHaveValue(WCL.url);
        await user.click(addButton());
        expect(addButton()).toBeDisabled();
        await user.click(screen.getByRole("button", { name: t("settings.categories.linkRemove", { n: 2 }) }));
        expect(addButton()).toBeEnabled();
    });

    it("saves the trimmed rows, drops empty ones and reports the saved list", async () => {
        const user = userEvent.setup();
        const { onSaved } = show();
        await user.click(addButton());
        await user.type(labelInput(1), "  Sheet ");
        await user.type(urlInput(1), " https://sheet.example/x ");
        await user.click(addButton());
        await user.click(saveButton());
        expect(api.saveOrgaLinks).toHaveBeenCalledWith("c1", [{ label: "Sheet", url: "https://sheet.example/x" }]);
        expect(onSaved).toHaveBeenCalledWith("c1", [{ label: "Sheet", url: "https://sheet.example/x" }]);
        expect(await screen.findByText(t("settings.categories.linksSaved"))).toBeInTheDocument();
    });

    it("sends the emoji of a link and keeps it after the save", async () => {
        const user = userEvent.setup();
        show([WCL]);
        await user.type(screen.getByLabelText(t("settings.categories.linkEmojiAria", { n: 1 })), "📊");
        await user.click(saveButton());
        expect(api.saveOrgaLinks).toHaveBeenCalledWith("c1", [{ ...WCL, emoji: "📊" }]);
        expect(screen.getByLabelText(t("settings.categories.linkEmojiAria", { n: 1 }))).toHaveValue("📊");
    });

    it("shows the server's refusal and keeps the rows", async () => {
        const user = userEvent.setup();
        vi.mocked(api.saveOrgaLinks).mockRejectedValue({ code: "bad_request", message: "Die Adresse von „A“ steht schon in der Liste." });
        const { onSaved } = show([WCL]);
        await user.click(saveButton());
        expect(await screen.findByText("Die Adresse von „A“ steht schon in der Liste.")).toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
        expect(labelInput(1)).toHaveValue("WCL");
    });
});
