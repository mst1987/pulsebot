import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { switchGuild, type ApiError, type SessionGuild } from "../../api";
import { useDismiss } from "../../hooks/useDismiss";
import { useToast } from "./Jobs";
import WowIcon from "../ui/WowIcon";
import Badge from "../ui/Badge";
import { ChevronDownIcon, CheckIcon } from "../ui/icons";
import { t, useT } from "../../i18n";

// The crest in front of a server's name when it has no Discord icon (or it does not load).
const GUILD_ICON = "inv_misc_tabardpvp_01";

/** The server's own Discord icon, as in Discord's server list; the crest without one. */
function GuildIcon({ guild, size }: { guild: SessionGuild; size: number }) {
    const [broken, setBroken] = useState(false);
    if (!guild.iconUrl || broken) return <WowIcon name={GUILD_ICON} size={size} />;
    return <img className="srv-icon" src={guild.iconUrl} alt="" width={size} height={size} onError={() => setBroken(true)} />;
}

/** The list's options in order (the buttons carrying role="option"). */
function options(list: HTMLElement): HTMLElement[] {
    return Array.from(list.querySelectorAll<HTMLElement>("[role='option']"));
}

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
    const head = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLUListElement>(null);
    useT();

    // Closing while the focus is in the list hands it back to the head button,
    // so the keyboard does not land on the page's start.
    const close = () => {
        const inList = !!list.current && list.current.contains(document.activeElement);
        setOpen(false);
        if (inList) head.current?.focus();
    };

    // Escape and a click beside the list close it, as with every popover here.
    useDismiss(box, open, close);

    // The listbox pattern: opening puts the focus on the active server (the
    // first one when none is active yet), so the arrows start from there.
    useEffect(() => {
        if (!open || !list.current) return;
        const opts = options(list.current);
        (opts.find((o) => o.getAttribute("aria-selected") === "true") || opts[0])?.focus();
    }, [open]);

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
                <GuildIcon guild={only} size={24} />
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

    // Up and down move through the servers, Home and End jump to the first and
    // the last; Enter and Space pick the focused one (the option is a button).
    const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
        const opts = options(e.currentTarget);
        if (!opts.length) return;
        const at = opts.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? Math.min(at + 1, opts.length - 1)
            : e.key === "ArrowUp" ? Math.max(at - 1, 0)
                : e.key === "Home" ? 0
                    : e.key === "End" ? opts.length - 1
                        : -1;
        if (next < 0) return;
        e.preventDefault();
        opts[next].focus();
    };

    // Arrow down or up on the closed head opens the list, as on a select.
    const onHeadKey = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault();
        setOpen(true);
    };

    const sub = [active && active.label, t("shell.guild.switch")].filter(Boolean).join(" · ");

    return (
        <div className="srv-head" ref={box}>
            <button
                ref={head}
                type="button"
                className="srv-head-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t("shell.guild.choose")}
                disabled={busy}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={onHeadKey}
            >
                {active ? <GuildIcon key={active.id} guild={active} size={24} /> : <WowIcon name={GUILD_ICON} size={24} />}
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
                <ul ref={list} className="srv-list" role="listbox" aria-label={t("shell.guild.choose")} onKeyDown={onListKey}>
                    {guilds.map((g) => {
                        const on = g.id === activeGuildId;
                        return (
                            <li key={g.id} role="none">
                                <button
                                    type="button" role="option" aria-selected={on} tabIndex={-1}
                                    className={on ? "srv-opt is-on" : "srv-opt"} onClick={() => void pick(g.id)}
                                >
                                    <GuildIcon guild={g} size={20} />
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
