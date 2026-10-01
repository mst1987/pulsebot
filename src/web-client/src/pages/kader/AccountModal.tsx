// One Discord account in the Kaderplaner (a click on a name opens it): its
// Forever characters as the planner sees them (a Forever name or a nickname,
// class, specs with one main spec, gear, tank/heal) on the left, what
// EventHelper knows on the right — read only, with the attendance over the
// open Kader's raid categories. The character data belongs to the server, not
// to one Kader; the planner's assignment wins inside the planner and is never
// written back to the raider profile. Where the account stands in the open
// Kader shows on top.
import { useMemo, useState, type CSSProperties } from "react";
import { removeKaderAccount, resetKaderAssignment, saveKaderAssignment, type KaderCharacterInput, type KaderDay, type KaderGear, type KaderNameStyle, type KaderPickable, type KaderPlayer } from "../../api";
import { Badge, Button, Field, Modal, Segment } from "../../components/ui";
import { RefreshIcon, SaveIcon, TrashIcon } from "../../components/icons";
import { useConfirm } from "../../components/ui/Modal";
import { useT } from "../../i18n";
import { roleLabel } from "../../lib/wowNames";
import { className, classDef, specName } from "../../lib/kader/model";
import { inferNameStyle, nameOk, splitName, switchNameStyle } from "../../lib/kader/names";
import { useKader } from "./kaderContext";
import { AttendanceNights } from "./Attendance";
import { ClassIcon, RoleIcon, SinceText, SpecIcon, StateBadge } from "./parts";

const DAYS: KaderDay[] = ["mo", "di", "mi", "do", "fr", "sa", "so"];
const GEARS: KaderGear[] = ["none", "usable", "ready"];
const MAX_CHARS = 8;
const VERSION_LABEL: Record<string, string> = { forever: "Forever", tbc: "TBC", classic: "Classic" };

/** A pickable character as the planner's character: a Forever name is first + last, every other one a nickname. */
function fromPickable(p: KaderPickable): KaderCharacterInput {
    const nameStyle: KaderNameStyle = p.versionId === "forever" && inferNameStyle(p.name) === "forever" ? "forever" : "nick";
    return {
        id: `n${Date.now().toString(36)}${p.key.length}`,
        name: p.name,
        nameStyle,
        className: p.className,
        specs: p.specs.map((x) => ({ ...x })),
        canTank: p.canTank,
        canHeal: p.canHeal,
        ...(p.key ? { onlineKey: p.key } : {}),
    };
}

/** The editable copy of a player's characters (profile ids become new planner ids with an onlineKey). */
function draftOf(player: KaderPlayer): { chars: KaderCharacterInput[]; active: string | null } {
    return {
        chars: player.characters.map((c) => ({
            id: c.id,
            name: c.name,
            nameStyle: c.nameStyle || inferNameStyle(c.name),
            className: c.className,
            specs: c.specs.map((s) => ({ ...s })),
            canTank: c.canTank,
            canHeal: c.canHeal,
            ...(c.onlineKey ? { onlineKey: c.onlineKey } : {}),
        })),
        active: player.activeCharacterId,
    };
}

/** What EventHelper knows about the account: read only. */
function ProfilePanel({ player }: { player: KaderPlayer }) {
    const t = useT();
    const { view } = useKader();
    const days = DAYS.filter((d) => player.availability.includes(d)).map((d) => t(`kader.day.${d}`));
    const p = player.profile;
    return (
        <aside className="kp-profile">
            <span className="kicker kp-accent2">{t("kader.account.fromProfile")}</span>
            {!player.hasProfile && <p className="kp-hint">{t("kader.account.noProfile")}</p>}
            <AttendanceNights player={player} />
            <dl className="kp-facts">
                <div><dt>{t("kader.account.profileSays")}</dt><dd>{p ? `${p.character} · ${className(view.classes, p.className)} · ${specName(view.classes, p.mainSpec) || t("kader.player.noSpec")}` : "–"}</dd></div>
                <div><dt>{t("kader.account.logs")}</dt><dd>{p && p.logSpecs.length ? p.logSpecs.map((s) => specName(view.classes, s)).join(", ") : "–"}</dd></div>
                <div><dt>{t("kader.account.days")}</dt><dd>{days.length ? days.join(" · ") : "–"}</dd></div>
            </dl>
            {player.differs.length > 0
                ? <div className="kp-diffnote">{t("kader.account.differs", { what: player.differs.map((d) => t(`kader.diff.${d}`)).join(", ") })}</div>
                : <div className="kp-hint">{t("kader.account.differsNone")}</div>}
        </aside>
    );
}

export default function AccountModal({ userId, onClose }: { userId: string; onClose: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const { view, kader, players, run, canWrite } = useKader();
    const player = players.get(userId);
    const initial = useMemo(() => (player ? draftOf(player) : { chars: [], active: null }), [player]);
    const [chars, setChars] = useState<KaderCharacterInput[]>(initial.chars);
    const [active, setActive] = useState<string | null>(initial.active);
    const [sel, setSel] = useState(Math.max(0, initial.chars.findIndex((c) => c.id === initial.active)));
    const [busy, setBusy] = useState(false);

    if (!player) return null;
    const cur: KaderCharacterInput | undefined = chars[sel];
    const cls = cur ? classDef(view.classes, cur.className) : null;
    const main = cur ? cur.specs.find((s) => s.main) || cur.specs[0] : undefined;
    const entry = kader.players[userId];
    const dirty = JSON.stringify({ chars, active }) !== JSON.stringify(initial);
    const allValid = chars.every((c) => nameOk(c.name, c.nameStyle) && !!c.className);
    const [first, last] = splitName(cur ? cur.name : "");

    const patch = (fn: (c: KaderCharacterInput) => KaderCharacterInput) => setChars(chars.map((c, i) => (i === sel ? fn(c) : c)));
    const setName = (f: string, l: string) => patch((c) => ({ ...c, name: `${f} ${l}` }));
    const setClass = (key: string) => patch((c) => ({
        ...c,
        className: key,
        specs: c.className === key ? c.specs : [],
        canTank: c.className === key ? c.canTank : false,
        canHeal: c.className === key ? c.canHeal : false,
    }));
    const toggleSpec = (key: string) => patch((c) => {
        const has = c.specs.some((s) => s.spec === key);
        let specs = has ? c.specs.filter((s) => s.spec !== key) : [...c.specs, { spec: key, main: c.specs.length === 0, gear: "none" as KaderGear }];
        if (specs.length && !specs.some((s) => s.main)) specs = specs.map((s, i) => ({ ...s, main: i === 0 }));
        return { ...c, specs };
    });
    const makeMain = (key: string) => patch((c) => {
        const existing = c.specs.find((s) => s.spec === key);
        const old = c.specs.find((s) => s.main);
        const gear: KaderGear = existing ? existing.gear : (old ? old.gear : "none");
        return { ...c, specs: [{ spec: key, main: true, gear }, ...c.specs.filter((s) => s.spec !== key).map((s) => ({ ...s, main: false }))] };
    });
    const setGear = (gear: KaderGear) => patch((c) => ({ ...c, specs: c.specs.map((s) => (s.main ? { ...s, gear } : s)) }));
    const addChar = () => {
        const id = `n${Date.now().toString(36)}`;
        setChars([...chars, { id, name: " ", nameStyle: "forever", className: "", specs: [], canTank: false, canHeal: false }]);
        setSel(chars.length);
        if (!active) setActive(id);
    };
    const taken = (p: KaderPickable) => chars.some((c) => (p.key && c.onlineKey === p.key) || c.name.trim().toLowerCase() === p.name.toLowerCase());
    const pick = (p: KaderPickable) => {
        const next = fromPickable(p);
        setChars([...chars, next]);
        setSel(chars.length);
        if (!active) setActive(next.id);
    };
    const removeChar = () => {
        const next = chars.filter((_, i) => i !== sel);
        setChars(next);
        setSel(Math.max(0, sel - 1));
        if (cur && active === cur.id) setActive(next[0] ? next[0].id : null);
    };

    const save = async () => {
        if (!dirty) return onClose();
        setBusy(true);
        // a refusal (a name the rules do not allow) is a toast; the dialog stays open with the draft
        const next = await run(saveKaderAssignment(kader.id, userId, chars, active));
        setBusy(false);
        if (next) onClose();
    };
    const reset = async () => {
        if (!(await ask({ title: t("kader.account.resetTitle"), text: t("kader.account.resetText"), action: t("common.reset"), tone: "danger" }))) return;
        if (await run(resetKaderAssignment(kader.id, userId))) onClose();
    };
    const removeAccount = async () => {
        if (!(await ask({ title: t("kader.account.removeTitle", { name: player.displayName }), text: t("kader.account.removeText"), action: t("common.remove"), tone: "danger" }))) return;
        if (await run(removeKaderAccount(kader.id, userId))) onClose();
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            kicker={player.hasProfile ? t("kader.account.withProfile") : t("kader.account.manual")}
            title={`@${player.displayName}`}
            width={920}
            className="kp-dialog"
            hint={canWrite ? t("kader.account.onlyPlanner") : undefined}
            footer={canWrite ? (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<SaveIcon />} disabled={busy || !allValid} onClick={() => void save()}>{t("common.apply")}</Button>
                </>
            ) : <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <div className="kp-stack">
                <div className="kp-acc-status">
                    {entry ? (
                        <>
                            <span className="kicker">{t("kader.account.inKader", { kader: kader.name })}</span>
                            <StateBadge state={entry.state} />
                            <span className="kp-sub"><SinceText entry={entry} /></span>
                        </>
                    ) : <span className="kp-muted">{t("kader.account.notInKader", { kader: kader.name })}</span>}
                    <span className="kp-grow" />
                    {canWrite && player.hasOverride && <Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={() => void reset()}>{t("kader.account.reset")}</Button>}
                    {canWrite && player.manual && <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={() => void removeAccount()}>{t("kader.account.remove")}</Button>}
                </div>
                <div className="kp-chartabs" role="tablist" aria-label={t("kader.account.characters")}>
                    {chars.map((c, i) => {
                        const def = classDef(view.classes, c.className);
                        return (
                            <button key={c.id} type="button" role="tab" aria-selected={i === sel} className={`kp-chartab${i === sel ? " kp-active" : ""}${def ? " class-colored" : ""}`}
                                style={def ? { "--cc": def.color } as CSSProperties : undefined} onClick={() => setSel(i)}>
                                {c.name.trim() || t("kader.account.newChar")}{c.id === active ? ` · ${t("kader.account.used")}` : ""}
                            </button>
                        );
                    })}
                    {canWrite && <button type="button" className="kp-chartab kp-add" onClick={addChar} disabled={chars.length >= MAX_CHARS}>{t("kader.account.addChar")}</button>}
                </div>
                {canWrite && player.pickable.length > 0 && (
                    <div className="kp-fgroup" role="group" aria-label={t("kader.account.pickTitle")}>
                        <div className="kicker">{t("kader.account.pickTitle")}</div>
                        <div className="kp-picklist">
                            {player.pickable.map((p) => {
                                const def = classDef(view.classes, p.className);
                                const have = taken(p);
                                const mainSpec = p.specs.find((x) => x.main) || p.specs[0];
                                return (
                                    <button key={`${p.key}|${p.name}`} type="button" className={`kp-pick class-colored${have ? " kp-have" : ""}`} style={def ? { "--cc": def.color } as CSSProperties : undefined}
                                        disabled={have || chars.length >= MAX_CHARS} aria-label={p.name} onClick={() => pick(p)}>
                                        {mainSpec ? <SpecIcon specKey={mainSpec.spec} size={20} /> : <ClassIcon classKey={p.className} size={20} />}
                                        <span className="kp-pickname">{p.name}</span>
                                        <Badge tone="mid" size="sm">{p.source === "logs" ? t("kader.account.pickLogs") : VERSION_LABEL[p.versionId] || p.versionId.toUpperCase()}</Badge>
                                        {p.main && <Badge tone="accent" size="sm">{t("kader.account.pickMain")}</Badge>}
                                        {have && <span className="kp-sub">{t("kader.account.pickHave")}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="kp-accgrid">
                    {cur ? (
                        <fieldset className="kp-editor" disabled={!canWrite}>
                            <div className="kp-fgroup">
                                <Segment<KaderNameStyle> size="sm" ariaLabel={t("kader.field.nameStyle")} value={cur.nameStyle}
                                    options={[{ value: "forever", label: t("kader.field.nameForever") }, { value: "nick", label: t("kader.field.nameNick") }]}
                                    onChange={(style) => patch((c) => ({ ...c, nameStyle: style, name: switchNameStyle(c.name, style) }))} />
                                <div className="kp-namerow">
                                    {cur.nameStyle === "nick" ? (
                                        <Field label={t("kader.field.nickname")} htmlFor="kp-acc-nick">
                                            <input id="kp-acc-nick" maxLength={24} value={cur.name.trimStart()} onChange={(e) => patch((c) => ({ ...c, name: e.target.value }))} />
                                        </Field>
                                    ) : (
                                        <>
                                            <Field label={t("kader.field.firstName")} htmlFor="kp-acc-first">
                                                <input id="kp-acc-first" maxLength={12} value={first} onChange={(e) => setName(e.target.value.replace(/\s/g, ""), last)} />
                                            </Field>
                                            <Field label={t("kader.field.lastName")} htmlFor="kp-acc-last">
                                                <input id="kp-acc-last" maxLength={12} value={last} onChange={(e) => setName(first, e.target.value.replace(/\s/g, ""))} />
                                            </Field>
                                        </>
                                    )}
                                    {cur.id !== active && <Button variant="ghost" size="sm" onClick={() => setActive(cur.id)}>{t("kader.account.use")}</Button>}
                                </div>
                                {!nameOk(cur.name, cur.nameStyle) && cur.name.trim() !== "" && <span className="kp-error">{cur.nameStyle === "nick" ? t("kader.account.nickRule") : t("kader.account.nameRule")}</span>}
                            </div>
                            <div className="kp-fgroup">
                                <div className="kicker">{t("kader.field.class")}</div>
                                <div className="kp-classgrid">
                                    {view.classes.map((c) => (
                                        <button key={c.key} type="button" aria-pressed={cur.className === c.key} className={`kp-classtile class-colored${cur.className === c.key ? " kp-active" : ""}`}
                                            style={{ "--cc": c.color } as CSSProperties} onClick={() => setClass(c.key)}>
                                            <ClassIcon classKey={c.key} size={20} />{className(view.classes, c.key)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {cls && (
                                <>
                                    <div className="kp-fgroup">
                                        <div className="kicker">{t("kader.field.specs")}</div>
                                        <div className="kp-specrow">
                                            {cls.specs.map((s) => {
                                                const pick = cur.specs.find((x) => x.spec === s.key);
                                                const state = pick ? (pick.main ? "kp-main" : "kp-alt") : "";
                                                return (
                                                    <div key={s.key} className={`kp-spectile ${state}`}>
                                                        <button type="button" className="kp-spectoggle" aria-pressed={!!pick} onClick={() => toggleSpec(s.key)}>
                                                            <SpecIcon specKey={s.key} size={22} />
                                                            <span className="kp-col">
                                                                <span className="kp-specname">{specName(view.classes, s.key)}</span>
                                                                <span className="kp-sub">{roleLabel(s.role)}</span>
                                                            </span>
                                                        </button>
                                                        <button type="button" className="kp-star" aria-pressed={!!pick && pick.main} aria-label={t("kader.account.makeMain", { spec: specName(view.classes, s.key) })}
                                                            data-tip={t("kader.account.mainTip")} onClick={() => makeMain(s.key)}>{pick && pick.main ? "★" : "☆"}</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="kp-fgroup">
                                        <div className="kicker">{t("kader.field.gear")}</div>
                                        <Segment<KaderGear> size="sm" ariaLabel={t("kader.field.gear")} value={main ? main.gear : "none"}
                                            options={GEARS.map((g) => ({ value: g, label: t(`kader.gear.${g}`), disabled: !main }))} onChange={setGear} />
                                        <div className="kp-switches">
                                            <label className={cls.canTank ? "" : "kp-off"} data-tip={cls.canTank ? undefined : t("kader.account.noTank")}>
                                                <input type="checkbox" disabled={!cls.canTank} checked={cur.canTank} onChange={(e) => patch((c) => ({ ...c, canTank: e.target.checked }))} /> <RoleIcon role="tank" size={18} /> {t("kader.account.canTank")}
                                            </label>
                                            <label className={cls.canHeal ? "" : "kp-off"} data-tip={cls.canHeal ? undefined : t("kader.account.noHeal")}>
                                                <input type="checkbox" disabled={!cls.canHeal} checked={cur.canHeal} onChange={(e) => patch((c) => ({ ...c, canHeal: e.target.checked }))} /> <RoleIcon role="healer" size={18} /> {t("kader.account.canHeal")}
                                            </label>
                                        </div>
                                    </div>
                                </>
                            )}
                            {canWrite && <button type="button" className="kp-link kp-danger" onClick={removeChar}>{t("kader.account.removeChar")}</button>}
                            {cur.id === active && player.differs.length > 0 && !dirty && <Badge tone="mid" size="sm">{t("kader.diff.badge")}</Badge>}
                        </fieldset>
                    ) : (
                        <div className="kp-editor"><p className="kp-hint">{t("kader.account.noChars")}</p></div>
                    )}
                    <ProfilePanel player={player} />
                </div>
            </div>
        </Modal>
    );
}
