import { useState } from "react";
import { switchGuild, type ApiError, type GuildRole, type SessionGuild } from "../api";
import { useToast } from "./Jobs";
import WowIcon from "./ui/WowIcon";
import Badge from "./ui/Badge";
import { t, useT } from "../i18n";

// The guild crest in front of every form of the switcher.
const GUILD_ICON = "inv_misc_tabardpvp_01";

// The fixed role a server has (Einstellungen → Verbindungen → Discord-Server).
// The switcher still offers every server the bot is on; the badge only says
// which of them is the event and which the talk server.
function roleBadge(role: "event" | "talk"): { label: string; tip: string; tipSub: string } {
    return role === "event"
        ? { label: t("shell.guild.roleEvent"), tip: t("shell.guild.roleEventTip"), tipSub: t("shell.guild.roleEventSub") }
        : { label: t("shell.guild.roleTalk"), tip: t("shell.guild.roleTalkTip"), tipSub: t("shell.guild.roleTalkSub") };
}

function RoleBadge({ role }: { role?: GuildRole }) {
    if (!role) return null;
    const b = roleBadge(role);
    return <Badge tone="accent" tip={b.tip} tipSub={b.tipSub}>{b.label}</Badge>;
}

// Topbar server switcher — mirrors src/web/renderAdmin.js's renderServerBar(),
// but via fetch() instead of a form POST + redirect, so switching guilds
// doesn't navigate away from the current page.
export default function GuildSwitcher({ guilds, activeGuildId }: {
    guilds: SessionGuild[];
    activeGuildId: string;
}) {
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    useT();

    if (!guilds.length) {
        return (
            <Badge tone="mid" icon={GUILD_ICON} tip={t("shell.guild.noneTip")} tipSub={t("shell.guild.noneSub")}>
                {t("shell.guild.none")}
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
            await switchGuild(guildId);
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
            <select value={activeGuildId} onChange={onChange} disabled={busy} aria-label={t("shell.guild.choose")}>
                {!activeGuildId && <option value="">{t("shell.guild.choose")}</option>}
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role ? ` · ${roleBadge(g.role).label}` : ""}</option>)}
            </select>
            <RoleBadge role={guilds.find((g) => g.id === activeGuildId)?.role} />
            {!activeGuildId && (
                <Badge tone="mid" tip={t("shell.guild.notChosen")} tipSub={t("shell.guild.notChosenSub")}>
                    {t("shell.guild.notChosen")}
                </Badge>
            )}
        </div>
    );
}
