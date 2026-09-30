// One Discord account in the Kaderplaner: its Forever characters as the planner
// sees them (name "Vorname Nachname", class, specs with one main spec, gear,
// tank/heal) on the left, what EventHelper knows on the right — read only. The
// planner's assignment wins inside the planner and is never written back to the
// raider profile; where it deviates, the dialog says so.
import { useMemo, useState, type CSSProperties } from "react";
import { removeKaderAccount, resetKaderAssignment, saveKaderAssignment, type KaderCharacterInput, type KaderGear, type KaderPlayer } from "../../api";
import { Badge, Button, Modal, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { useT } from "../../i18n";
import { roleLabel } from "../../lib/wowNames";
import { formatDayMonth } from "../../lib/format";
import { className, classDef, specName, statusOf, type Status } from "../../lib/kader/model";
import { DAYS } from "../../lib/kader/players";
import { useKader } from "./kaderContext";

const NAME_PART = /^\p{L}{2,12}$/u;
const GEARS: KaderGear[] = ["none", "usable", "ready"];
const MAX_CHARS = 8;

/** The editable copy of a player's characters (profile ids become new planner ids with an onlineKey). */
function draftOf(player: KaderPlayer): { chars: KaderCharacterInput[]; active: string | null } {
    return {
        chars: player.characters.map((c) => ({
            id: c.id,
            name: c.name,
            className: c.className,
            specs: c.specs.map((s) => ({ ...s })),
            canTank: c.canTank,
            canHeal: c.canHeal,
            ...(c.onlineKey ? { onlineKey: c.onlineKey } : {}),
        })),
        active: player.activeCharacterId,
    };
}

const splitName = (name: string): [string, string] => {
    const i = name.indexOf(" ");
    return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
};
const nameOk = (name: string): boolean => {
    const [a, b] = splitName(name);
    return NAME_PART.test(a) && NAME_PART.test(b);
};

/** What EventHelper knows about the account: read only. */
function ProfilePanel({ player }: { player: KaderPlayer }) {
    const t = useT();
    const { view } = useKader();
    const att = player.attendance;
    const missed = att ? att.nights.filter((n) => !n.attended).length : 0;
    const days = DAYS.filter((d) => player.availability.includes(d)).map((d) => t(`kader.day.${d}`));
    const p = player.profile;
    return (
        <aside className="kp-profile">
            <span className="kicker kp-accent2">{t("kader.account.fromProfile")}</span>
            {!player.hasProfile && <p className="kp-hint">{t("kader.account.noProfile")}</p>}
            {player.hasProfile && !att && <p className="kp-hint">{t("kader.account.noNights")}</p>}
            {att && (
                <div className="kp-attblock">
                    <div className="kp-between"><span className="kp-muted">{t("kader.account.attendance")}</span><span className="kp-big kp-mono">{att.pct} %</span></div>
                    <div className="kp-nights">
                        {att.nights.map((n, i) => (
                            <i key={`${n.date}-${i}`} className={n.attended ? "on" : "off"}
                                data-tip={`${n.date ? formatDayMonth(Date.parse(`${n.date}T12:00:00Z`)) : ""} · ${n.title}`}
                                data-tip-sub={n.attended ? t("kader.account.there") : (n.reason || t("kader.account.missed"))} />
                        ))}
                    </div>
                    <span className="kp-sub">{t("kader.account.nights", { n: att.counted, there: att.attended, missed })}</span>
                </div>
            )}
            <dl className="kp-facts">
                <div><dt>{t("kader.account.profileSays")}</dt><dd>{p ? `${p.character} · ${className(view.classes, p.className)} · ${specName(view.classes, p.mainSpec) || t("kader.player.noSpec")}` : "–"}</dd></div>
                <div><dt>{t("kader.account.logs")}</dt><dd>{p && p.logSpecs.length ? p.logSpecs.map((s) => specName(view.classes, s)).join(", ") : "–"}</dd></div>
                <div><dt>{t("kader.account.days")}</dt><dd>{days.length ? days.join(" · ") : "–"}</dd></div>
            </dl>
            {player.differs.length > 0
                ? <div className="kp-diffnote">{t("kader.account.differs", { what: player.differs.map((d) => t(`kader.diff.${d}`)).join(", ") })}</div>
                : <div className="kp-sub">{t("kader.account.differsNone")}</div>}
        </aside>
    );
}

export default function AccountModal({ userId, onClose }: { userId: string; onClose: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const { view, roster, players, run, place, canWrite } = useKader();
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
    const status = statusOf(roster, userId);
    const dirty = JSON.stringify({ chars, active }) !== JSON.stringify(initial);
    const allValid = chars.every((c) => nameOk(c.name) && !!c.className);
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
        setChars([...chars, { id, name: " ", className: "", specs: [], canTank: false, canHeal: false }]);
        setSel(chars.length);
        if (!active) setActive(id);
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
        const next = await run(saveKaderAssignment(userId, chars, active));
        setBusy(false);
        if (next) onClose();
    };
    const reset = async () => {
        if (!(await ask({ title: t("kader.account.resetTitle"), text: t("kader.account.resetText"), action: t("common.reset"), tone: "danger" }))) return;
        if (await run(resetKaderAssignment(userId))) onClose();
    };
    const removeAccount = async () => {
        if (!(await ask({ title: t("kader.account.removeTitle", { name: player.displayName }), action: t("common.remove"), tone: "danger" }))) return;
        if (await run(removeKaderAccount(userId))) onClose();
    };

    const statusOptions: { value: Status; label: string }[] = [
        { value: "none", label: t("kader.status.none") },
        { value: "kader", label: t("kader.status.kader") },
        { value: "bench", label: t("kader.status.bench") },
    ];

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            kicker={player.hasProfile ? t("kader.account.withProfile") : t("kader.account.manual")}
            title={`@${player.displayName}`}
            width={900}
            hint={canWrite ? t("kader.account.onlyPlanner") : undefined}
            footer={canWrite ? (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={busy || !allValid} onClick={() => void save()}>{t("common.apply")}</Button>
                </>
            ) : <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {roster && canWrite && (
                <div className="kp-acc-status">
                    <span className="kicker">{t("kader.account.inRoster", { roster: roster.name })}</span>
                    <Segment<Status> size="sm" ariaLabel={t("kader.account.inRoster", { roster: roster.name })} value={status} options={statusOptions}
                        onChange={(v) => void place(userId, v === "kader" ? "role" : v === "bench" ? "bench" : "free")} />
                    {player.hasOverride && <button type="button" className="kp-link" onClick={() => void reset()}>{t("kader.account.reset")}</button>}
                    {player.manual && <button type="button" className="kp-link kp-danger" onClick={() => void removeAccount()}>{t("kader.account.remove")}</button>}
                </div>
            )}
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
            <div className="kp-accgrid">
                {cur ? (
                    <fieldset className="kp-editor" disabled={!canWrite}>
                        <div className="kp-namerow">
                            <label className="field">
                                <span className="field-label">{t("kader.field.firstName")}</span>
                                <input maxLength={12} value={first} onChange={(e) => setName(e.target.value.replace(/\s/g, ""), last)} />
                            </label>
                            <label className="field">
                                <span className="field-label">{t("kader.field.lastName")}</span>
                                <input maxLength={12} value={last} onChange={(e) => setName(first, e.target.value.replace(/\s/g, ""))} />
                            </label>
                            {cur.id !== active && <Button variant="ghost" size="sm" onClick={() => setActive(cur.id)}>{t("kader.account.use")}</Button>}
                        </div>
                        {!nameOk(cur.name) && cur.name.trim() !== "" && <span className="kp-error">{t("kader.account.nameRule")}</span>}
                        <div className="kicker">{t("kader.field.class")}</div>
                        <div className="kp-classgrid">
                            {view.classes.map((c) => (
                                <button key={c.key} type="button" aria-pressed={cur.className === c.key} className={`kp-classtile class-colored${cur.className === c.key ? " kp-active" : ""}`}
                                    style={{ "--cc": c.color } as CSSProperties} onClick={() => setClass(c.key)}>
                                    <span className="kp-swatch" />{className(view.classes, c.key)}
                                </button>
                            ))}
                        </div>
                        {cls && (
                            <>
                                <div className="kicker">{t("kader.field.specs")}</div>
                                <div className="kp-specrow">
                                    {cls.specs.map((s) => {
                                        const pick = cur.specs.find((x) => x.spec === s.key);
                                        const state = pick ? (pick.main ? "kp-main" : "kp-alt") : "";
                                        return (
                                            <div key={s.key} className={`kp-spectile ${state}`}>
                                                <button type="button" className="kp-spectoggle" aria-pressed={!!pick} onClick={() => toggleSpec(s.key)}>
                                                    <span className="kp-specname">{specName(view.classes, s.key)}</span>
                                                    <span className="kp-sub">{roleLabel(s.role)}</span>
                                                </button>
                                                <button type="button" className="kp-star" aria-pressed={!!pick && pick.main} aria-label={t("kader.account.makeMain", { spec: specName(view.classes, s.key) })}
                                                    data-tip={t("kader.account.mainTip")} onClick={() => makeMain(s.key)}>{pick && pick.main ? "★" : "☆"}</button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="kicker">{t("kader.field.gear")}</div>
                                <Segment<KaderGear> size="sm" ariaLabel={t("kader.field.gear")} value={main ? main.gear : "none"}
                                    options={GEARS.map((g) => ({ value: g, label: t(`kader.gear.${g}`), disabled: !main }))} onChange={setGear} />
                                <div className="kp-switches">
                                    <label className={cls.canTank ? "" : "kp-off"} data-tip={cls.canTank ? undefined : t("kader.account.noTank")}>
                                        <input type="checkbox" disabled={!cls.canTank} checked={cur.canTank} onChange={(e) => patch((c) => ({ ...c, canTank: e.target.checked }))} /> {t("kader.account.canTank")}
                                    </label>
                                    <label className={cls.canHeal ? "" : "kp-off"} data-tip={cls.canHeal ? undefined : t("kader.account.noHeal")}>
                                        <input type="checkbox" disabled={!cls.canHeal} checked={cur.canHeal} onChange={(e) => patch((c) => ({ ...c, canHeal: e.target.checked }))} /> {t("kader.account.canHeal")}
                                    </label>
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
        </Modal>
    );
}
