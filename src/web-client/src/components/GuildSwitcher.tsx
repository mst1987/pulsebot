import { useState } from "react";
import { switchGuild, type ApiError, type SessionGuild } from "../api";
import { useToast } from "./Jobs";
import WowIcon from "./ui/WowIcon";
import Badge from "./ui/Badge";

// The guild crest in front of every form of the switcher.
const GUILD_ICON = "inv_misc_tabardpvp_01";

// Topbar server switcher — mirrors src/web/renderAdmin.js's renderServerBar(),
// but via fetch() instead of a form POST + redirect, so switching guilds
// doesn't navigate away from the current page.
export default function GuildSwitcher({ guilds, activeGuildId, csrfToken }: {
    guilds: SessionGuild[];
    activeGuildId: string;
    csrfToken: string | null;
}) {
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    if (!guilds.length) {
        return (
            <Badge tone="mid" icon={GUILD_ICON} tip="Kein Server verbunden" tipSub="Der Bot ist mit keinem Discord-Server verbunden – vermutlich ist er noch nicht bereit.">
                Kein Server
            </Badge>
        );
    }

    if (guilds.length === 1) {
        return (
            <span className="guild-sel is-single">
                <WowIcon name={GUILD_ICON} size={22} />
                <span>{guilds[0].name}</span>
            </span>
        );
    }

    const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const guildId = e.target.value;
        setBusy(true);
        try {
            await switchGuild(csrfToken, guildId);
            // No success toast: the reload below wipes the page anyway, and the
            // switcher then simply shows the server that was picked.
            window.location.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy(false);
        }
    };

    return (
        <div className="guild-sel">
            <WowIcon name={GUILD_ICON} size={22} />
            <select value={activeGuildId} onChange={onChange} disabled={busy} aria-label="Server wählen">
                {!activeGuildId && <option value="">Server wählen</option>}
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {!activeGuildId && (
                <Badge tone="mid" tip="Kein Server gewählt" tipSub="Bitte zuerst einen Server wählen – die Bereiche zeigen erst dann seine Daten.">
                    Kein Server gewählt
                </Badge>
            )}
        </div>
    );
}
