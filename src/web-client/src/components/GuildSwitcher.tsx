import { useState } from "react";
import { switchGuild, type ApiError, type SessionGuild } from "../api";

// Topbar server switcher — mirrors src/web/renderAdmin.js's renderServerBar(),
// but via fetch() instead of a form POST + redirect, so switching guilds
// doesn't navigate away from the current page.
export default function GuildSwitcher({ guilds, activeGuildId, csrfToken }: {
    guilds: SessionGuild[];
    activeGuildId: string;
    csrfToken: string | null;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!guilds.length) {
        return <span className="hint">Bot ist mit keinem Server verbunden (noch nicht bereit?).</span>;
    }

    if (guilds.length === 1) {
        return <span className="serverbar-single">{guilds[0].name}</span>;
    }

    const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const guildId = e.target.value;
        setBusy(true);
        setError(null);
        try {
            await switchGuild(csrfToken, guildId);
            window.location.reload();
        } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
        }
    };

    return (
        <div className="serverbar">
            <label>Server:</label>
            <select className="sel-sm" value={activeGuildId} onChange={onChange} disabled={busy}>
                {!activeGuildId && <option value="">— Server wählen —</option>}
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {!activeGuildId && !error && <span className="hint">← bitte zuerst einen Server wählen</span>}
            {error && <span className="hint" style={{ color: "var(--high)" }}>{error}</span>}
        </div>
    );
}
