import { useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import Shell, { firstAllowedTab } from "./components/Shell";
import DashboardPage from "./pages/DashboardPage";
import ChannelsPage from "./pages/ChannelsPage";
import SettingsPage from "./pages/SettingsPage";
import RaidsPage from "./pages/RaidsPage";
import RaidCreatePage from "./pages/RaidCreatePage";
import RaidDetailPage from "./pages/RaidDetailPage";
import NotifyTemplatesPage from "./pages/NotifyTemplatesPage";
import RaidTemplatesPage from "./pages/RaidTemplatesPage";
import EventSeriesPage from "./pages/EventSeriesPage";
import RecruitmentPage from "./pages/RecruitmentPage";
import HistoryPage from "./pages/HistoryPage";
import HistoryEventPage from "./pages/HistoryEventPage";
import HistoryInboxPage from "./pages/HistoryInboxPage";
import HistoryCharPage from "./pages/HistoryCharPage";
import RosterPage from "./pages/RosterPage";
import ProfilePage from "./pages/ProfilePage";
import SignupsPage from "./pages/SignupsPage";
import ClaPage from "./pages/ClaPage";
import LootCouncilPage from "./pages/LootCouncilPage";
import DropCheckPage from "./pages/lootcouncil/DropCheckPage";
import { JobsProvider } from "./components/Jobs";
import { ConfirmProvider } from "./components/ui/Modal";
import { canAccess, canAccessAny, getSession, type ApiError, type Session, type SessionUser } from "./api";
import { getLang, setLang, useT } from "./i18n";
import RaidLoader from "./components/ui/RaidLoader";
import LangToggle from "./components/LangToggle";
import PlanPublicPage from "./pages/PlanPublicPage";

/**
 * Hides a page the user's rights don't cover. `areas` is an OR — one of them at
 * the given level is enough, which is how "Historie & Loot" opens either for
 * "history" or for the narrower "loot". Purely cosmetic: the API refuses the
 * underlying calls either way (src/web/apiAccess.js).
 */
function Guard({ user, areas, level = "read", children }: {
    user: SessionUser;
    areas: string[];
    level?: "read" | "write";
    children: ReactNode;
}) {
    const t = useT();
    if (canAccessAny(user, areas, level)) return <>{children}</>;
    return (
        <div className="empty">
            {level === "write" ? t("shell.app.noWrite") : t("shell.app.noRead")}
        </div>
    );
}

/** Start page for an account no area is open to — it still gets the shell. */
function NoAreaNotice() {
    const t = useT();
    return (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", paddingTop: 60 }}>
            <p>{t("shell.app.noAccess")}</p>
            <p className="hint">{t("shell.app.noAccessHint")}</p>
        </div>
    );
}

/**
 * A path no route claims. The server hands every unknown GET to the client
 * (staticClient.js), so without this the page would simply stay blank.
 */
function NotFound() {
    const t = useT();
    return (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", paddingTop: 60 }}>
            <p>{t("shell.app.notFound")}</p>
            <Link className="mlink" to="/">{t("shell.app.backHome")}</Link>
        </div>
    );
}

type LoadState =
    | { status: "loading" }
    | { status: "ready"; session: Session }
    | { status: "error"; error: ApiError };

function useSession(): LoadState {
    const [state, setState] = useState<LoadState>({ status: "loading" });

    useEffect(() => {
        getSession()
            .then((session) => {
                // The account's saved language wins over this browser's: it is
                // what makes the choice follow the user to another device.
                const saved = session.user && session.user.lang;
                if (saved && saved !== getLang()) setLang(saved);
                setState({ status: "ready", session });
            })
            .catch((error: ApiError) => setState({ status: "error", error }));
    }, []);

    return state;
}

/**
 * The public read view of a raid plan, /p/<token>, needs no login and no menu:
 * it is answered before the session is even asked for (the token in the address
 * is its authentication, see PlanPublicPage). Everything else is the menu.
 */
export default function App() {
    const { pathname } = useLocation();
    const publicPlan = pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
    if (publicPlan) return <PlanPublicPage token={publicPlan[1]} />;
    return <MenuApp />;
}

function MenuApp() {
    const state = useSession();
    const t = useT();

    if (state.status === "loading") return <RaidLoader text={t("shell.app.loadingMenu")} />;
    if (state.status === "error") {
        return <div className="empty">{t("shell.app.sessionError", { message: state.error.message })}</div>;
    }

    const { user, csrfToken, guilds, activeGuildId } = state.session;
    // Not logged in is the one case without a shell: there is no user to put in
    // its footer and nothing to navigate to, only the way in.
    if (!user) {
        return (
            <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 80 }}>
                <p>{t("shell.app.loginPrompt")}</p>
                <a className="mlink" href="/auth/login">{t("shell.app.loginButton")}</a>
                {/* The one switch a visitor gets before logging in — kept in the browser only. */}
                <LangToggle />
            </div>
        );
    }

    // Anyone logged in gets the shell, even with nothing granted: the sidebar
    // says what is (not) open to them and, above all, the logout is in it. What
    // they may actually open is decided per tab and per route below.
    const start = firstAllowedTab(user);
    // A user without the "Übersicht" area would land on an empty start page —
    // send them to the first section they may actually open instead.
    const home = canAccess(user, "dashboard") ? null : start;

    // JobsProvider wraps the router, not a page: that is what lets a running
    // CLA/RPB evaluation survive navigating to another section.
    // ConfirmProvider sits there too: a job can still ask ("Raid nicht beendet")
    // after its page is gone.
    return (
        <JobsProvider>
            <ConfirmProvider>
                <Routes>
                    <Route element={<Shell user={user} csrfToken={csrfToken} guilds={guilds} activeGuildId={activeGuildId} />}>
                        <Route index element={
                            canAccess(user, "dashboard")
                                ? <DashboardPage />
                                : home
                                    ? <Navigate to={home.href} replace />
                                    : <NoAreaNotice />
                        } />
                        <Route path="channels" element={<Guard user={user} areas={["channels"]}><ChannelsPage /></Guard>} />
                        <Route path="settings" element={<Guard user={user} areas={["settings"]}><SettingsPage /></Guard>} />
                        <Route path="raids" element={<Guard user={user} areas={["raids"]}><RaidsPage /></Guard>} />
                        <Route path="raids/new" element={<Guard user={user} areas={["raids"]} level="write"><RaidCreatePage /></Guard>} />
                        <Route path="raids/detail" element={<Guard user={user} areas={["raids"]}><RaidDetailPage /></Guard>} />
                        <Route path="raids/templates" element={<Guard user={user} areas={["raids"]}><NotifyTemplatesPage /></Guard>} />
                        <Route path="raids/raid-templates" element={<Guard user={user} areas={["raids"]}><RaidTemplatesPage /></Guard>} />
                        <Route path="raids/series" element={<Guard user={user} areas={["raids"]}><EventSeriesPage /></Guard>} />
                        <Route path="recruitment" element={<Guard user={user} areas={["recruitment"]}><RecruitmentPage /></Guard>} />
                        {/* "loot" opens the same three pages, cut down to the loot views. */}
                        <Route path="history" element={<Guard user={user} areas={["history", "loot"]}><HistoryPage /></Guard>} />
                        {/* The addon inbox is not open to the read-only "loot" area. */}
                        <Route path="history/inbox" element={<Guard user={user} areas={["history"]}><HistoryInboxPage /></Guard>} />
                        <Route path="history/event" element={<Guard user={user} areas={["history", "loot"]}><HistoryEventPage /></Guard>} />
                        <Route path="history/char" element={<Guard user={user} areas={["history", "loot"]}><HistoryCharPage /></Guard>} />
                        {/* The member self-service page: always the own account (area "signup"). */}
                        <Route path="profile" element={<Guard user={user} areas={["signup"]}><ProfilePage /></Guard>} />
                        {/* The member's coming raids and their own signup (area "signup", #256). */}
                        <Route path="signups" element={<Guard user={user} areas={["signup"]}><SignupsPage /></Guard>} />
                        <Route path="roster" element={<Guard user={user} areas={["roster"]}><RosterPage /></Guard>} />
                        {/* Same character page, reached from the roster — the page keeps
                            its back-link pointing at wherever it was opened from. */}
                        <Route path="roster/char" element={<Guard user={user} areas={["roster"]}><HistoryCharPage /></Guard>} />
                        <Route path="cla" element={<Guard user={user} areas={["cla"]}><ClaPage /></Guard>} />
                        <Route path="lootcouncil" element={<Guard user={user} areas={["lootcouncil"]}><LootCouncilPage /></Guard>} />
                        <Route path="lootcouncil/drop/:itemId?" element={<Guard user={user} areas={["lootcouncil"]}><DropCheckPage /></Guard>} />
                        {/* Inside the shell on purpose: a mistyped path should still
                            leave the menu (and the way back) standing. */}
                        <Route path="*" element={<NotFound />} />
                    </Route>
                </Routes>
            </ConfirmProvider>
        </JobsProvider>
    );
}
