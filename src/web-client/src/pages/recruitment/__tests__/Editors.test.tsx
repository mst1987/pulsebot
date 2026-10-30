// Editing a posted forum post: the text is always saved; when Discord refuses
// the new title for now (two renames per ten minutes) the editor says so.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { RecruitmentData, RecruitmentPost } from "../../../api";
import { renderPage } from "../../../test/render";
import { PostEditor } from "../Editors";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    updateRecruitmentPost: vi.fn(),
}));

const post = {
    id: "p1", guildId: "g1", channelId: "th1", parentChannelId: "f1", messageId: "m1", channelName: "gilden-suchen",
    content: "Komm zu uns!", title: "", body: "", buttonLabel: "Server beitreten", buttonKind: "link",
    linkUrl: "https://discord.gg/abc", forumTitle: "Nachtwache sucht", source: "web", templateId: "t1", versionId: "tbc", postedAt: 0,
} as unknown as RecruitmentPost;

const data = {
    view: "", guildName: "Pulse", editing: null, editingPost: null, templates: [], posts: [post],
    channels: [], targets: [], emojis: [], specCatalog: [], applications: [], applicationsError: null,
    applicationChannelId: "", activeGuildId: "g1", gameVersions: [], mainVersion: "tbc",
} as unknown as RecruitmentData;

function open() {
    const onSaved = vi.fn();
    renderPage(<PostEditor data={data} post={post} templateName="" onSaved={onSaved} onClose={() => {}} />);
    return { onSaved };
}

beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(api.updateRecruitmentPost).mockReset();
});

describe("PostEditor of a forum post", () => {
    it("saves and warns when Discord refuses the new title for now", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateRecruitmentPost).mockResolvedValue({ ...post, notice: "title_rate_limited" });
        const { onSaved } = open();
        const title = screen.getByLabelText(/Titel des Forum-Beitrags/);
        await user.clear(title);
        await user.type(title, "Nachtwache sucht Heiler");
        await user.click(screen.getByRole("button", { name: /Speichern & in Discord aktualisieren/ }));
        await waitFor(() => expect(api.updateRecruitmentPost).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", forumTitle: "Nachtwache sucht Heiler" })));
        expect(await screen.findByText(/Discord erlaubt 2 Umbenennungen je 10 Minuten/)).toBeInTheDocument();
        expect(onSaved).toHaveBeenCalledWith("Nachricht in Discord aktualisiert.");
    });

    it("saves without a warning when the title went through", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateRecruitmentPost).mockResolvedValue({ ...post, notice: "" });
        const { onSaved } = open();
        await user.click(screen.getByRole("button", { name: /Speichern & in Discord aktualisieren/ }));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(screen.queryByText(/Umbenennungen/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Titel konnte nicht/)).not.toBeInTheDocument();
    });

    it("shows a refused save's reason and does not report it as saved", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateRecruitmentPost).mockRejectedValue({ code: "thread_locked", message: "Der Beitrag ist gesperrt." });
        const { onSaved } = open();
        await user.click(screen.getByRole("button", { name: /Speichern & in Discord aktualisieren/ }));
        expect(await screen.findByText("Der Beitrag ist gesperrt.")).toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });
});
