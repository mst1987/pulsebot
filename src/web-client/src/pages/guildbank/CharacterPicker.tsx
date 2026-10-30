// "Verknüpfen": pick the raider profile character a guild bank request goes to.
// The addon mails a hand-out to the request's character, so a name nobody plays
// loses the mail — only a linked request can be confirmed (services/guildbank/
// linking.js). The search runs over the raider profiles' characters of the
// bank's version only (GET /api/guildbank/characters, #741), prefilled with the
// name the request has now. A hit shows the spec (else class) icon, the
// character-realm in its class colour, the raider and its evidence as a small
// badge ("aus Logs", "Loot", "Arsenal", "von Orga geprüft"); a click picks it.
// A character nobody has confirmed (typed by the raider at a signup — "Gentle"
// for the real "Gentleowl") stands greyed out as "nicht bestätigt" and cannot
// be picked; two steps confirm it on the spot: "Im Arsenal prüfen" (the armory
// answers → confirmed) and "Im Spiel geprüft" (the orga found it, after a
// short confirmation inside the row). The confirmed ones of the raider the name points at
// come first (the server's order). Used as a dialog of its own
// (LinkCharacterDialog) and inline in the requests and import dialogs (no
// dialog on top of a dialog).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    checkGuildBankCharacterArmory, searchGuildBankCharacters, verifyGuildBankCharacter,
    type ApiError, type GuildBankCharacterChoice, type GuildBankEvidence, type GuildBankKnownName, type GuildBankLinkProblem,
} from "../../api";
import { classColorProps } from "../../components/character/ClassSpec";
import { Badge, Button, Field, Modal, Switch, WowIcon } from "../../components/ui";
import { CheckIcon, LinkIcon, SearchIcon, WarnIcon } from "../../components/ui/icons/icons";
import { useToast } from "../../components/shell/Jobs";
import { classLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { recipientName } from "./bankView";

const SEARCH_DELAY_MS = 250;

/** The small badge of where a character's evidence comes from, or "nicht bestätigt". */
export function EvidenceBadge({ evidence }: { evidence: GuildBankEvidence }) {
    const t = useT();
    if (!evidence) {
        return <Badge size="sm" tone="mid" tip={t("guildbank.link.unverified")} tipSub={t("guildbank.link.unverifiedTip")}>{t("guildbank.link.unverified")}</Badge>;
    }
    return (
        <Badge size="sm" tone="ok" icon={<CheckIcon />} tip={t(`guildbank.link.evidence.${evidence}`)} tipSub={t(`guildbank.link.evidenceTip.${evidence}`)}>
            {t(`guildbank.link.evidence.${evidence}`)}
        </Badge>
    );
}

/** What a check of a hit left to say: the armory knew it or knew nothing (an error is a toast). */
type CheckNote = { tone: "ok" | "warn"; text: string };

/**
 * "Im Spiel geprüft" asks once more, inside the row (no dialog on top of the
 * dialog): only confirm a character found in game, e.g. per /who.
 */
function GameCheck({ name, busy, onYes, onNo }: { name: string; busy: boolean; onYes: () => void; onNo: () => void }) {
    const t = useT();
    const ref = useRef<HTMLSpanElement>(null);
    // the last hit's question would sit below the list's fold
    useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest" }); }, []);
    return (
        <span ref={ref} className="gb-link-confirm" role="group" aria-label={t("guildbank.link.gameCheckTitle", { name })}>
            <b>{t("guildbank.link.gameCheckTitle", { name })}</b>
            <span className="gb-req-sub">{t("guildbank.link.gameCheckText")}</span>
            <span className="gb-link-checks">
                <Button variant="go" size="sm" icon={<CheckIcon />} disabled={busy} onClick={onYes}>{t("guildbank.link.gameCheckAction")}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onNo}>{t("common.cancel")}</Button>
            </span>
        </span>
    );
}

/**
 * One hit: icon, "Name-Realm" big in its class colour, the evidence, the raider
 * and the class small. Unconfirmed: greyed out, not pickable, with the two checks.
 */
function Hit({ choice, busy, checking, note, asking, onPick, onArmory, onAsk, onVerify, onCancel }: {
    choice: GuildBankCharacterChoice;
    busy: boolean;
    checking: boolean;
    note?: CheckNote;
    /** "Im Spiel geprüft" was clicked: the row asks once more. */
    asking: boolean;
    onPick: (c: GuildBankCharacterChoice) => void;
    onArmory: (c: GuildBankCharacterChoice) => void;
    onAsk: (c: GuildBankCharacterChoice) => void;
    onVerify: (c: GuildBankCharacterChoice) => void;
    onCancel: () => void;
}) {
    const t = useT();
    const name = recipientName(choice);
    const confirmed = choice.verified;
    return (
        <li className={`gb-link-row${confirmed ? "" : " gb-link-unverified"}`}>
            <button type="button" className="gb-link-hit" disabled={busy || !confirmed} onClick={() => onPick(choice)}
                aria-label={t("guildbank.link.pickAria", { name, raider: choice.userName })}>
                {choice.icon ? <WowIcon name={choice.icon} size={28} /> : <span className="gb-link-noicon" aria-hidden="true" />}
                <span className="gb-req-text">
                    <span className="gb-link-name"><span {...classColorProps(choice.classColor)}>{name}</span></span>
                    <span className="gb-req-sub">
                        {[t("guildbank.link.raider", { name: choice.userName }), classLabel(choice.className, choice.className)].filter(Boolean).join(" · ")}
                    </span>
                </span>
                <EvidenceBadge evidence={choice.evidence || ""} />
            </button>
            {!confirmed && !asking && (
                <span className="gb-link-checks">
                    <Button size="sm" variant="ghost" icon={<SearchIcon />} disabled={busy || checking} onClick={() => onArmory(choice)}
                        aria-label={`${t("guildbank.link.armoryCheck")}: ${name}`}>
                        {checking ? t("guildbank.link.armoryChecking") : t("guildbank.link.armoryCheck")}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<CheckIcon />} disabled={busy || checking} onClick={() => onAsk(choice)}
                        aria-label={`${t("guildbank.link.gameCheck")}: ${name}`}>
                        {t("guildbank.link.gameCheck")}
                    </Button>
                </span>
            )}
            {!confirmed && asking && <GameCheck name={name} busy={busy || checking} onYes={() => onVerify(choice)} onNo={onCancel} />}
            {note && <span className={`gb-link-note gb-link-note-${note.tone}`} role="status">{note.text}</span>}
        </li>
    );
}

const keyOf = (c: { userId: string; characterKey: string }) => `${c.userId}:${c.characterKey}`;

/** A name taken as the recipient (#809): known (`checked` false) or checked in game by the orga. */
export type NamePick = { characterName: string; realm: string; checked: boolean; addToProfile: boolean };

/**
 * #809: the names the bank knows without a profile (earlier hand-outs, logs,
 * loot) — each can be taken at once — and the typed name itself, taken after
 * "Im Spiel geprüft". `raiderName` offers "ins Profil übernehmen".
 */
function OtherNames({ names, typed, busy, raiderName, onTake }: {
    names: GuildBankKnownName[];
    typed: string;
    busy: boolean;
    raiderName?: string;
    onTake: (pick: NamePick) => void;
}) {
    const t = useT();
    const [asking, setAsking] = useState(false);
    const [toProfile, setToProfile] = useState(false);
    const known = names.some((n) => n.name.toLowerCase() === typed.toLowerCase());
    const take = (characterName: string, realm: string, checked: boolean) => onTake({ characterName, realm, checked, addToProfile: !!raiderName && toProfile });
    return (
        <section className="gb-link-names" aria-label={t("guildbank.link.otherNames")}>
            <b>{t("guildbank.link.otherNames")}</b>
            {names.length > 0 && (
                <ul className="gb-link-hits">
                    {names.map((n) => {
                        const label = n.realm ? `${n.name}-${n.realm.replace(/\s+/g, "")}` : n.name;
                        return (
                            <li key={`${n.name}:${n.realm}`} className="gb-link-row">
                                <button type="button" className="gb-link-hit" disabled={busy} onClick={() => take(n.name, n.realm, false)}
                                    aria-label={t("guildbank.link.takeName", { name: label })}>
                                    <span className="gb-link-noicon" aria-hidden="true" />
                                    <span className="gb-req-text"><span className="gb-link-name">{label}</span></span>
                                    <Badge size="sm" tone="ok" icon={<CheckIcon />} tip={t(`guildbank.link.nameVia.${n.via}`)}>{t(`guildbank.link.nameVia.${n.via}`)}</Badge>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {typed && !known && !asking && (
                <span className="gb-link-checks gb-link-free">
                    <span className="gb-req-sub">{t("guildbank.link.freeHint", { name: typed })}</span>
                    <Button size="sm" variant="ghost" icon={<CheckIcon />} disabled={busy} onClick={() => setAsking(true)}
                        aria-label={t("guildbank.link.takeTyped", { name: typed })}>
                        {t("guildbank.link.gameCheck")}
                    </Button>
                </span>
            )}
            {typed && !known && asking && <GameCheck name={typed} busy={busy} onYes={() => take(typed, "", true)} onNo={() => setAsking(false)} />}
            {raiderName && (
                <Switch className="gb-link-profile" checked={toProfile} onChange={setToProfile} label={t("guildbank.link.addToProfile", { raider: raiderName })} />
            )}
        </section>
    );
}

/**
 * The search and its hits; `onPick` gets the chosen (confirmed) character.
 * With `onTakeName` (#809) also the known names without a profile and the
 * typed name (OtherNames).
 */
export function CharacterPicker({ bankKey, initialQuery, busy = false, onPick, onTakeName, raiderName, intro }: {
    bankKey: string;
    initialQuery: string;
    busy?: boolean;
    onPick: (choice: GuildBankCharacterChoice) => void;
    onTakeName?: (pick: NamePick) => void;
    /** The request's raider (a Discord account): offers "ins Profil übernehmen". */
    raiderName?: string;
    /** What is linked (shown above the search). */
    intro?: ReactNode;
}) {
    const t = useT();
    const toast = useToast();
    const [text, setText] = useState(initialQuery);
    const [asking, setAsking] = useState("");
    const [hits, setHits] = useState<GuildBankCharacterChoice[] | null>(null);
    const [names, setNames] = useState<GuildBankKnownName[]>([]);
    const [error, setError] = useState("");
    const [checking, setChecking] = useState("");
    const [notes, setNotes] = useState<Record<string, CheckNote>>({});
    const value = text.trim();

    useEffect(() => {
        let stale = false;
        setError("");
        const timer = window.setTimeout(() => {
            searchGuildBankCharacters(bankKey, value)
                .then((r) => { if (!stale) { setHits(r.characters); setNames(r.names || []); } })
                .catch((err: ApiError) => { if (!stale) setError(err.message); });
        }, SEARCH_DELAY_MS);
        return () => { stale = true; window.clearTimeout(timer); };
    }, [bankKey, value]);

    // a check answered: the hit shows its new evidence (pickable when confirmed) and what there is to say
    const settle = (choice: GuildBankCharacterChoice, note?: CheckNote) => {
        setHits((all) => (all ? all.map((c) => (keyOf(c) === keyOf(choice) ? choice : c)) : all));
        setNotes((all) => {
            const next = { ...all };
            if (note) next[keyOf(choice)] = note;
            else delete next[keyOf(choice)];
            return next;
        });
    };
    const check = async (choice: GuildBankCharacterChoice, run: () => Promise<{ choice: GuildBankCharacterChoice; note?: CheckNote }>) => {
        setChecking(keyOf(choice));
        try {
            const r = await run();
            settle(r.choice, r.note);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setChecking("");
        }
    };
    const armory = (choice: GuildBankCharacterChoice) => check(choice, async () => {
        const r = await checkGuildBankCharacterArmory(bankKey, { userId: choice.userId, characterKey: choice.characterKey });
        return r.found
            ? { choice: r.choice, note: { tone: "ok" as const, text: t("guildbank.link.armoryFound", { name: recipientName(r.choice) }) } }
            : { choice: r.choice, note: { tone: "warn" as const, text: t("guildbank.link.armoryMissing") } };
    });
    const verify = (choice: GuildBankCharacterChoice) => check(choice, async () => {
        const r = await verifyGuildBankCharacter(bankKey, { userId: choice.userId, characterKey: choice.characterKey });
        setAsking("");
        return { choice: r.choice, note: { tone: "ok" as const, text: t("guildbank.link.gameChecked", { name: recipientName(r.choice) }) } };
    });

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
                        {hits.map((c) => (
                            <Hit key={keyOf(c)} choice={c} busy={busy} checking={checking === keyOf(c)} note={notes[keyOf(c)]} asking={asking === keyOf(c)}
                                onPick={onPick} onArmory={(x) => { void armory(x); }} onAsk={(x) => setAsking(keyOf(x))}
                                onVerify={(x) => { void verify(x); }} onCancel={() => setAsking("")} />
                        ))}
                    </ul>
                )}
            </div>
            {onTakeName && hits !== null && (
                <OtherNames names={names} busy={busy} raiderName={raiderName} onTake={onTakeName}
                    typed={hits.some((c) => c.characterName.toLowerCase() === value.toLowerCase()) ? "" : value} />
            )}
        </div>
    );
}

/**
 * "nicht verknüpft": the request names no character of its raider's profile —
 * the orga cannot confirm it, the addon would not mail it. Without a raider at
 * all (imported by name) the tip says so too. `problem` "unverified": the
 * character is in the profile, but nobody has confirmed it exists — "Charakter
 * nicht bestätigt".
 */
export function NotLinkedBadge({ noRaider = false, problem = "none" }: { noRaider?: boolean; problem?: GuildBankLinkProblem }) {
    const t = useT();
    if (problem === "unverified") {
        return (
            <Badge size="sm" tone="bad" icon={<WarnIcon />} tip={t("guildbank.link.notVerified")} tipSub={t("guildbank.link.notVerifiedTip")}>
                {t("guildbank.link.notVerified")}
            </Badge>
        );
    }
    return (
        <Badge size="sm" tone="bad" icon={<WarnIcon />} tip={t("guildbank.link.notLinked")}
            tipSub={t(noRaider ? "guildbank.link.notLinkedTipNoRaider" : "guildbank.link.notLinkedTip")}>
            {t("guildbank.link.notLinked")}
        </Badge>
    );
}

/**
 * The line above the search: what gets linked ("2× Crimson Spinel · bisher: Whapap").
 * With `onVerify` (#806, a request that is not linked but names a character — a
 * raider without a Discord account has no profile to pick from): "Im Spiel
 * geprüft" for that name, asked once more in the line itself.
 */
export function LinkIntro({ what, current, busy = false, onVerify }: { what: string; current: string; busy?: boolean; onVerify?: () => void }) {
    const t = useT();
    const [asking, setAsking] = useState(false);
    return (
        <div className="gb-link-intro">
            <p>
                <b>{what}</b>
                {current && <span className="gb-req-sub">{t("guildbank.link.current", { name: current })}</span>}
            </p>
            {current && onVerify && !asking && (
                <span className="gb-link-checks">
                    <span className="gb-req-sub">{t("guildbank.link.currentCheckHint")}</span>
                    <Button size="sm" variant="ghost" icon={<CheckIcon />} disabled={busy} onClick={() => setAsking(true)}
                        aria-label={t("guildbank.link.currentCheck", { name: current })}>
                        {t("guildbank.link.gameCheck")}
                    </Button>
                </span>
            )}
            {current && onVerify && asking && <GameCheck name={current} busy={busy} onYes={onVerify} onNo={() => setAsking(false)} />}
        </div>
    );
}

/** The picker as a dialog of its own (the waiting-list tab); `onVerify` as in LinkIntro. */
export default function LinkCharacterDialog({ bankKey, what, current, busy, onPick, onVerify, onTakeName, raiderName, onClose }: {
    bankKey: string;
    what: string;
    current: string;
    busy: boolean;
    onPick: (choice: GuildBankCharacterChoice) => void;
    onVerify?: () => void;
    onTakeName?: (pick: NamePick) => void;
    raiderName?: string;
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
            width={600}
            initialFocus="#gb-link-query"
            footer={<Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}
        >
            <CharacterPicker bankKey={bankKey} initialQuery={current} busy={busy} onPick={onPick} onTakeName={onTakeName} raiderName={raiderName}
                intro={<LinkIntro what={what} current={current} busy={busy} onVerify={onVerify} />} />
        </Modal>
    );
}
