import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { canAccessAny, getDiscordTabCounts, type DiscordTabCounts, type SessionUser } from "../../api";
import { useApi } from "../../hooks/useApi";
import { menuFamily } from "../../lib/app/menu";
import { activeTab, discordTabOrder, scrollToShow } from "../../lib/discord/tabs";
import { tOr, useT } from "../../i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";
import "../../styles/discord-tabs.css";

// The tabs of System › Discord (Übersicht, Kanäle, Rollen, Mitglieder,
// Rollen-Nachrichten): one line under the page head, built from the menu family
// of "channels" in config/menu.json — a new page there becomes a tab without
// touching this file. Each tab carries its count from /api/discord/tab-counts; a
// count the server does not know (bot offline) or a failed call simply leaves the
// number out.
//
// On a phone (≤ 600 px, discord-tabs.css) the tabs drop their counts and a long
// name its short word (discord.tabs.short.*, only where one exists — the full
// name stays the accessible name and the tooltip), so all five fit at 390 px. Should the
// line still be wider than the screen (a large font, a narrower phone), it
// scrolls sideways inside itself: the active tab is scrolled into view on load,
// and a chevron button sits at each edge that has more tabs behind it.

type Props = {
    user: SessionUser | null;
    /** the server whose roles and members the tabs count ("" = the first of the server list) */
    guildId?: string;
    /** the query string that keeps the picked server on every tab ("" or "?guild=…", see pickSearch) */
    search?: string;
    /** changes when the active server of the channels page changes, so the channel count follows it */
    guildKey?: string;
};

export default function DiscordTabs({ user, guildId = "", search = "", guildKey = "" }: Props) {
    const t = useT();
    const { pathname } = useLocation();
    const counts = useApi<DiscordTabCounts>(() => getDiscordTabCounts(guildId).catch(() => ({})), [guildId, guildKey]);
    const barRef = useRef<HTMLElement>(null);
    const [more, setMore] = useState({ left: false, right: false });
    const items = discordTabOrder(menuFamily("channels").filter((e) => canAccessAny(user, e.areas)));
    const active = activeTab(items, pathname);
    const shown = items.length >= 2;

    const measure = useCallback(() => {
        const bar = barRef.current;
        if (!bar) return;
        const left = bar.scrollLeft > 1;
        const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
        setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    }, []);

    // The active tab into view on load and on every tab change — only the bar
    // scrolls (scrollLeft), never the page.
    useLayoutEffect(() => {
        const bar = barRef.current;
        const tab = bar?.querySelector<HTMLElement>(".dtab-on");
        if (bar && tab) bar.scrollLeft = scrollToShow(bar, tab);
        measure();
    }, [active, shown, measure]);

    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return undefined;
        bar.addEventListener("scroll", measure, { passive: true });
        window.addEventListener("resize", measure);
        return () => {
            bar.removeEventListener("scroll", measure);
            window.removeEventListener("resize", measure);
        };
    }, [shown, measure]);

    // The counts arrive after the first paint and widen the tabs.
    useEffect(measure, [counts.data, measure]);

    if (!shown) return null;
    const data = counts.data || {};
    const step = (dir: 1 | -1) => {
        const bar = barRef.current;
        if (bar) bar.scrollBy({ left: dir * Math.round(bar.clientWidth * 0.6), behavior: "smooth" });
    };
    return (
        <div className="dtab-wrap">
            {more.left ? (
                <button type="button" className="dtab-more dtab-more-left" onClick={() => step(-1)}
                    data-tip={t("discord.tabs.moreLeft")} aria-label={t("discord.tabs.moreLeft")}>
                    <ChevronLeftIcon />
                </button>
            ) : null}
            <nav className="dtab-bar" aria-label={t("discord.tabs.aria")} ref={barRef}>
                {items.map((e) => {
                    const n = data[e.id];
                    const label = tOr(`discord.tabs.${e.id}`, e.label);
                    const short = tOr(`discord.tabs.short.${e.id}`, label);
                    const on = e.id === active;
                    return (
                        <NavLink
                            key={e.id} to={`${e.href}${search}`} end
                            className={`dtab-tab${on ? " dtab-on" : ""}`}
                            aria-current={on ? "page" : undefined}
                            data-tip={typeof n === "number" ? `${label}: ${n}` : label}
                        >
                            {short === label ? label : (
                                <>
                                    <span className="dtab-full">{label}</span>
                                    <span className="dtab-short" aria-hidden="true">{short}</span>
                                </>
                            )}
                            {typeof n === "number" ? <span className="dtab-n">{n}</span> : null}
                        </NavLink>
                    );
                })}
            </nav>
            {more.right ? (
                <button type="button" className="dtab-more dtab-more-right" onClick={() => step(1)}
                    data-tip={t("discord.tabs.moreRight")} aria-label={t("discord.tabs.moreRight")}>
                    <ChevronRightIcon />
                </button>
            ) : null}
        </div>
    );
}
