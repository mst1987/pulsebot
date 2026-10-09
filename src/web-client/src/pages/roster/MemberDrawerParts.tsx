// The sections of the member drawer (#655/#656, MemberDrawer.tsx): the
// characters of this roster (order, remove, assign, typed by hand), the spec
// the first one counts with here, the roster's Discord roles as switches, the
// attendance as dots, the orga's note.
// Each change is saved at once by the drawer (onSave / onRole); read-only
// readers see the same facts without a control.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { RosterDetail, RosterMember, RosterMemberChar } from "../../api";
import { useLang, useT } from "../../i18n";
import { Button, Chip, IconButton, Switch } from "../../components/ui";
import { ChevronDownIcon, PlusIcon, XIcon } from "../../components/ui/icons";
import { formatDate } from "../../lib/format";
import { wowIconUrl } from "../../lib/wow/wowIcon";
import { classLabel, specLabel } from "../../lib/wow/wowNames";
import { assignChar, charIcon, charLine, dateInputValue, moveChar } from "../../lib/roster/rosterEdit";
import { attendanceTone } from "../../lib/roster/rosterView";


/** A drawer section: a small heading, its hint on the right, the content. */
export function DrawerSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="rn-sec">
            <div className="rn-sec-head"><h3 className="rn-kick">{title}</h3>{hint && <span className="rn-sub">{hint}</span>}</div>
            {children}
        </section>
    );
}

function CharRow({ char, note, children, on = false }: { char: RosterMemberChar; note: string; children?: ReactNode; on?: boolean }) {
    const icon = charIcon(char);
    return (
        <div className={`rn-pick-row${on ? " is-on" : ""}`}>
            {icon ? <img className="rn-pick-ico" src={icon} alt="" width={30} height={30} loading="lazy" /> : <span className="rn-pick-ico rn-char-ph" aria-hidden="true" />}
            <div className="rn-pick-main">
                <b className={char.classColor ? "class-colored" : undefined} style={char.classColor ? { "--cc": char.classColor } as CSSProperties : undefined}>{char.name}</b>
                <span>{[charLine(char), note].filter(Boolean).join(" · ")}</span>
            </div>
            {children}
        </div>
    );
}

/** The characters of this roster in order (the first counts), the profile's further ones, and one typed by hand. */
export function CharsSection({ member, data, busy, onSave }: {
    member: RosterMember;
    data: RosterDetail;
    busy: boolean;
    onSave: (chars: string[]) => void;
}) {
    const t = useT();
    const [typed, setTyped] = useState("");
    const [typing, setTyping] = useState(false);
    const manage = data.canManage;
    const multi = data.roster.allowMultipleChars;
    const keys = member.chars.map((c) => c.key);
    const others = member.otherChars || [];
    const addTyped = () => {
        const name = typed.trim();
        if (!name) return;
        onSave(multi ? [...keys, name] : [name]);
        setTyped("");
        setTyping(false);
    };
    return (
        <DrawerSection title={t("roster.drawer.chars")} hint={data.roster.versionLabel}>
            <div className="rn-pick">
                {!member.chars.length && <p className="rn-sub">{t("roster.detail.noChar")}</p>}
                {member.chars.map((c, i) => (
                    <CharRow key={c.key} char={c} on note={i === 0 ? t("roster.drawer.playsHere") : t("roster.drawer.extraChar")}>
                        {manage && (
                            <div className="rn-row-tools">
                                {multi && member.chars.length > 1 && (
                                    <div className="rn-order">
                                        <IconButton size="sm" icon={<ChevronDownIcon />} className="rn-up" tip={t("roster.drawer.up", { name: c.name })} disabled={busy || i === 0} onClick={() => onSave(moveChar(keys, i, -1))} />
                                        <IconButton size="sm" icon={<ChevronDownIcon />} tip={t("roster.drawer.down", { name: c.name })} disabled={busy || i === member.chars.length - 1} onClick={() => onSave(moveChar(keys, i, 1))} />
                                    </div>
                                )}
                                <IconButton size="sm" icon={<XIcon />} tip={t("roster.drawer.unassign", { name: c.name })} disabled={busy} onClick={() => onSave(keys.filter((k) => k !== c.key))} />
                            </div>
                        )}
                    </CharRow>
                ))}
                {manage && others.map((c) => (
                    <CharRow key={c.key} char={c} note={t("roster.drawer.fromProfile")}>
                        <Button size="sm" variant="ghost" icon={<PlusIcon />} disabled={busy} onClick={() => onSave(assignChar(keys, c.key, multi))}
                            data-tip={multi ? undefined : t("roster.drawer.replaceTip")}>
                            {t("roster.drawer.assign")}
                        </Button>
                    </CharRow>
                ))}
            </div>
            {manage && (
                <div className="rn-typed">
                    {typing ? (
                        <form className="rn-typed-form" onSubmit={(e) => { e.preventDefault(); addTyped(); }}>
                            <input
                                className="inp-sm"
                                value={typed}
                                maxLength={40}
                                autoFocus
                                aria-label={t("roster.drawer.typedLabel")}
                                placeholder={t("roster.drawer.typedPlaceholder")}
                                onChange={(e) => setTyped(e.target.value)}
                            />
                            <Button size="sm" type="submit" variant="ghost" disabled={busy || !typed.trim()}>{t("roster.drawer.assign")}</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setTyping(false); setTyped(""); }}>{t("common.cancel")}</Button>
                        </form>
                    ) : (
                        <Button size="sm" variant="ghost" onClick={() => setTyping(true)}>{t("roster.drawer.typed")}</Button>
                    )}
                    <span className="rn-sub">{multi ? t("roster.drawer.firstCounts") : t("roster.drawer.singleOnly")}</span>
                </div>
            )}
        </DrawerSection>
    );
}

/** "Anmeldung", "Log", "Profil", "Orga", "Klasse": where a spec came from, as one word. */
function specSourceWord(source: string, t: ReturnType<typeof useT>): string {
    return source ? t(`roster.spec.source.${source}`) : "";
}

/**
 * "Spec in diesem Roster": the spec the first character counts with here. A
 * manager picks one of the class's specs (toggle chips with the spec icon) or
 * "automatisch" - which says what the chain found and from where; a reader
 * sees the spec and its source. Without a class nothing can be picked.
 */
export function SpecSection({ member, data, busy, onSave }: {
    member: RosterMember;
    data: RosterDetail;
    busy: boolean;
    onSave: (spec: string) => void;
}) {
    const t = useT();
    const lang = useLang();
    const r = member.resolved;
    if (!r || !member.chars.length) return null;
    const choices = member.specChoices || [];
    const manage = data.canManage && choices.length > 0;
    const override = r.source === "override" ? r.override : "";
    const autoText = r.auto.spec
        ? t("roster.spec.autoFound", { spec: specLabel(r.auto.spec, r.auto.specLabel), source: specSourceWord(r.auto.source, t) })
        : t("roster.spec.autoNone");
    const now = r.spec
        ? t("roster.spec.now", { spec: specLabel(r.spec, r.specLabel), cls: classLabel(r.className, r.className), source: specSourceWord(r.source, t) })
        : r.className ? t("roster.spec.unknown", { cls: classLabel(r.className, r.className) }) : t("roster.spec.noClass");
    return (
        <DrawerSection title={t("roster.spec.title")} hint={manage ? t("roster.spec.hint") : undefined}>
            <p className="rn-sub">{now}</p>
            {manage && (
                <div className="chip-row rn-spec-pick" role="group" aria-label={t("roster.spec.title")}>
                    <Chip pressed={!override} disabled={busy} onClick={() => onSave("")} tip={t("roster.spec.autoTip")} tipSub={autoText}>
                        {t("roster.spec.auto")}
                    </Chip>
                    {choices.map((s) => (
                        <Chip key={s.key} pressed={override === s.key} disabled={busy} onClick={() => onSave(s.key)}
                            icon={s.icon ? <img className="rn-spec-ico" src={wowIconUrl(s.icon, 36)} alt="" width={18} height={18} loading="lazy" /> : undefined}
                            tip={t("roster.spec.pickTip", { spec: lang === "en" ? s.labelEn : s.label })}>
                            {specLabel(s.key, lang === "en" ? s.labelEn : s.label)}
                        </Chip>
                    ))}
                </div>
            )}
            {manage && <p className="rn-sub">{autoText}</p>}
        </DrawerSection>
    );
}

/** The roster's Discord roles: a switch per role for a manager (it acts at once), a word each for a reader. */
export function RolesSection({ member, data, busyRole, onRole }: {
    member: RosterMember;
    data: RosterDetail;
    busyRole: string;
    onRole: (roleId: string, give: boolean) => void;
}) {
    const t = useT();
    const r = data.roster;
    const roles = [
        ...r.discordRoles.filter((x): x is NonNullable<typeof x> => !!x).map((x, i) => ({ ...x, kind: i === 0 ? "main" : "other" })),
        ...(r.trialRole ? [{ ...r.trialRole, kind: "trial" }] : []),
    ];
    if (!roles.length) return null;
    const known = member.heldRoles !== null;
    return (
        <DrawerSection title={t("roster.drawer.roles")} hint={data.canManage ? t("roster.drawer.rolesNow") : undefined}>
            {roles.map((role) => {
                const held = known && (member.heldRoles || []).includes(role.id);
                const name = `@${role.name || role.id}`;
                const sub = t(`roster.drawer.roleKind.${role.kind}`);
                if (!data.canManage) {
                    return (
                        <div key={role.id} className="rn-role-line">
                            <b>{name}</b> <span className="rn-sub">· {sub}</span>
                            <span className={held ? "rn-ok" : "rn-sub"}>{!known ? t("roster.detail.roleUnknown") : held ? t("roster.drawer.held") : t("roster.drawer.notHeld")}</span>
                        </div>
                    );
                }
                return (
                    <Switch
                        key={role.id}
                        checked={held}
                        disabled={!known || busyRole !== ""}
                        tipHead={!known ? t("roster.detail.roleUnknown") : undefined}
                        tip={!known ? t("roster.detail.roleUnknownSub") : held ? t("roster.drawer.roleOnTip") : t("roster.drawer.roleOffTip")}
                        onChange={(give) => onRole(role.id, give)}
                        label={<><b>{name}</b> <span className="rn-sub">· {sub}</span></>}
                    />
                );
            })}
        </DrawerSection>
    );
}

/** The attendance: the share large, "n von m Raids", one square per counted raid (oldest first). */
export function AttendanceSection({ member, data }: { member: RosterMember; data: RosterDetail }) {
    const t = useT();
    const att = member.attendance;
    const window = data.window || 0;
    if (!att || att.pct === null) {
        return <DrawerSection title={t("roster.drawer.attendance")}><p className="rn-sub">{t("roster.detail.noAttendanceSub")}</p></DrawerSection>;
    }
    const nights = [
        ...(att.present || []).map((n) => ({ ...n, in: true })),
        ...(att.missed || []).map((n) => ({ ...n, in: false })),
    ].sort((a, b) => a.startTime - b.startTime);
    const tone = attendanceTone(att.pct);
    return (
        <DrawerSection title={t("roster.drawer.attendance")} hint={window ? t("roster.drawer.lastRaids", { count: window }) : undefined}>
            <div className="rn-att-big">
                <span className={`rn-big${tone ? ` rn-tone-${tone}` : ""}`}>{att.pct}<small>%</small></span>
                <span className="rn-sub">{t("roster.drawer.attended", { attended: att.attended, total: att.total })}</span>
            </div>
            <div className="rn-dots" role="img" aria-label={t("roster.drawer.attended", { attended: att.attended, total: att.total })}>
                {nights.map((n) => (
                    <i key={n.eventId} className={n.in ? "" : "off"} data-tip={formatDate(n.startTime * 1000)} data-tip-sub={n.in ? t("roster.badge.present") : t("roster.drawer.missed")} />
                ))}
            </div>
        </DrawerSection>
    );
}

/** The orga's note (managers only): a text field and "Notiz speichern" once it changed. */
export function NoteSection({ member, busy, onSave }: { member: RosterMember; busy: boolean; onSave: (note: string) => void }) {
    const t = useT();
    const stored = member.note || "";
    const [draft, setDraft] = useState(stored);
    const [base, setBase] = useState(stored);
    // a reload brought a new note (saved here or elsewhere): start from it
    if (stored !== base) {
        setBase(stored);
        setDraft(stored);
    }
    return (
        <DrawerSection title={t("roster.drawer.note")} hint={t("roster.drawer.noteHint")}>
            <textarea
                className="rn-note"
                value={draft}
                maxLength={500}
                rows={3}
                aria-label={t("roster.drawer.note")}
                placeholder={t("roster.drawer.notePlaceholder")}
                onChange={(e) => setDraft(e.target.value)}
            />
            {draft !== stored && (
                <div className="rn-note-act">
                    <Button size="sm" variant="ghost" running={busy} onClick={() => onSave(draft)}>{t("roster.drawer.noteSave")}</Button>
                    <span className="rn-sub">{t("roster.drawer.noteLeft", { count: 500 - draft.length })}</span>
                </div>
            )}
        </DrawerSection>
    );
}

/** The trial's end date (status trial): a date field for a manager, a sentence for a reader. */
export function TrialUntil({ member, manage, busy, onSave }: { member: RosterMember; manage: boolean; busy: boolean; onSave: (iso: string | null) => void }) {
    const t = useT();
    const value = dateInputValue(member.trialUntil);
    if (!manage) {
        return member.trialUntil ? <p className="rn-sub">{t("roster.detail.trialUntil", { date: formatDate(Date.parse(member.trialUntil)) })}</p> : null;
    }
    return (
        <label className="rn-trial">
            <span className="rn-lbl">{t("roster.drawer.trialUntil")}</span>
            <input type="date" className="inp-sm" value={value} disabled={busy} onChange={(e) => onSave(e.target.value || null)} />
            {value && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSave(null)}>{t("roster.drawer.trialClear")}</Button>}
        </label>
    );
}
