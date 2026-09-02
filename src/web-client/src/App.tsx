import { useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import Shell, { firstAllowedTab } from "./components/Shell";
import DashboardPage from "./pages/DashboardPage";
import ChannelsPage from "./pages/ChannelsPage";
import SettingsPage from "./pages/SettingsPage";
import RaidsPage from "./pages/RaidsPage";
import RaidCreatePage from "./pages/RaidCreatePage";
import RaidDetailPage from "./pages/RaidDetailPage";
import NotifyTemplatesPage from "./pages/NotifyTemplatesPage";
import RecruitmentPage from "./pages/RecruitmentPage";
import HistoryPage from "./pages/HistoryPage";
import HistoryEventPage from "./pages/HistoryEventPage";
import HistoryCharPage from "./pages/HistoryCharPage";
import RosterPage from "./pages/RosterPage";
import ClaPage from "./pages/ClaPage";
import LootCouncilPage from "./pages/LootCouncilPage";
import { JobsProvider } from "./components/Jobs";
import { canAccess, canAccessAny, getSession, type ApiError, type Session, type SessionUser } from "./api";

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
    if (canAccessAny(user, areas, level)) return <>{children}</>;
    return (
        <div className="empty">
            {level === "write"
                ? "Für diesen Bereich fehlen dir die Schreibrechte."
                : "Für diesen Bereich hat deine Rolle keine Berechtigung."}
        </div>
    );
}

/** Start page for an account no area is open to — it still gets the shell. */
function NoAreaNotice() {
    return (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", paddingTop: 60 }}>
            <p>Dein Discord-Konto hat noch keinen Zugang zu diesem Menü.</p>
            <p className="hint">Ein Admin kann dir in den Einstellungen unter „Berechtigungen" Bereiche freischalten.</p>
        </div>
    );
}

/**
 * A path no route claims. The server hands every unknown GET to the client
 * (staticClient.js), so without this the page would simply stay blank.
 */
function NotFound() {
    return (
        <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", paddingTop: 60 }}>
            <p>Diese Seite gibt es nicht.</p>
            <Link className="mlink" to="/">Zurück zur Übersicht</Link>
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
            .then((session) => setState({ status: "ready", session }))
            .catch((error: ApiError) => setState({ status: "error", error }));
    }, []);

    return state;
}

export default function App() {
    const state = useSession();

    if (state.status === "loading") return <div className="empty">Lade…</div>;
    if (state.status === "error") {
        return <div className="empty">Fehler beim Laden der Session: {state.error.message}</div>;
    }

    const { user, csrfToken, guilds, activeGuildId } = state.session;
    // Not logged in is the one case without a shell: there is no user to put in
    // its footer and nothing to navigate to, only the way in.
    if (!user) {
        return (
            <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 80 }}>
                <p>Bitte melde dich mit Discord an, um das Gildenmenü zu nutzen.</p>
                <a className="mlink" href="/auth/login">Mit Discord anmelden</a>
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
    return (
        <JobsProvider>
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
                    <Route path="recruitment" element={<Guard user={user} areas={["recruitment"]}><RecruitmentPage /></Guard>} />
                    {/* "loot" opens the same three pages, cut down to the loot views. */}
                    <Route path="history" element={<Guard user={user} areas={["history", "loot"]}><HistoryPage /></Guard>} />
                    <Route path="history/event" element={<Guard user={user} areas={["history", "loot"]}><HistoryEventPage /></Guard>} />
                    <Route path="history/char" element={<Guard user={user} areas={["history", "loot"]}><HistoryCharPage /></Guard>} />
                    <Route path="roster" element={<Guard user={user} areas={["roster"]}><RosterPage /></Guard>} />
                    {/* Same character page, reached from the roster — the page keeps
                        its back-link pointing at wherever it was opened from. */}
                    <Route path="roster/char" element={<Guard user={user} areas={["roster"]}><HistoryCharPage /></Guard>} />
                    <Route path="cla" element={<Guard user={user} areas={["cla"]}><ClaPage /></Guard>} />
                    <Route path="lootcouncil" element={<Guard user={user} areas={["lootcouncil"]}><LootCouncilPage /></Guard>} />
                    {/* Inside the shell on purpose: a mistyped path should still
                        leave the menu (and the way back) standing. */}
                    <Route path="*" element={<NotFound />} />
                </Route>
            </Routes>
        </JobsProvider>
    );
}
