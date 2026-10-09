// Renders a page or component the way the app does (App.tsx, Shell.tsx):
// inside the JobsProvider/ConfirmProvider, a MemoryRouter at `route`, and an
// Outlet context that hands the page its `user` like the shell does. The API
// is never real in a test: mock "../api" (or the one api/<area> module) with
// vi.mock in the test file.
//
//   vi.mock("../api", async (orig) => ({ ...(await orig()), getChannels: vi.fn() }));
//   renderPage(<ChannelsPage />, { route: "/channels?tab=archive" });
//   expect(await screen.findByText("…")).toBeInTheDocument();
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { JobsProvider } from "../components/shell/Jobs";
import { ConfirmProvider } from "../components/ui/Modal";
import type { ContentInfo, SessionUser } from "../api";
import ContentVersionProvider from "../components/shell/ContentVersionProvider";
import ContentSwitch from "../components/shell/ContentSwitch";

/** A full admin: every area open. Override fields to test a narrower account. */
export function adminUser(over: Partial<SessionUser> = {}): SessionUser {
    return { id: "u1", name: "Admin", isAdmin: true, access: {}, ...over };
}

export type RenderPageOptions = {
    /** The URL the router starts at (path plus query). */
    route?: string;
    /** The route pattern the element sits under, for pages that read useParams. */
    path?: string;
    /** The signed-in account the shell would pass down. */
    user?: SessionUser;
    /**
     * The menu's content switch (#563): with it the page sits inside the
     * ContentVersionProvider and the switch is rendered above it, like the
     * shell's top bar; without it the page reads "" (the server's main version).
     */
    content?: ContentInfo;
};

export function renderPage(ui: ReactElement, { route = "/", path = "*", user = adminUser(), content }: RenderPageOptions = {}): RenderResult {
    const page = (
        <JobsProvider>
            <ConfirmProvider>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route element={<Outlet context={{ user }} />}>
                            <Route path={path} element={ui} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </ConfirmProvider>
        </JobsProvider>
    );
    if (!content) return render(page);
    return render(
        <ContentVersionProvider content={content}>
            <ContentSwitch />
            {page}
        </ContentVersionProvider>,
    );
}

/** The content switch of a guild with TBC (main) and Forever data (#563); `over` changes single fields. */
export function twoVersions(over: Partial<ContentInfo> = {}): ContentInfo {
    return {
        mainVersion: "tbc", hideOtherVersions: false,
        versions: [{ id: "tbc", label: "WoW TBC", short: "TBC" }, { id: "forever", label: "WoW Forever", short: "Forever" }],
        ...over,
    };
}

/** The radio group of the content switch (the wide segment; the phone chip opens a second one). */
export const CONTENT_ARIA = "shell.content.aria";
