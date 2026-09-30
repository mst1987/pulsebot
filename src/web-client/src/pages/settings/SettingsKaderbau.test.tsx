// The Kaderbau card in Einstellungen → Verbindungen: the tokens of the local
// roster-builder app (docs/kaderbau.md) — listed without secrets, minted with
// the secret shown exactly once, revoked behind a confirm. Its own API (ehk_),
// never the loot-sync tokens'.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { IngestToken } from "../../api";
import { renderPage } from "../../test/render";
import KaderbauCard from "./SettingsKaderbau";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getKaderTokens: vi.fn(),
    createKaderToken: vi.fn(),
    deleteKaderToken: vi.fn(),
    createIngestToken: vi.fn(),
    deleteIngestToken: vi.fn(),
}));

const token = (over: Partial<IngestToken> = {}): IngestToken => ({
    id: "k1", name: "Raidlead-PC", hint: "a1b2", createdAt: Date.UTC(2026, 8, 1), createdBy: "Admin", lastUsedAt: 0, uses: 0, ...over,
});

beforeEach(() => {
    vi.mocked(api.getKaderTokens).mockReset().mockResolvedValue({ tokens: [] });
    vi.mocked(api.createKaderToken).mockReset();
    vi.mocked(api.deleteKaderToken).mockReset().mockResolvedValue({ id: "k1" });
    vi.mocked(api.createIngestToken).mockReset();
    vi.mocked(api.deleteIngestToken).mockReset();
});

describe("KaderbauCard", () => {
    it("shows the endpoint and how many tokens exist", async () => {
        vi.mocked(api.getKaderTokens).mockResolvedValue({ tokens: [token(), token({ id: "k2", name: "Laptop" })] });
        renderPage(<KaderbauCard />);
        expect(await screen.findByText("2 Tokens")).toBeInTheDocument();
        expect(screen.getByText("/api/kader/export")).toBeInTheDocument();
        expect(screen.getByText("Kaderbau")).toBeInTheDocument();
    });

    it("names the last fetch, or none yet", async () => {
        vi.mocked(api.getKaderTokens).mockResolvedValue({ tokens: [token({ lastUsedAt: Date.UTC(2026, 8, 20), uses: 3 })] });
        renderPage(<KaderbauCard />);
        expect(await screen.findByText(/Raidlead-PC$/)).toBeInTheDocument();
    });

    it("mints a token through the Kaderbau API and shows its secret once", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createKaderToken).mockResolvedValue({ token: "ehk_secretsecret", record: token() });
        renderPage(<KaderbauCard />);
        await screen.findByText("0 Tokens");
        await user.click(screen.getByRole("button", { name: /Tokens verwalten/ }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Kaderbau-Tokens")).toBeInTheDocument();

        await user.type(within(dialog).getByPlaceholderText(/Raidlead-PC/), "Raidlead-PC");
        vi.mocked(api.getKaderTokens).mockResolvedValue({ tokens: [token()] });
        await user.click(within(dialog).getByRole("button", { name: /Token erstellen/ }));

        expect(api.createKaderToken).toHaveBeenCalledWith("Raidlead-PC");
        expect(api.createIngestToken).not.toHaveBeenCalled();
        expect(await within(dialog).findByDisplayValue("ehk_secretsecret")).toBeInTheDocument();
        expect(within(dialog).getByText("nur einmal sichtbar")).toBeInTheDocument();
        // the list shows the prefix and the hint, never the secret
        expect(await within(dialog).findByText("ehk_…a1b2")).toBeInTheDocument();
        expect(within(dialog).getByText("Abrufe")).toBeInTheDocument();
    });

    it("revokes a token after the confirm", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getKaderTokens).mockResolvedValue({ tokens: [token()] });
        renderPage(<KaderbauCard />);
        await screen.findByText("1 Token");
        await user.click(screen.getByRole("button", { name: /Tokens verwalten/ }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Token zurückziehen" }));
        await user.click(await screen.findByRole("button", { name: "Zurückziehen" }));
        await waitFor(() => expect(api.deleteKaderToken).toHaveBeenCalledWith("k1"));
        expect(api.deleteIngestToken).not.toHaveBeenCalled();
    });
});
