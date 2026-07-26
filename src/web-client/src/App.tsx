import { useEffect, useState } from "react";

type SessionResponse = {
    data: {
        user: { id: string; name: string; isAdmin: boolean } | null;
        csrfToken: string | null;
    };
};

function App() {
    const [session, setSession] = useState<SessionResponse["data"] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/session", { credentials: "include" })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<SessionResponse>;
            })
            .then((body) => setSession(body.data))
            .catch((err) => setError(String(err)));
    }, []);

    return (
        <main>
            <h1>EventHelper Admin (React) — Phase 0</h1>
            <p>Diese Seite belegt nur, dass Vite-Dev-Server, API-Proxy und der neue /api-Layer zusammenspielen.</p>
            {error && <p style={{ color: "crimson" }}>Fehler beim Laden der Session: {error}</p>}
            {!error && !session && <p>Lade Session…</p>}
            {session && <pre>{JSON.stringify(session, null, 2)}</pre>}
        </main>
    );
}

export default App;
