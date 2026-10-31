import type { CSSProperties } from "react";
import type { SetupAttendance, SetupCharacter, SetupConfirmation, SetupPerson } from "../../../api";
import { tipReasons } from "../../../lib/signups/setupEditor";
import { wowIconUrl } from "../../../lib/wow/wowIcon";
import { roleLabel, specLabel } from "../../../lib/wow/wowNames";
import { useT } from "../../../i18n";
import WowIcon from "../../../components/ui/icons/WowIcon";
import { BenchIcon, CheckIcon, CrownIcon, EditIcon, LockIcon, SignedIcon, UnlockIcon, XIcon } from "../../../components/ui/icons/icons";
import { classColorProps } from "../../../components/character/ClassSpec";
import SpecTile from "../SpecTile";
import { attendanceTone, benchText, specText, statusLabel } from "./setupText";
import { SigBadge } from "./Board";
import { Link } from "react-router-dom";
import type { VermerkShort } from "../../../api/roster/vermerke";
import LevelMark from "../../../components/vermerke/LevelMark";
import { reasonSummary, vermerkeHref } from "../../../components/vermerke/markText";
import type { LeadInstance } from "../../../api/roster/leaders";
import { LeadChips } from "../../../components/roster/LeadChips";
import { leadList } from "../../../lib/roster/leaders";

/** The header's attendance — the important number: big percentage, how sure the character link is (check = confirmed, "Auto" = guessed) and a bar. */
function AttendanceHead({ a }: { a: SetupAttendance | undefined }) {
    const t = useT();
    if (!a || a.pct === null) {
        return (
            <div className="se-tip-attn">
                <span className="se-tip-k">{t("setup.person.tip.attendance")}</span>
                <span className="se-tip-sub">{t("setup.person.tip.attendanceNone")}</span>
            </div>
        );
    }
    return (
        <div className="se-tip-attn">
            <span className="se-tip-k">{t("setup.person.tip.attendance")}</span>
            <span className="se-tip-att">
                <b className="se-num">{a.pct} %</b>
                {a.link === "manual"
                    ? <span className="se-tip-link se-tip-linked"><CheckIcon /></span>
                    : <span className="se-tip-link se-tip-auto">{t("setup.person.tip.autoBadge")}</span>}
            </span>
            <span className={`se-tip-bar se-tip-${attendanceTone(a.pct)}`}><i style={{ "--fill": `${a.pct}%` } as CSSProperties} /></span>
        </div>
    );
}

/** The attendance details: how many raids, how sure the character link is, when the raider last stood on the bench. */
function AttendanceDetails({ a }: { a: SetupAttendance | undefined }) {
    const t = useT();
    if (!a) return null;
    const bench = benchText(a);
    if (a.pct === null && !bench) return null;
    return (
        <div className="se-tip-body">
            <span className="se-tip-k">{t("setup.person.tip.attendanceDetails")}</span>
            {a.pct !== null && (
                <span className="se-tip-row" data-tip={t("setup.person.tip.attendanceCount", { attended: a.attended, total: a.total })}>
                    <SignedIcon />{a.attended}/{a.total}
                    {a.link === "manual"
                        ? <span className="se-tip-link se-tip-linked" data-tip={t("setup.person.tip.linkManual")}><CheckIcon /></span>
                        : <span className="se-tip-link se-tip-auto" data-tip={t("setup.person.tip.linkAuto")}>{t("setup.person.tip.autoBadge")}</span>}
                </span>
            )}
            {bench && (
                <span className="se-tip-row" data-tip={a.lastBench ? t("setup.person.tip.lastBench", { date: bench }) : t("setup.person.tip.benchNever", { count: a.benchNights })}>
                    <BenchIcon />{bench}
                </span>
            )}
        </div>
    );
}

/** What the orga does with the raider shown: the check, fixing the place, the signup — each only where it applies. */
export type SlotActions = {
    confirmation?: SetupConfirmation;
    /** set/clear the check (a group place of a posted setup only) */
    onConfirm?: () => void;
    locked?: boolean;
    /** fix/release the place (groups and bench, not "Angemeldet") */
    onLock?: () => void;
    /** "Anmeldung bearbeiten" (#521) */
    onEdit?: () => void;
    /** leads this raid (#1036) */
    leader?: boolean;
    /** "Als Leader setzen" (#1036): a group place of a raid with a leader rule only */
    onLeader?: () => void;
    /** "Leader-Wahl aufheben" (#1036): the leader the orga picked only, the proposal picks again */
    onUnlead?: () => void;
};

function ActionRow({ a }: { a: SlotActions }) {
    const t = useT();
    if (!a.onConfirm && !a.onLock && !a.onEdit && !a.onLeader && !a.onUnlead) return null;
    const confirmed = a.confirmation === "confirmed";
    return (
        <div className="se-tip-acts">
            {a.onConfirm && (
                <button
                    type="button" className={`se-tip-act se-tip-act-ok${confirmed ? " is-on" : ""}${a.confirmation === "declined" ? " se-tip-act-no" : ""}`}
                    aria-pressed={confirmed}
                    data-tip={a.confirmation ? t(`setup.slot.${a.confirmation}`) : t("setup.slot.confirm")}
                    data-tip-sub={a.confirmation ? t(`setup.slot.${a.confirmation}Sub`) : t("setup.slot.confirmSub")}
                    onClick={a.onConfirm}
                >
                    {a.confirmation === "declined" ? <XIcon /> : <CheckIcon />}
                    {a.confirmation ? t(`setup.slot.${a.confirmation}`) : t("setup.slot.confirmShort")}
                </button>
            )}
            {a.onLock && (
                <button
                    type="button" className={`se-tip-act${a.locked ? " is-on" : ""}`} aria-pressed={!!a.locked}
                    data-tip={a.locked ? t("setup.slot.locked") : t("setup.slot.lock")}
                    data-tip-sub={a.locked ? t("setup.slot.lockedSub") : t("setup.slot.lockSub")}
                    onClick={a.onLock}
                >
                    {a.locked ? <LockIcon /> : <UnlockIcon />}
                    {a.locked ? t("setup.slot.locked") : t("setup.slot.lock")}
                </button>
            )}
            {a.onLeader && (
                <button
                    type="button" className={`se-tip-act${a.leader ? " is-on" : ""}`} aria-pressed={!!a.leader}
                    data-tip={a.leader ? t("setup.leader.is") : t("setup.leader.set")}
                    data-tip-sub={a.leader ? t("setup.leader.isSub") : t("setup.leader.setSub")}
                    onClick={a.leader ? undefined : a.onLeader}
                >
                    <CrownIcon />
                    {a.leader ? t("setup.leader.is") : t("setup.leader.set")}
                </button>
            )}
            {a.onUnlead && (
                <button type="button" className="se-tip-act" data-tip={t("setup.leader.unset")} data-tip-sub={t("setup.leader.unsetSub")} onClick={a.onUnlead}>
                    <XIcon />{t("setup.leader.unset")}
                </button>
            )}
            {a.onEdit && (
                <button type="button" className="se-tip-act" data-tip={t("setup.signupEdit.open")} data-tip-sub={t("setup.signupEdit.openSub")} onClick={a.onEdit}>
                    <EditIcon />{t("setup.signupEdit.short")}
                </button>
            )}
        </div>
    );
}

/**
 * The raider panel — the content of the side drawer that a click on a raider
 * opens (SetupEditor.tsx), never a box that stands there empty. A header — the
 * spec tile, the name (never wrapped), spec · role, Discord name and status,
 * the orga's actions (check, fix, signup) and the attendance as the number that
 * matters — and under it: what the raider brings, why they stand here, the
 * attendance in detail. It shows the raider clicked last (`pinned`), whatever
 * the pointer touches on its way, so the actions stay put.
 * `peek`: the same panel read only, beside the line the mouse rests on or the
 * focus is on (SetupEditor.tsx' peek) — no actions, a short hint that a click
 * holds it with them (`removable`: in a group or on the bench, a double click takes them out).
 * The crown beside the name means one thing only (#1036): the raider leads this raid
 * (`p.leader`), the same as the crown at the place on the board.
 * `lead` (#1034): the instances the person may lead - with `onChange` (orga, not in
 * the peek) as toggle chips under "Leitet", otherwise as a line "can lead".
 */
export type SlotLead = { instances: LeadInstance[]; ids: string[]; onChange?: (next: string[]) => void; busy?: boolean; editable?: string[] };

export function SlotTip({ p, attendance, extra, onSpec, onExtra, onCharacter, actions = {}, pinned = false, peek = false, removable = false, vermerk, canOpenVermerke = false, lead }: {
    p: SetupPerson; attendance: SetupAttendance | undefined | null; extra: string[];
    onSpec?: (specKey: string) => void; onExtra?: (role: "tank" | "healer", on: boolean) => void;
    /** "Charakter wechseln" (#293): play another character they signed up with — groups and bench, not "Angemeldet". */
    onCharacter?: (c: SetupCharacter) => void;
    actions?: SlotActions; pinned?: boolean; peek?: boolean; removable?: boolean;
    /** the person's note in short (#981) - only in an answer past maySeeShort; the link to /vermerke with read access, never in the peek */
    vermerk?: VermerkShort; canOpenVermerke?: boolean;
    lead?: SlotLead;
}) {
    const t = useT();
    // the other characters they signed up with, in their order
    const otherCharacters = (p.characters || []).filter((c) => c.character.toLowerCase() !== p.character.toLowerCase());
    // the roles this raider could take on besides the one in the setup: a tank or a healer spec of the class
    const extraOffers = ((["tank", "healer"] as const).filter((r) => r !== p.role && (p.classSpecs || []).some((sp) => sp.role === r)));
    const color = classColorProps(p.classColor);
    const status = statusLabel(p.status);
    const brings = p.brings || [];
    // the state is the field in the header — a reason that only names it is dropped (tipReasons)
    // the loot reason (#1037) comes German from the server: shown in the page's language, in its place
    const loot = p.lootReason;
    const reasons = [...new Set(tipReasons(p.reasons))]
        .map((r) => (loot && r === loot.text ? t(`setup.loot.reason.${loot.kind}`, loot) : r));
    const noteReasons = vermerk ? reasonSummary(t, vermerk.reasons || {}) : "";
    return (
        <aside
            className={`se-tip${pinned ? " se-tip-pinned" : ""}${peek ? " se-tip-peek" : ""}`}
            aria-label={peek ? t("setup.person.tip.peekAria") : t("setup.person.tip.aria")} aria-live={peek ? undefined : "polite"}
        >
            <header className="se-tip-top">
                <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
                <div className="se-tip-who">
                    <span className="se-tip-nameline">
                        <span className={`se-tip-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                        {p.leader && <span className="se-tip-lead" role="img" aria-label={t("setup.leader.is")} data-tip={t("setup.leader.is")} data-tip-sub={t("setup.leader.isSub")}><CrownIcon /></span>}
                        {pinned && <span className="se-tip-pin" data-tip={t("setup.person.tip.pinnedSub")}>{t("setup.person.tip.pinned")}</span>}
                    </span>
                    <span className="se-tip-sub">
                        <span>{[specText(p), p.role ? roleLabel(p.role) : "", p.main === false ? t("setup.person.offSpec") : ""].filter(Boolean).join(" · ")}</span>
                        {p.name && <span>@{p.name}</span>}
                        {/* the same field and word as on the line ("Vielleicht", "Spät", "Bank") */}
                        {status && <SigBadge status={p.status} />}
                    </span>
                    <ActionRow a={actions} />
                </div>
                {attendance !== null && <AttendanceHead a={attendance} />}
            </header>
            <div className="se-tip-col">
                {brings.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.brings")}</span>
                        <div className="se-tip-buffs">
                        {brings.map((b) => (
                            <span
                                key={`${b.scope}-${b.key}`} className="se-tip-buff"
                                data-tip={b.label}
                                data-tip-sub={b.scope === "party" ? t("setup.person.tip.bringsGroup", { count: b.count }) : t("setup.person.tip.bringsRaid")}
                            >
                                <WowIcon name={b.icon} size={22} />
                                <span>
                                    {b.label}
                                    {b.scope === "party" && <small>{t("setup.person.tip.bringsGroupShort", { count: b.count })}</small>}
                                </span>
                            </span>
                        ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="se-tip-col">
                {vermerk?.level && (
                    <div className="se-tip-body se-tip-vermerk">
                        <span className="se-tip-k">{t("vermerke.mark.slotHead")}</span>
                        <span className="se-tip-vermerk-line">
                            <LevelMark level={vermerk.level} size={15} tipSub={noteReasons || undefined} />
                            {noteReasons && <span className="se-tip-vermerk-reasons">{noteReasons}</span>}
                            {canOpenVermerke && !peek && <Link className="se-tip-vermerk-open" to={vermerkeHref(p.userId)}>{t("vermerke.mark.open")}</Link>}
                        </span>
                    </div>
                )}
                {reasons.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k">{t("setup.person.tip.why")}</span>
                        <ul className="se-tip-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                )}
            </div>
            <div className="se-tip-col">
                {onCharacter && otherCharacters.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.chars.switch")} data-tip-sub={t("setup.chars.switchSub")}>{t("setup.chars.switch")}</span>
                        <div className="se-tip-chars">
                            {otherCharacters.map((c) => {
                                const spec = specLabel(c.spec, c.specLabel || c.spec);
                                const cc = classColorProps(c.classColor);
                                return (
                                    <button
                                        key={c.character} type="button" className="se-tip-char"
                                        aria-label={t("setup.chars.switchTo", { character: c.character, spec })}
                                        data-tip={t("setup.chars.switchTo", { character: c.character, spec })}
                                        data-tip-sub={c.priority > 0 ? t("setup.chars.also", { n: c.priority + 1 }) : t("setup.chars.first")}
                                        onClick={() => onCharacter(c)}
                                    >
                                        <SpecTile iconUrl={c.specIcon ? wowIconUrl(c.specIcon, 36) : undefined} classColor={c.classColor} />
                                        <span className="se-tip-char-text">
                                            <span className={cc.className || undefined} style={cc.style}>{c.character}</span>
                                            <small>{[spec, c.role ? roleLabel(c.role) : "", statusLabel(c.status)].filter(Boolean).join(" · ")}</small>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                {onSpec && (p.classSpecs || []).length > 1 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.person.tip.playsAs")} data-tip-sub={t("setup.person.tip.playsAsSub")}>{t("setup.person.tip.playsAs")}</span>
                        <div className="se-tip-specs">
                            {(p.classSpecs || []).map((sp) => (
                                <button
                                    key={sp.key} type="button" className={`se-tip-spec${sp.key === p.spec ? " is-on" : ""}`} aria-pressed={sp.key === p.spec}
                                    aria-label={`${specLabel(sp.key, sp.label)} · ${roleLabel(sp.role)}`}
                                    data-tip={specLabel(sp.key, sp.label)} data-tip-sub={roleLabel(sp.role)} onClick={() => onSpec(sp.key)}
                                >
                                    <WowIcon name={sp.icon || "inv_misc_questionmark"} size={22} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {onExtra && extraOffers.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.person.tip.extra")} data-tip-sub={t("setup.person.tip.extraSub")}>{t("setup.person.tip.extra")}</span>
                        <div className="se-tip-specs">
                            {extraOffers.map((r) => {
                                const on = extra.includes(r);
                                const spec = (p.classSpecs || []).find((sp) => sp.role === r);
                                return (
                                    <button
                                        key={r} type="button" className={`se-tip-extra${on ? " is-on" : ""}`} aria-pressed={on}
                                        data-tip={t("setup.extra.tip", { role: roleLabel(r) })} onClick={() => onExtra(r, !on)}
                                    >
                                        <WowIcon name={(spec && spec.icon) || "inv_misc_questionmark"} size={20} />
                                        <span>{roleLabel(r)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                {lead?.onChange && !peek && (lead.editable || lead.instances).length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.person.tip.leads")} data-tip-sub={t("setup.person.tip.leadsSub")}>{t("setup.person.tip.leads")}</span>
                        <LeadChips instances={lead.instances} value={lead.ids} onChange={lead.onChange} disabled={lead.busy} editable={lead.editable} />
                    </div>
                )}
                {!(lead?.onChange && !peek) && lead && lead.ids.length > 0 && (
                    <div className="se-tip-body">
                        <span className="se-tip-k" data-tip={t("setup.leader.canLead")} data-tip-sub={t("setup.leader.canLeadSub")}>{t("setup.leader.canLead")}</span>
                        <span className="se-tip-row"><CrownIcon />{leadList(lead.instances, lead.ids)}</span>
                    </div>
                )}
                {attendance !== null && <AttendanceDetails a={attendance} />}
            </div>
            {peek && <p className="se-tip-peekhint">{t(removable ? "setup.person.tip.peekHintPlaced" : "setup.person.tip.peekHint")}</p>}
        </aside>
    );
}
