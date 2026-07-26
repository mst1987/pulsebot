import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Shell from "./components/Shell";
import DashboardPage from "./pages/DashboardPage";
import ChannelsPage from "./pages/ChannelsPage";
import SettingsPage from "./pages/SettingsPage";
import RaidsPage from "./pages/RaidsPage";
import RaidCreatePage from "./pages/RaidCreatePage";
import { getSession, type ApiError, type Session } from "./api";

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

    const { user, csrfToken } = state.session;
    if (!user || !user.isAdmin) {
        return (
            <div className="empty" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 80 }}>
                <p>{user
                    ? "Dein Discord-Konto hat keinen Admin-Zugang zu diesem Menü."
                    : "Bitte melde dich mit Discord an, um das Admin-Menü zu nutzen."}</p>
                {!user && <a className="mlink" href="/auth/login">Mit Discord anmelden</a>}
            </div>
        );
    }

    return (
        <Routes>
            <Route element={<Shell user={user} csrfToken={csrfToken} />}>
                <Route index element={<DashboardPage />} />
                <Route path="channels" element={<ChannelsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="raids" element={<RaidsPage />} />
                <Route path="raids/new" element={<RaidCreatePage />} />
            </Route>
        </Routes>
    );
}
