import { Link, useOutletContext } from "react-router-dom";
import type { ShellContext } from "../shell/Shell";
import { canAccess } from "../../lib/app/access";
import { useT } from "../../i18n";
import type { VermerkShort } from "../../api/roster/vermerke";
import { reasonSummary, vermerkeHref } from "./markText";
import LevelMark from "./LevelMark";

// The mark beside a name where the orga plans (#981): only the level's symbol,
// no word (dense lists), the level and the reasons with their counts as tooltip
// ("Warnung" / "Späte Abmeldung ×2 · Loot"). It draws nothing without a short
// form - and an answer carries one only for a caller past maySeeShort, so a
// raider's view, "Ansicht als Raider", /p, /e and the profile never show it.
// With read access to "vermerke" it links to the person's notes; inside a row
// that is itself a button it stays a plain symbol (no link inside a button).

/** Whether the signed-in user may open /vermerke (false outside the shell, e.g. in a bare test). */
function useCanOpenVermerke(): boolean {
    const ctx = useOutletContext<ShellContext | undefined>();
    return canAccess(ctx?.user ?? null, "vermerke", "read");
}

export default function VermerkMark({ short, userId, link = true, canOpen, size = 14, className }: {
    short?: VermerkShort | null;
    userId: string;
    /** false inside a row that is a button itself: the symbol and its tooltip only */
    link?: boolean;
    /** the caller knows the user's access (outside the shell's outlet); else read from the shell */
    canOpen?: boolean;
    size?: number;
    /** the module's own class for its spacing (module stylesheets never style .vm-mark) */
    className?: string;
}) {
    const t = useT();
    const shellCanOpen = useCanOpenVermerke();
    if (!short || !short.level) return null;
    const word = t(`vermerke.level.${short.level}`);
    const reasons = reasonSummary(t, short.reasons || {});
    const summary = reasons ? `${word} · ${reasons}` : word;
    const mark = <LevelMark level={short.level} iconOnly size={size} tipSub={reasons || undefined} label={t("vermerke.mark.aria", { summary })} />;
    const mayOpen = canOpen ?? shellCanOpen;
    const cls = className ? `vm-mark ${className}` : "vm-mark";
    if (!link || !mayOpen || !userId) return <span className={cls}>{mark}</span>;
    return (
        <Link className={`${cls} vm-mark-link`} to={vermerkeHref(userId)} aria-label={t("vermerke.mark.openAria", { summary })}>
            {mark}
        </Link>
    );
}
