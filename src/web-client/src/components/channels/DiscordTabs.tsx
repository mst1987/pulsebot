import { NavLink, useLocation } from "react-router-dom";
import { canAccessAny, getDiscordTabCounts, type DiscordSide, type DiscordTabCounts, type SessionUser } from "../../api";
import { useApi } from "../../hooks/useApi";
import { matchesHref, menuFamily } from "../../lib/app/menu";
import { tOr, useT } from "../../i18n";
import "../../styles/discord-tabs.css";

// The tabs of System › Discord (Kanäle, Rollen, Rollen-Nachrichten): one line
// under the page head, built from the menu family of "channels" in
// config/menu.json — a new page there (Mitglieder, an Übersicht) becomes a tab
// without touching this file. Each tab carries its count from
// /api/discord/tab-counts; a count the server does not know (bot offline) or a
// failed call simply leaves the number out. On a phone the line scrolls sideways
// instead of wrapping or widening the page.

/** The id of the tab a path belongs to: the longest href it lies under. */
export function activeTab(items: { id: string; href: string }[], pathname: string): string {
    return [...items].sort((a, b) => b.href.length - a.href.length).find((i) => matchesHref(i.href, pathname))?.id || "";
}

type Props = {
    user: SessionUser | null;
    /** the server whose roles the Rollen tab counts (the roles page passes its segment) */
    side?: DiscordSide;
    /** changes when the active server changes, so the channel count follows it */
    guildKey?: string;
};

export default function DiscordTabs({ user, side = "event", guildKey = "" }: Props) {
    const t = useT();
    const { pathname } = useLocation();
    const counts = useApi<DiscordTabCounts>(() => getDiscordTabCounts(side).catch(() => ({})), [side, guildKey]);
    const items = menuFamily("channels").filter((e) => canAccessAny(user, e.areas));
    if (items.length < 2) return null;
    const active = activeTab(items, pathname);
    const data = counts.data || {};
    return (
        <nav className="dtab-bar" aria-label={t("discord.tabs.aria")}>
            {items.map((e) => {
                const n = data[e.id];
                return (
                    <NavLink
                        key={e.id} to={e.href} end
                        className={`dtab-tab${e.id === active ? " dtab-on" : ""}`}
                        aria-current={e.id === active ? "page" : undefined}
                    >
                        {tOr(`discord.tabs.${e.id}`, e.label)}
                        {typeof n === "number" ? <span className="dtab-n">{n}</span> : null}
                    </NavLink>
                );
            })}
        </nav>
    );
}
