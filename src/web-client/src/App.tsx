import { useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Shell, { firstAllowedTab, TABS } from "./components/Shell";
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
import { JobsProvider } from "./components/Jobs";
import { canAccess, getSession, type ApiError, type Session, type SessionUser } from "./api";

/** Whether the user may open the menu at all (full admin or any granted area). */
function hasMenuAccess(user: SessionUser): boolean {
    return user.isAdmin || TABS.some((t) => canAccess(user, t.area));
}

/**
 * Hides a page the user's roles don't cover. Purely cosmetic — the API refuses
 * the underlying calls either way (src/web/apiAccess.js).
 */
function Guard({ user, area, level = "read", children }: {
    user: SessionUser;
    area: string;
    level?: "read" | "write";
    children: ReactNode;
}) {
    if (canAccess(user, area, level)) return <>{children}</>;
    return (
        <div className="empty">
            {level === "write"
                ? "Für diesen Bereich fehlen dir die Schreibrechte."
                : "Für diesen Bereich hat deine Rolle keine Berechtigung."}
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
    // Full admins see everything; everyone else needs at least one area granted
    // to one of their Discord roles (Einstellungen → Berechtigungen).
    if (!user || !hasMenuAccess(user)) {
        return (
            <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 80 }}>
                <p>{user
                    ? "Dein Discord-Konto hat keinen Zugang zu diesem Menü."
                    : "Bitte melde dich mit Discord an, um das Admin-Menü zu nutzen."}</p>
                {!user && <a className="mlink" href="/auth/login">Mit Discord anmelden</a>}
            </div>
        );
    }

    // A user without the "Übersicht" area would land on an empty start page —
    // send them to the first section they may actually open instead.
    const home = canAccess(user, "dashboard") ? null : firstAllowedTab(user);

    // JobsProvider wraps the router, not a page: that is what lets a running
    // CLA/RPB evaluation survive navigating to another section.
    return (
        <JobsProvider>
            <Routes>
                <Route element={<Shell user={user} csrfToken={csrfToken} guilds={guilds} activeGuildId={activeGuildId} />}>
                    <Route index element={home ? <Navigate to={home.href} replace /> : <DashboardPage />} />
                    <Route path="channels" element={<Guard user={user} area="channels"><ChannelsPage /></Guard>} />
                    <Route path="settings" element={<Guard user={user} area="settings"><SettingsPage /></Guard>} />
                    <Route path="raids" element={<Guard user={user} area="raids"><RaidsPage /></Guard>} />
                    <Route path="raids/new" element={<Guard user={user} area="raids" level="write"><RaidCreatePage /></Guard>} />
                    <Route path="raids/detail" element={<Guard user={user} area="raids"><RaidDetailPage /></Guard>} />
                    <Route path="raids/templates" element={<Guard user={user} area="raids"><NotifyTemplatesPage /></Guard>} />
                    <Route path="recruitment" element={<Guard user={user} area="recruitment"><RecruitmentPage /></Guard>} />
                    <Route path="history" element={<Guard user={user} area="history"><HistoryPage /></Guard>} />
                    <Route path="history/event" element={<Guard user={user} area="history"><HistoryEventPage /></Guard>} />
                    <Route path="history/char" element={<Guard user={user} area="history"><HistoryCharPage /></Guard>} />
                    <Route path="roster" element={<Guard user={user} area="roster"><RosterPage /></Guard>} />
                    {/* Same character page, reached from the roster — the page keeps
                        its back-link pointing at wherever it was opened from. */}
                    <Route path="roster/char" element={<Guard user={user} area="roster"><HistoryCharPage /></Guard>} />
                    <Route path="cla" element={<Guard user={user} area="cla"><ClaPage /></Guard>} />
                </Route>
            </Routes>
        </JobsProvider>
    );
}
