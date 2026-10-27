import { useRef, useState } from "react";
import { switchGuild, type ApiError, type SessionGuild } from "../../api";
import { useDismiss } from "../../hooks/useDismiss";
import { useToast } from "./Jobs";
import WowIcon from "../ui/WowIcon";
import Badge from "../ui/Badge";
import { ChevronDownIcon, CheckIcon } from "../ui/icons";
import { t, useT } from "../../i18n";

// The guild crest in front of the server's name.
const GUILD_ICON = "inv_misc_tabardpvp_01";

/**
 * The server head at the top of the sidebar (#918, design A "Discord-Kopf"):
 * like Discord's server name above the channel list, it says which server the
 * menu below belongs to and opens the list of the others. It replaces the
 * topbar's former select (GuildSwitcher).
 *
 * - no server: a quiet note, nothing to pick
 * - one server: its name (and the orga's label, Einstellungen → Discord-Server), no button
 * - two and more: a button with the name, the label and "Server wechseln" that opens
 *   the list of every server the bot is on (never filtered, #895); a pick switches
 *   the session's server and reloads, so every page loads the new server's data
 *   (activeGuildFor(req) on the server side is the one source of truth).
 */
export default function ServerHeader({ guilds, activeGuildId }: {
    guilds: SessionGuild[];
    activeGuildId: string;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const box = useRef<HTMLDivElement>(null);
    useT();

    // Escape and a click beside the list close it, as with every popover here.
    useDismiss(box, open, () => setOpen(false));

    if (!guilds.length) {
        return (
            <div className="srv-head is-none">
                <Badge tone="mid" icon={GUILD_ICON} tip={t("shell.guild.noneTip")} tipSub={t("shell.guild.noneSub")}>
                    {t("shell.guild.none")}
                </Badge>
            </div>
        );
    }

    const active = guilds.find((g) => g.id === activeGuildId);

    if (guilds.length === 1) {
        const only = guilds[0];
        return (
            <div className="srv-head is-single">
                <WowIcon name={GUILD_ICON} size={24} />
                <div className="srv-head-text">
                    <div className="srv-head-name">{only.name}</div>
                    {only.label && (
                        <div className="srv-head-sub" data-tip={t("shell.guild.labelTip")} data-tip-sub={t("shell.guild.labelSub")}>{only.label}</div>
                    )}
                </div>
            </div>
        );
    }

    const pick = async (guildId: string) => {
        setOpen(false);
        if (guildId === activeGuildId) return;
        setBusy(true);
        try {
            await switchGuild(guildId);
            // No success toast: the reload wipes the page, and the head then
            // simply shows the server that was picked.
            window.location.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
            setBusy(false);
        }
    };

    const sub = [active && active.label, t("shell.guild.switch")].filter(Boolean).join(" · ");

    return (
        <div className="srv-head" ref={box}>
            <button
                type="button"
                className="srv-head-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t("shell.guild.choose")}
                disabled={busy}
                onClick={() => setOpen((o) => !o)}
            >
                <WowIcon name={GUILD_ICON} size={24} />
                <span className="srv-head-text">
                    <span className="srv-head-name">{active ? active.name : t("shell.guild.choose")}</span>
                    <span className="srv-head-sub">{sub}</span>
                </span>
                <ChevronDownIcon />
            </button>
            {!active && (
                <Badge tone="mid" tip={t("shell.guild.notChosen")} tipSub={t("shell.guild.notChosenSub")}>
                    {t("shell.guild.notChosen")}
                </Badge>
            )}
            {open && (
                <ul className="srv-list" role="listbox" aria-label={t("shell.guild.choose")}>
                    {guilds.map((g) => {
                        const on = g.id === activeGuildId;
                        return (
                            <li key={g.id} role="option" aria-selected={on}>
                                <button type="button" className={on ? "srv-opt is-on" : "srv-opt"} onClick={() => void pick(g.id)}>
                                    <span className="srv-head-text">
                                        <span className="srv-head-name">{g.name}</span>
                                        {g.label && <span className="srv-head-sub">{g.label}</span>}
                                    </span>
                                    {on && <CheckIcon />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
