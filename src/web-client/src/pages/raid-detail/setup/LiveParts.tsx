import type { CSSProperties } from "react";
import type { SetupActivity, SetupPresenceEditor } from "../../../api";
import { useT } from "../../../i18n";
import { activityText, agoText } from "./setupText";
import { initials, presenceColor } from "./usePresence";

// What the orga sees of each other in the setup editor: the avatars in the bar
// ("Exitus ist auch hier" / "3 im Setup", what each holds in the tooltip) and
// "Gerade eben", the changes the others made (the server leaves one's own out).

function Avatar({ userId, name }: { userId: string; name: string }) {
    return (
        <span className="se-avatar" style={{ "--se-who": presenceColor(userId) } as CSSProperties} aria-hidden="true">
            {initials(name)}
        </span>
    );
}

/** The others in the editor, beside the state badge; nothing while one is alone. */
export function PresenceChip({ editors, names }: { editors: SetupPresenceEditor[]; names: Map<string, string> }) {
    const t = useT();
    if (!editors.length) return null;
    const doing = (e: SetupPresenceEditor) => {
        if (!e.action) return t("setup.live.looking", { name: e.name });
        const character = names.get(e.action.userId) || "?";
        return e.action.kind === "edit" ? t("setup.live.editsTip", { name: e.name, character }) : t("setup.live.holdsTip", { name: e.name, character });
    };
    const label = editors.length === 1 ? t("setup.live.one", { name: editors[0].name }) : t("setup.live.many", { count: editors.length + 1 });
    return (
        <span className="se-live" role="status" data-tip={label} data-tip-sub={editors.map(doing).join(" · ")}>
            <span className="se-live-avatars">
                {editors.slice(0, 4).map((e) => <Avatar key={e.userId} userId={e.userId} name={e.name} />)}
            </span>
            <span className="se-live-text">
                <b>{label}</b>
                <small>{t("setup.live.sub")}</small>
            </span>
        </span>
    );
}

/** "Gerade eben": the others' last changes, newest first; nothing before anybody else changed anything. */
export function ActivityFeed({ activity, now = Date.now() }: { activity: SetupActivity[]; now?: number }) {
    const t = useT();
    const last = activity.slice(-5).reverse();
    if (!last.length) return null;
    return (
        <section className="se-feed" aria-label={t("setup.live.feed")}>
            <header className="se-feed-head"><span className="se-feed-dot" aria-hidden="true" />{t("setup.live.feed")}</header>
            <ul>
                {last.map((e) => (
                    <li key={e.id} style={{ "--se-who": presenceColor(e.by) } as CSSProperties}>
                        <span className="se-feed-who" aria-hidden="true" />
                        <span className="se-feed-text">{activityText(e)}</span>
                        <span className="se-feed-at">{agoText(e.at, now)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
