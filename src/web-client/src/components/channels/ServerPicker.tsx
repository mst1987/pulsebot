import type { ServerPick } from "../../hooks/useServerPick";
import { serverExtra, serverName, shortName } from "../../lib/discord/serverPick";
import { Segment } from "../ui";
import { useT } from "../../i18n";
import "../../styles/server-picker.css";

// The server picker of System › Discord (#895): Übersicht, Rollen, Mitglieder and
// Rollen-Nachrichten each show one server of the server list (Einstellungen ›
// Discord). The pick lives in the URL (`?guild=<id>`, none for the first server)
// so a link and the browser's back button keep it, and the Discord tabs carry it
// from page to page. Hidden while there is only one server; up to three servers
// are a segment with the Discord name (the orga's label and "bot not on that
// server" in the tooltip), more than three a plain select. The pick itself:
// hooks/useServerPick.ts.

type Props = {
    pick: ServerPick;
    /** further URL parameters to drop on a switch (an open drawer of the old server) */
    drop?: string[];
};

export default function ServerPicker({ pick, drop }: Props) {
    const t = useT();
    const { servers, guildId } = pick;
    if (!servers || servers.length < 2) return null;
    const label = t("discord.server.label");
    if (servers.length > 3) {
        return (
            <label className="srvp-pick">
                <span className="srvp-lbl">{label}</span>
                <select className="srvp-select" value={guildId} onChange={(e) => pick.choose(e.target.value, drop)}>
                    {servers.map((s) => {
                        const extra = serverExtra(s);
                        return (
                            <option key={s.guildId} value={s.guildId}>
                                {serverName(s)}{extra ? ` · ${extra}` : ""}{s.online ? "" : ` · ${t("discord.server.offline")}`}
                            </option>
                        );
                    })}
                </select>
            </label>
        );
    }
    return (
        <Segment
            ariaLabel={label}
            size="sm"
            value={guildId}
            onChange={(id) => pick.choose(id, drop)}
            options={servers.map((s) => {
                const extra = serverExtra(s);
                const name = serverName(s);
                return {
                    value: s.guildId,
                    label: shortName(name),
                    icon: s.iconUrl ? <img className="srvp-icon" src={s.iconUrl} alt="" /> : undefined,
                    tip: extra ? `${name} · ${extra}` : name,
                    tipSub: s.online ? undefined : t("discord.server.offlineSub"),
                };
            })}
        />
    );
}
