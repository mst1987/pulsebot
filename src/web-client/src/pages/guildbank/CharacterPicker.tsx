// "Verknüpfen": pick the raider profile character a guild bank request goes to.
// The addon mails a hand-out to the request's character, so a name nobody plays
// loses the mail — only a linked request can be confirmed (services/guildbank/
// linking.js). The search runs over the raider profiles' characters of the
// bank's version only (GET /api/guildbank/characters, #741), prefilled with the
// name the request has now. A hit shows the spec (else class) icon, the
// character-realm in its class colour and the raider; a click picks it. Used as
// a dialog of its own (LinkCharacterDialog) and inline in the requests and
// import dialogs (no dialog on top of a dialog).
import { useEffect, useState, type ReactNode } from "react";
import { searchGuildBankCharacters, type ApiError, type GuildBankCharacterChoice } from "../../api";
import { classColorProps } from "../../components/character/ClassSpec";
import { Badge, Button, Field, Modal, WowIcon } from "../../components/ui";
import { LinkIcon, WarnIcon } from "../../components/ui/icons";
import { classLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { recipientName } from "./bankView";

const SEARCH_DELAY_MS = 250;

/** One hit: icon, "Name-Realm" big in its class colour, the raider and the class small. */
function Hit({ choice, busy, onPick }: { choice: GuildBankCharacterChoice; busy: boolean; onPick: (c: GuildBankCharacterChoice) => void }) {
    const t = useT();
    const name = recipientName(choice);
    return (
        <li>
            <button type="button" className="gb-link-hit" disabled={busy} onClick={() => onPick(choice)}
                aria-label={t("guildbank.link.pickAria", { name, raider: choice.userName })}>
                {choice.icon ? <WowIcon name={choice.icon} size={28} /> : <span className="gb-link-noicon" aria-hidden="true" />}
                <span className="gb-req-text">
                    <span className="gb-link-name"><span {...classColorProps(choice.classColor)}>{name}</span></span>
                    <span className="gb-req-sub">
                        {[t("guildbank.link.raider", { name: choice.userName }), classLabel(choice.className, choice.className)].filter(Boolean).join(" · ")}
                    </span>
                </span>            </button>
        </li>
    );
}

/** The search and its hits; `onPick` gets the chosen character. */
export function CharacterPicker({ bankKey, initialQuery, busy = false, onPick, intro }: {
    bankKey: string;
    initialQuery: string;
    busy?: boolean;
    onPick: (choice: GuildBankCharacterChoice) => void;
    /** What is linked (shown above the search). */
    intro?: ReactNode;
}) {
    const t = useT();
    const [text, setText] = useState(initialQuery);
    const [hits, setHits] = useState<GuildBankCharacterChoice[] | null>(null);
    const [error, setError] = useState("");
    const value = text.trim();

    useEffect(() => {
        let stale = false;
        setError("");
        const timer = window.setTimeout(() => {
            searchGuildBankCharacters(bankKey, value)
                .then((r) => { if (!stale) setHits(r.characters); })
                .catch((err: ApiError) => { if (!stale) setError(err.message); });
        }, SEARCH_DELAY_MS);
        return () => { stale = true; window.clearTimeout(timer); };
    }, [bankKey, value]);

    return (
        <div className="gb-link">
            {intro}
            <Field className="field" label={t("guildbank.link.search")} htmlFor="gb-link-query" hint={t("guildbank.link.searchHint")} error={error || undefined}>
                <input id="gb-link-query" maxLength={60} value={text} autoComplete="off" placeholder={t("guildbank.link.placeholder")}
                    onChange={(e) => setText(e.target.value)} />
            </Field>
            <div aria-live="polite">
                {hits === null && !error && <div className="empty">{t("guildbank.link.searching")}</div>}
                {hits && !hits.length && <div className="empty">{t("guildbank.link.noHits")}</div>}
                {hits && hits.length > 0 && (
                    <ul className="gb-link-hits" aria-label={t("guildbank.link.hits")}>
                        {hits.map((c) => <Hit key={`${c.userId}:${c.characterKey}`} choice={c} busy={busy} onPick={onPick} />)}
                    </ul>
                )}
            </div>
        </div>
    );
}

/**
 * "nicht verknüpft": the request names no character of its raider's profile —
 * the orga cannot confirm it, the addon would not mail it. Without a raider at
 * all (imported by name) the tip says so too.
 */
export function NotLinkedBadge({ noRaider = false }: { noRaider?: boolean }) {
    const t = useT();
    return (
        <Badge size="sm" tone="bad" icon={<WarnIcon />} tip={t("guildbank.link.notLinked")}
            tipSub={t(noRaider ? "guildbank.link.notLinkedTipNoRaider" : "guildbank.link.notLinkedTip")}>
            {t("guildbank.link.notLinked")}
        </Badge>
    );
}

/** The line above the search: what gets linked ("2× Crimson Spinel · bisher: Whapap"). */
export function LinkIntro({ what, current }: { what: string; current: string }) {
    const t = useT();
    return (
        <p className="gb-link-intro">
            <b>{what}</b>
            {current && <span className="gb-req-sub">{t("guildbank.link.current", { name: current })}</span>}
        </p>
    );
}

/** The picker as a dialog of its own (the waiting-list tab). */
export default function LinkCharacterDialog({ bankKey, what, current, busy, onPick, onClose }: {
    bankKey: string;
    what: string;
    current: string;
    busy: boolean;
    onPick: (choice: GuildBankCharacterChoice) => void;
    onClose: () => void;
}) {
    const t = useT();
    return (
        <Modal
            open
            onClose={onClose}
            icon={<LinkIcon />}
            tone="bank"
            kicker={t("guildbank.link.kicker")}
            title={t("guildbank.link.title")}
            width={560}
            initialFocus="#gb-link-query"
            footer={<Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}
        >
            <CharacterPicker bankKey={bankKey} initialQuery={current} busy={busy} onPick={onPick} intro={<LinkIntro what={what} current={current} />} />
        </Modal>
    );
}
