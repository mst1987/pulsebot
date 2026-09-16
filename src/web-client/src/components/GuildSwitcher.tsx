import { useState } from "react";
import { switchGuild, type ApiError, type GuildRole, type SessionGuild } from "../api";
import { useToast } from "./Jobs";
import WowIcon from "./ui/WowIcon";
import Badge from "./ui/Badge";

// The guild crest in front of every form of the switcher.
const GUILD_ICON = "inv_misc_tabardpvp_01";

// The fixed role a server has (Einstellungen → Verbindungen → Discord-Server).
// The switcher still offers every server the bot is on; the badge only says
// which of them is the event and which the talk server.
const ROLE_BADGE: Record<"event" | "talk", { label: string; tip: string; tipSub: string }> = {
    event: { label: "Event", tip: "Event-Discord", tipSub: "Event-Kanäle und Raid-Helper liegen auf diesem Server." },
    talk: { label: "Talk", tip: "Kommunikations-Discord", tipSub: "Raid-Übersicht, Anmeldung per Bot und Erinnerungen laufen auf diesem Server." },
};

function RoleBadge({ role }: { role?: GuildRole }) {
    if (!role) return null;
    const b = ROLE_BADGE[role];
    return <Badge tone="accent" tip={b.tip} tipSub={b.tipSub}>{b.label}</Badge>;
}

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
                <RoleBadge role={guilds[0].role} />
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
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role ? ` · ${ROLE_BADGE[g.role].label}` : ""}</option>)}
            </select>
            <RoleBadge role={guilds.find((g) => g.id === activeGuildId)?.role} />
            {!activeGuildId && (
                <Badge tone="mid" tip="Kein Server gewählt" tipSub="Bitte zuerst einen Server wählen – die Bereiche zeigen erst dann seine Daten.">
                    Kein Server gewählt
                </Badge>
            )}
        </div>
    );
}
