import { useState } from "react";
import { switchGuild, type ApiError, type SessionGuild } from "../../api";
import { useToast } from "./Jobs";
import WowIcon from "../ui/WowIcon";
import Badge from "../ui/Badge";
import { t, useT } from "../../i18n";

// The guild crest in front of every form of the switcher.
const GUILD_ICON = "inv_misc_tabardpvp_01";

// The orga's own short name of a server of the server list (Einstellungen →
// Discord-Server, #895). The switcher still offers every server the bot is on;
// servers have no fixed event/talk role any more, so only a label is shown.
function LabelBadge({ guild }: { guild?: SessionGuild }) {
    if (!guild || !guild.label) return null;
    // neutral (design C): which server this is, not a state; the colour stays free for states
    return <Badge tip={t("shell.guild.labelTip")} tipSub={t("shell.guild.labelSub")}>{guild.label}</Badge>;
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
                <LabelBadge guild={guilds[0]} />
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
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}{g.label ? ` · ${g.label}` : ""}</option>)}
            </select>
            <LabelBadge guild={guilds.find((g) => g.id === activeGuildId)} />
            {!activeGuildId && (
                <Badge tone="mid" tip={t("shell.guild.notChosen")} tipSub={t("shell.guild.notChosenSub")}>
                    {t("shell.guild.notChosen")}
                </Badge>
            )}
        </div>
    );
}
