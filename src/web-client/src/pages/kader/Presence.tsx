// Who else is in this Kader right now (docs/kaderplaner.md, "Live"), drawn
// where it matters: the leads in the header get an "online" ring and dot, other
// people with access who are here stand beside them as small avatars; a player
// somebody else has open carries that person's coloured initial with a dot
// (Gespräche list, Übersicht, Vorläufig cards); an open interview, drawer or
// account dialog says calmly who else is on it. The colour is the person's lead
// colour (lib/kader/leads.ts), never the only signal: the name is in the
// tooltip and the accessible label.
import type { CSSProperties } from "react";
import type { KaderPresence, KaderPresenceWhat } from "../../api";
import { Button } from "../../components/ui";
import { AlertIcon, EyeIcon, RefreshIcon, SaveIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import { leadHue } from "../../lib/kader/leads";
import { personName, presenceOn, presenceText, presenceTip } from "../../lib/kader/live";
import { nameOf } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

/** A person's initial in their colour, with the dot that says "here right now". */
function PresenceInitial({ p, size = 18 }: { p: KaderPresence; size?: number }) {
    const { view, kader } = useKader();
    const name = personName(view, p.userId, p.name);
    const hue = leadHue(kader.leads, p.userId);
    return (
        <span className={`kp-avatar kp-avatar-sized kp-hue-${hue} kp-online kp-presence-av`} style={{ "--av": `${size}px` } as CSSProperties} aria-hidden="true">
            {(name.trim()[0] || "?").toUpperCase()}
        </span>
    );
}

/** On a player somebody else has open: their initial(s) with the online dot, what they do as tooltip and label. */
export function PresenceMark({ playerId }: { playerId: string }) {
    const { view, presence } = useKader();
    const here = presenceOn(presence, playerId);
    if (!here.length) return null;
    const text = here.map((p) => presenceText(personName(view, p.userId, p.name), p)).join(" · ");
    return (
        <span className="kp-presence-mark" role="img" aria-label={text} data-tip={text}>
            {here.slice(0, 2).map((p) => <PresenceInitial key={p.userId} p={p} size={18} />)}
            {here.length > 2 && <span className="kp-presence-more" aria-hidden="true">+{here.length - 2}</span>}
        </span>
    );
}

/**
 * In an open interview, drawer or account dialog: who else has the same player open, one calm line each
 * ("Lena bearbeitet gerade auch dieses Gespräch"). Nothing when nobody does.
 */
export function PresenceBanner({ playerId, what }: { playerId: string; what: KaderPresenceWhat }) {
    const { view, presence } = useKader();
    const here = presenceOn(presence, playerId);
    if (!here.length) return null;
    return (
        <div className="kp-presence-banner" role="status">
            {here.map((p) => (
                <span key={p.userId} className="kp-presence-line">
                    <PresenceInitial p={p} size={22} />
                    <span>{presenceText(personName(view, p.userId, p.name), p, p.what === what)}</span>
                </span>
            ))}
        </div>
    );
}

/**
 * A save refused because somebody else changed the same thing in between (or seen live while input was unsaved):
 * "Lena hat dieses Gespräch inzwischen geändert." — the input stays; "Neu laden" takes their version,
 * "Trotzdem speichern" overwrites it with this one.
 */
export function ConflictBanner({ text, onReload, onOverwrite, busy = false }: { text: string; onReload: () => void; onOverwrite: () => void; busy?: boolean }) {
    const t = useT();
    return (
        <div className="kp-conflict" role="alert">
            <span className="kp-conflict-text">
                <AlertIcon />
                <span className="kp-col">
                    <span className="kp-strong">{text}</span>
                    <span className="kp-sub kp-wrap">{t("kader.live.conflict.hint")}</span>
                </span>
            </span>
            <span className="kp-conflict-act">
                <Button variant="ghost" size="sm" icon={<RefreshIcon />} disabled={busy} onClick={onReload}>{t("kader.live.conflict.reload")}</Button>
                <Button size="sm" icon={<SaveIcon />} disabled={busy} onClick={onOverwrite}>{t("kader.live.conflict.overwrite")}</Button>
            </span>
        </div>
    );
}

/** One avatar of the header: a lead (online ring when here) or somebody else who is here. */
function HeadAvatar({ userId, here }: { userId: string; here: KaderPresence | null }) {
    const { view, kader } = useKader();
    const name = here ? personName(view, userId, here.name) : nameOf(view, userId);
    const tip = here ? presenceTip(name, here) : name;
    return (
        <span className={`kp-avatar kp-hue-${leadHue(kader.leads, userId)}${here ? " kp-online" : ""}`} role="img" aria-label={tip} data-tip={tip}>
            {(name.trim()[0] || "?").toUpperCase()}
        </span>
    );
}

/** The header's "Leitung": every lead, online when here; then the others with access who are here right now. */
export function HeaderPeople() {
    const t = useT();
    const { kader, presence } = useKader();
    const byUser = new Map(presence.map((p) => [p.userId, p]));
    const guests = presence.filter((p) => !kader.leads.includes(p.userId));
    return (
        <>
            <span className="kp-avatars">
                {kader.leads.length
                    ? kader.leads.map((id) => <HeadAvatar key={id} userId={id} here={byUser.get(id) || null} />)
                    : <span className="kp-muted">{t("kader.header.noLeads")}</span>}
            </span>
            {guests.length > 0 && (
                <span className="kp-guests" role="group" aria-label={t("kader.live.presence.others")}>
                    <EyeIcon />
                    {guests.map((p) => <HeadAvatar key={p.userId} userId={p.userId} here={p} />)}
                </span>
            )}
        </>
    );
}
