import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../components/Shell";
import {
    getProfile, saveProfile, removeProfileCharacter, searchRaiders,
    getCalendarTokens, createCalendarToken, revokeCalendarToken,
    type ApiError, type CalendarToken, type CalendarTokens, type GameClass, type GearLevel,
    type ProfileCharacter, type ProfileData, type ProfilePatch,
    type ProfileSpec, type RaiderProfile, type RaiderRef,
} from "../api";
import { useApi } from "../hooks/useApi";
import { Badge, Button, Expand, IconButton, PageHead, PartHead, RaidLoader, Segment, WowIcon, useConfirm } from "../components/ui";
import { classColorProps } from "../components/ClassSpec";
import { useToast } from "../components/Jobs";
import AddCharacterDialog, { type AddWay } from "../components/profile/AddCharacterDialog";
import { ExternalIcon, TrashIcon, XIcon, SearchIcon, EyeOffIcon, CopyIcon, CheckIcon } from "../components/icons";
import { formatDate } from "../lib/format";
import { specSuggestion } from "../lib/raidhelperRetirement";
import { classLabel, instanceName, roleLabel, specLabel } from "../lib/wowNames";
import { tOr, useT } from "../i18n";
import "../styles/profil.css";

// "Mein Profil" (#255): the raider's own page. Deliberately calm — the
// characters on top, the selected character's specs as the one big thing, and
// everything else (when, which raids, with whom, a note) folded in a side column
// that shows one line per part until it is opened. Every change saves itself;
// there is no form to submit.

type Fold = "days" | "raids" | "wishes" | "avoid" | "note" | "calendar" | "";

const LOG_TONE: Record<ProfileSpec["logs"]["status"], "ok" | "mid" | undefined> = { seen: "ok", other: "mid", unknown: undefined };

export default function ProfilePage() {
    const { user } = useOutletContext<ShellContext>();
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const profileData = useApi(() => getProfile(), []);
    const { data, setData } = profileData;
    const [params, setParams] = useSearchParams();
    const [fold, setFold] = useState<Fold>("days");
    const [adding, setAdding] = useState<AddWay | null>(null);
    // Kalender-Abo (#312) — its own small payload, so the profile request stays
    // what it was; a failed load leaves the fold at "loading", as before.
    const calendar = useApi(() => getCalendarTokens(), []);
    const cal = calendar.error ? null : calendar.data;
    const setCal = calendar.setData;

    const profile = data?.profile || null;
    const selectedKey = params.get("char") || profile?.characters.find((c) => c.main)?.key || profile?.characters[0]?.key || "";
    const selected = profile?.characters.find((c) => c.key === selectedKey) || profile?.characters[0] || null;
    const classOf = (id: string) => data?.classes.find((c) => c.id === id);

    if (profileData.error) return <div className="empty">{t("profile.loadError", { message: profileData.error.message })}</div>;
    if (!data || !profile) return <RaidLoader text={t("profile.loading")} />;

    const setProfile = (next: RaiderProfile) => setData((d) => (d ? { ...d, profile: next, isNew: false } : d));

    // Optimistic: the page shows the change at once and takes the server's
    // answer (normalized) when it comes back; a failure puts the old state back.
    const patch = async (change: ProfilePatch, optimistic?: Partial<RaiderProfile>) => {
        const before = profile;
        if (optimistic) setProfile({ ...profile, ...optimistic });
        try {
            const res = await saveProfile(change);
            setProfile(res.profile);
        } catch (e) {
            setProfile(before);
            toast((e as ApiError).message, "err");
        }
    };

    const selectChar = (key: string) => {
        const next = new URLSearchParams(params);
        next.set("char", key);
        setParams(next, { replace: true });
    };

    const removeChar = async (c: ProfileCharacter) => {
        if (!(await ask({ title: t("profile.remove.title", { name: c.name }), text: t("profile.remove.text"), action: t("profile.remove.action") }))) return;
        try {
            const res = await removeProfileCharacter(c.key);
            setProfile(res.profile);
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    const main = profile.characters.find((c) => c.main);
    const mainClass = main ? classOf(main.className) : undefined;

    return (
        <div className="pf-page">
            <PageHead
                icon={mainClass ? mainClass.icon : "achievement_character_human_male"}
                tone="profile"
                kicker={`Discord · ${user.name} · ${t("profile.characters", { count: profile.characters.length })}`}
                title={t("profile.title")}
                meta={profile.updatedAt ? <Badge>{t("profile.changed", { date: formatDate(profile.updatedAt) })}</Badge> : <Badge tone="accent">{t("profile.new")}</Badge>}
                action={profile.characters.length > 0 && (
                    <Button icon="inv_misc_grouplooking" onClick={() => setAdding("log")}>{t("profile.addCharacter")}</Button>
                )}
            />

            {profile.characters.length === 0 ? (
                <FirstCharacter onPick={setAdding} />
            ) : (
                <>
                    <div className="pf-chips" role="tablist" aria-label={t("profile.charactersAria")}>
                        {profile.characters.map((c) => (
                            <CharChip key={c.key} character={c} cls={classOf(c.className)} active={c.key === selected?.key} onClick={() => selectChar(c.key)} />
                        ))}
                    </div>

                    <div className="pf-grid">
                        <div className="pf-col">
                            {selected && (
                                <CharacterCard
                                    character={selected}
                                    cls={classOf(selected.className)}
                                    data={data}
                                    onMain={() => patch(
                                        { characters: [{ key: selected.key, main: true }] },
                                        { characters: profile.characters.map((c) => ({ ...c, main: c.key === selected.key })) },
                                    )}
                                    onSpecs={(specs) => patch(
                                        { characters: [{ key: selected.key, specs: specs.map((s) => ({ key: s.key, gear: s.gear })) }] },
                                        { characters: profile.characters.map((c) => (c.key === selected.key ? { ...c, specs } : c)) },
                                    )}
                                    onRoles={(field, value) => patch(
                                        { characters: [{ key: selected.key, [field]: value }] },
                                        { characters: profile.characters.map((c) => (c.key === selected.key ? { ...c, [field]: value } : c)) },
                                    )}
                                    onRemove={() => removeChar(selected)}
                                />
                            )}
                        </div>

                        <div className="pf-col pf-side">
                            <FoldPart
                                id="days" open={fold} onOpen={setFold} title={t("profile.fold.days")}
                                summary={profile.availability.length
                                    ? (
                                        <span className="pf-day-sum">
                                            {data.weekdays.filter((d) => profile.availability.includes(d.id)).map((d) => (
                                                <span key={d.id} className="pf-day-tag" data-day={d.id}>{tOr(`profile.weekday.${d.id}`, d.label)}</span>
                                            ))}
                                        </span>
                                    )
                                    : t("profile.fold.daysNone")}
                            >
                                <div className="pf-days">
                                    {data.weekdays.map((d) => {
                                        const on = profile.availability.includes(d.id);
                                        const next = on ? profile.availability.filter((x) => x !== d.id) : [...profile.availability, d.id];
                                        return (
                                            <button key={d.id} type="button" data-day={d.id} className={`pf-day${on ? " is-on" : ""}`} aria-pressed={on}
                                                onClick={() => patch({ availability: next }, { availability: next })}>
                                                {tOr(`profile.weekday.${d.id}`, d.label)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </FoldPart>

                            <FoldPart
                                id="raids" open={fold} onOpen={setFold} title={t("profile.fold.raids")}
                                summary={profile.preferredRaids.length ? t("profile.fold.raidsChosen", { count: profile.preferredRaids.length }) : t("profile.fold.raidsNone")}
                            >
                                <RaidPicker data={data} value={profile.preferredRaids} onChange={(next) => patch({ preferredRaids: next }, { preferredRaids: next })} />
                            </FoldPart>

                            <FoldPart
                                id="wishes" open={fold} onOpen={setFold} title={t("profile.fold.wishes")}
                                summary={profile.wishes.length ? profile.wishes.map((w) => w.main || w.name).join(", ") : t("profile.fold.wishesNone")}
                                badge={<Badge icon={<EyeOffIcon />} tip={t("profile.fold.orgaOnlyTip")} tipSub={t("profile.fold.orgaOnlySub")}>{t("profile.fold.orgaOnly")}</Badge>}
                            >
                                <WishPicker
                                    wishes={profile.wishes}
                                    max={data.limits.wishes}
                                    classes={data.classes}
                                    exclude={profile.avoid}
                                    hint={t("profile.wishes.hint")}
                                    onChange={(next) => patch({ wishes: next.map((w) => w.userId) }, { wishes: next })}
                                />
                            </FoldPart>

                            <FoldPart
                                id="avoid" open={fold} onOpen={setFold} title={t("profile.fold.avoid")}
                                summary={!profile.avoidEnabled
                                    ? t("profile.fold.avoidOff")
                                    : profile.avoid.length ? profile.avoid.map((w) => w.main || w.name).join(", ") : t("profile.fold.avoidNone")}
                                badge={<Badge icon={<EyeOffIcon />} tip={t("profile.fold.orgaOnlyTip")} tipSub={t("profile.avoid.orgaOnlySub")}>{t("profile.fold.orgaOnly")}</Badge>}
                            >
                                <AvoidPart
                                    profile={profile}
                                    max={data.limits.avoid}
                                    classes={data.classes}
                                    onEnable={async (on) => {
                                        if (on && !(await ask({
                                            title: t("profile.avoid.confirmTitle"),
                                            text: t("profile.avoid.confirmText"),
                                            action: t("profile.avoid.confirmAction"),
                                        }))) return;
                                        patch({ avoidEnabled: on }, { avoidEnabled: on, avoid: on ? profile.avoid : [] });
                                    }}
                                    onChange={(next) => patch({ avoid: next.map((w) => w.userId) }, { avoid: next })}
                                />
                            </FoldPart>

                            <FoldPart
                                id="note" open={fold} onOpen={setFold} title={t("profile.fold.note")}
                                summary={profile.note ? profile.note : t("profile.fold.noteNone")}
                            >
                                <NoteField value={profile.note} max={data.limits.note} onSave={(note) => patch({ note }, { note })} />
                            </FoldPart>

                            <FoldPart
                                id="calendar" open={fold} onOpen={setFold} title={t("profile.fold.calendar")}
                                summary={!cal ? t("profile.fold.calendarLoading") : cal.tokens.length === 0 ? t("profile.fold.calendarNone") : t("profile.fold.calendarActive", { count: cal.tokens.length })}
                            >
                                <CalendarPart data={cal} onChange={setCal} />
                            </FoldPart>
                        </div>
                    </div>
                </>
            )}

            <AddCharacterDialog
                way={adding}
                onClose={() => setAdding(null)}
                classes={data.classes}
                suggestion={specSuggestion(data.specHistory)}
                onAdded={(next, key) => {
                    setProfile(next);
                    selectChar(key);
                    setAdding(null);
                }}
            />
        </div>
    );
}

/** No character yet: the three ways in, nothing else. */
function FirstCharacter({ onPick }: { onPick: (way: AddWay) => void }) {
    const t = useT();
    const ways: { way: AddWay; icon: string; title: string; text: string }[] = [
        { way: "log", icon: "inv_misc_pocketwatch_01", title: t("profile.first.logTitle"), text: t("profile.first.logText") },
        { way: "armory", icon: "inv_misc_book_09", title: t("profile.first.armoryTitle"), text: t("profile.first.armoryText") },
        { way: "manual", icon: "inv_scroll_03", title: t("profile.first.manualTitle"), text: t("profile.first.manualText") },
    ];
    return (
        <div className="pf-first">
            <PartHead icon="achievement_character_human_male" tone="profile" title={t("profile.first.title")} crumb={t("profile.first.crumb")} />
            <div className="pf-ways">
                {ways.map((w) => (
                    <button key={w.way} type="button" className="pf-way" onClick={() => onPick(w.way)}>
                        <WowIcon name={w.icon} size={32} />
                        <span className="pf-way-title">{w.title}</span>
                        <span className="pf-way-text">{w.text}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function CharChip({ character, cls, active, onClick }: { character: ProfileCharacter; cls?: GameClass; active: boolean; onClick: () => void }) {
    const t = useT();
    const color = classColorProps(cls?.color);
    const claimed = character.claimedBy.length > 0;
    return (
        <button type="button" role="tab" aria-selected={active} className={`pf-chip${active ? " is-active" : ""}`} onClick={onClick}>
            {cls && <WowIcon name={cls.icon} size={22} />}
            <span className={color.className} style={color.style}>{character.name}</span>
            {character.main && <span className="pf-chip-main">{t("profile.char.main")}</span>}
            {claimed && (
                <span className="pf-chip-warn" data-tip={t("profile.char.claimed")} data-tip-sub={t("profile.char.claimedChip", { names: character.claimedBy.map((c) => c.name || t("profile.char.unknown")).join(", ") })}>!</span>
            )}
        </button>
    );
}

function CharacterCard({ character, cls, data, onMain, onSpecs, onRoles, onRemove }: {
    character: ProfileCharacter;
    cls?: GameClass;
    data: ProfileData;
    onMain: () => void;
    onSpecs: (specs: ProfileSpec[]) => void;
    onRoles: (field: RoleField, value: boolean) => void;
    onRemove: () => void;
}) {
    const t = useT();
    const [picking, setPicking] = useState(false);
    const missing = (cls?.specs || []).filter((s) => !character.specs.some((own) => own.key === s.key));
    const crumb = [classLabel(character.className, cls?.label || character.className), character.realm, character.armory?.level ? t("profile.char.level", { level: character.armory.level }) : "", character.armory?.guild || ""]
        .filter(Boolean).join(" · ");

    const addSpec = (key: string) => {
        const spec = cls?.specs.find((s) => s.key === key);
        if (!spec) return;
        onSpecs([...character.specs, {
            key, gear: "usable", label: spec.label, specId: spec.id, role: spec.role, icon: spec.icon,
            canTank: spec.canTank, canHeal: spec.canHeal, logs: { status: "unknown", reports: 0 },
        }]);
        setPicking(false);
    };

    return (
        <section className="pf-card">
            <PartHead
                icon={cls?.icon || "inv_misc_questionmark"}
                title={character.name}
                crumb={crumb}
                action={(
                    <>
                        {character.claimedBy.length > 0 && (
                            <Badge tone="mid" tip={t("profile.char.claimed")} tipSub={t("profile.char.claimedCard", { names: character.claimedBy.map((c) => c.name || t("profile.char.unknown")).join(", ") })}>
                                {t("profile.char.claimedBy", { name: character.claimedBy[0].name || t("profile.char.otherAccount") })}
                            </Badge>
                        )}
                        {character.main
                            ? <Badge tone="accent">{t("profile.char.main")}</Badge>
                            : <Button variant="ghost" size="sm" onClick={onMain}>{t("profile.char.makeMain")}</Button>}
                        {character.armoryUrl && (
                            <a className="ibtn sm" href={character.armoryUrl} target="_blank" rel="noreferrer" aria-label={t("profile.char.armory")} data-tip={t("profile.char.openArmory")}>
                                <ExternalIcon />
                            </a>
                        )}
                        <IconButton icon={<TrashIcon />} tip={t("profile.char.remove")} size="sm" tone="danger" onClick={onRemove} />
                    </>
                )}
            />

            <div className="pf-specs">
                {character.specs.length === 0 && <p className="pf-muted">{t("profile.char.noSpec")}</p>}
                {character.specs.map((s) => {
                    const logTone = LOG_TONE[s.logs.status];
                    const logLabel = s.logs.status === "unknown" ? "" : t(`profile.logs.${s.logs.status}`);
                    const logTip = s.logs.status === "unknown" ? "" : t(`profile.logs.${s.logs.status}Tip`);
                    return (
                        <div key={s.key} className="pf-spec">
                            <WowIcon name={s.icon || "inv_misc_questionmark"} size={30} />
                            <div className="pf-spec-name">
                                <span className="pf-spec-label">{specLabel(s.key, s.label)}</span>
                                <span className="kicker">{s.role ? roleLabel(s.role, data.roles[s.role as keyof ProfileData["roles"]] || "") : ""}</span>
                            </div>
                            {logLabel && (
                                <Badge tone={logTone} tip={logLabel} tipSub={s.logs.reports ? `${logTip}\n${t("profile.logs.reports", { count: s.logs.reports })}` : logTip}>
                                    {logLabel}
                                </Badge>
                            )}
                            <Segment<GearLevel>
                                size="sm"
                                ariaLabel={t("profile.gearAria", { spec: specLabel(s.key, s.label) })}
                                value={s.gear}
                                options={data.gearLevels.map((g) => ({ value: g.id, label: tOr(`profile.gear.${g.id}`, g.label) }))}
                                onChange={(gear) => onSpecs(character.specs.map((x) => (x.key === s.key ? { ...x, gear } : x)))}
                            />
                            <IconButton icon={<XIcon />} tip={t("profile.char.removeSpec")} size="sm" onClick={() => onSpecs(character.specs.filter((x) => x.key !== s.key))} />
                        </div>
                    );
                })}
            </div>

            {missing.length > 0 && (
                <div className="pf-addspec">
                    {picking
                        ? missing.map((s) => (
                            <Button key={s.key} variant="ghost" size="sm" icon={s.icon} onClick={() => addSpec(s.key)}>{specLabel(s.key, s.label)}</Button>
                        ))
                        : <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>{t("profile.char.addSpec")}</Button>}
                </div>
            )}

            <RolesRow character={character} onChange={onRoles} />
        </section>
    );
}

type RoleField = "canOfftank" | "canHeal";

/** "Kann offtanken / heilen" of the selected character — a druid main may tank, the priest twink not. */
function RolesRow({ character, onChange }: { character: ProfileCharacter; onChange: (field: RoleField, value: boolean) => void }) {
    const t = useT();
    const rows: { field: RoleField; icon: string; label: string }[] = [
        { field: "canOfftank", icon: "ability_warrior_defensivestance", label: t("profile.roles.offtank") },
        { field: "canHeal", icon: "spell_holy_flashheal", label: t("profile.roles.heal") },
    ];
    return (
        <div className="pf-roles">
            {rows.map((r) => {
                // a class without a tank / healing spec: off and not switchable
                const possible = character.possible[r.field];
                return (
                    <label key={r.field} className={`pf-role${possible ? "" : " pf-role-off"}`}
                        data-tip={t("profile.roles.forChar", { label: r.label, name: character.name })}
                        data-tip-sub={possible
                            ? t("profile.roles.suggested", { answer: character.suggested[r.field] ? t("profile.roles.yes") : t("profile.roles.no") })
                            : t(`profile.roles.impossible.${r.field}`, { cls: classLabel(character.className, character.className) })}>
                        <WowIcon name={r.icon} size={26} />
                        <span className="pf-role-label">{r.label}</span>
                        <span className="switch">
                            <input type="checkbox" checked={possible && character[r.field]} disabled={!possible} onChange={(e) => onChange(r.field, e.target.checked)} />
                            <span className="switch-track"><span className="switch-thumb" /></span>
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

/**
 * "Nicht mit X raiden": off until the raider switches it on — past a question
 * that reminds them everyone deserves a chance. Only the orga reads it, and
 * only when it asks for it while building a setup. Switching it off forgets
 * the names.
 */
function AvoidPart({ profile, max, classes, onEnable, onChange }: {
    profile: RaiderProfile;
    max: number;
    classes: GameClass[];
    onEnable: (on: boolean) => void;
    onChange: (next: RaiderRef[]) => void;
}) {
    const t = useT();
    return (
        <div className="pf-avoid">
            <label className="pf-avoid-switch">
                <span className="pf-avoid-label">{t("profile.avoid.switch")}</span>
                <span className="switch">
                    <input type="checkbox" checked={profile.avoidEnabled} onChange={(e) => onEnable(e.target.checked)} aria-label={t("profile.avoid.switch")} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
            </label>
            {profile.avoidEnabled
                ? (
                    <WishPicker
                        wishes={profile.avoid}
                        max={max}
                        classes={classes}
                        exclude={profile.wishes}
                        hint={t("profile.avoid.hint")}
                        onChange={onChange}
                    />
                )
                : <p className="pf-muted">{t("profile.avoid.offText")}</p>}
        </div>
    );
}

/** One foldable part of the side column: title and a one-line summary, the body only when open. */
function FoldPart({ id, open, onOpen, title, summary, badge, children }: {
    id: Exclude<Fold, "">;
    open: Fold;
    onOpen: (f: Fold) => void;
    title: string;
    summary: ReactNode;
    badge?: ReactNode;
    children: ReactNode;
}) {
    const isOpen = open === id;
    return (
        <section className={`pf-fold${isOpen ? " is-open" : ""}`}>
            <div className="pf-fold-head">
                <button type="button" className="pf-fold-title" onClick={() => onOpen(isOpen ? "" : id)}>
                    <span className="pf-fold-name">{title}</span>
                    {!isOpen && <span className="pf-fold-sum">{summary}</span>}
                </button>
                {badge}
                <Expand open={isOpen} onToggle={() => onOpen(isOpen ? "" : id)} label={title} showLabel={false} />
            </div>
            {isOpen && <div className="pf-fold-body">{children}</div>}
        </section>
    );
}

/**
 * Kalender-Abo (#312): one link the raider pastes into Outlook, Google or Apple
 * once — every raid they are signed up for turns up in it by itself.
 *
 * The secret exists in exactly one answer, the one that created it: the server
 * keeps only a hash and can never hand it back. So the link is shown here once,
 * with the warning that it is secret, and whoever loses it revokes that row and
 * makes a new one. Nothing is looked up, nothing is shown a second time.
 */
function CalendarPart({ data, onChange }: {
    data: CalendarTokens | null;
    onChange: (next: CalendarTokens) => void;
}) {
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const [fresh, setFresh] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!data) return <RaidLoader compact text={t("profile.cal.loading")} />;

    const create = async () => {
        setBusy(true);
        try {
            const res = await createCalendarToken();
            onChange(res);
            setFresh(res.url);
            setCopied(false);
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (token: CalendarToken) => {
        if (!(await ask({
            title: t("profile.cal.revokeTitle"),
            text: t("profile.cal.revokeText"),
            action: t("profile.cal.revoke"),
        }))) return;
        try {
            const res = await revokeCalendarToken(token.id);
            onChange(res);
            setFresh("");
            toast(t("profile.cal.revoked"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    return (
        <div className="pf-cal">
            <p className="pf-muted">
                {t("profile.cal.intro")}
                {" "}<strong>{t("profile.cal.secret")}</strong> {t("profile.cal.secretText")}
            </p>

            {fresh && (
                <div className="pf-cal-fresh">
                    <Badge tone="mid">{t("profile.cal.onlyNow")}</Badge>
                    <div className="pf-cal-link">
                        <input type="text" readOnly className="mono" value={fresh} onFocus={(e) => e.target.select()} />
                        <IconButton
                            icon={copied ? <CheckIcon /> : <CopyIcon />}
                            tip={copied ? t("profile.cal.copied") : t("profile.cal.copy")}
                            onClick={() => { navigator.clipboard?.writeText(fresh); setCopied(true); }}
                        />
                    </div>
                </div>
            )}

            {data.tokens.map((token) => (
                <div className="pf-cal-row" key={token.id}>
                    <span className="pf-cal-name">
                        {t("profile.cal.link", { hint: token.hint })}
                        <span className="kicker">
                            {t("profile.cal.created", { date: formatDate(token.createdAt) })}
                            {token.lastUsedAt ? t("profile.cal.lastUsed", { date: formatDate(token.lastUsedAt) }) : t("profile.cal.neverUsed")}
                        </span>
                    </span>
                    <IconButton icon={<TrashIcon />} tip={t("profile.cal.revoke")} onClick={() => revoke(token)} />
                </div>
            ))}

            {!data.configured
                ? <p className="pf-muted pf-err">{t("profile.cal.noBaseUrl")}</p>
                : (
                    <Button
                        variant="ghost"
                        onClick={create}
                        disabled={busy || data.tokens.length >= data.max}
                    >
                        {busy ? t("profile.cal.creating") : data.tokens.length ? t("profile.cal.createMore") : t("profile.cal.create")}
                    </Button>
                )}
        </div>
    );
}

function RaidPicker({ data, value, onChange }: { data: ProfileData; value: string[]; onChange: (next: string[]) => void }) {
    const t = useT();
    // Groups the rule set's versions; a version stays folded unless it holds a pick.
    const [shown, setShown] = useState<string>(() => data.raidGroups.find((g) => g.instances.some((i) => value.includes(i.id)))?.id || data.raidGroups[0]?.id || "");
    const group = data.raidGroups.find((g) => g.id === shown) || data.raidGroups[0];
    return (
        <div className="pf-raids">
            {data.raidGroups.length > 1 && (
                <Segment size="sm" ariaLabel={t("profile.raids.versionAria")} value={group.id} onChange={setShown}
                    options={data.raidGroups.map((g) => ({ value: g.id, label: g.label }))} />
            )}
            <div className="pf-raid-list">
                {group.instances.map((i) => {
                    const on = value.includes(i.id);
                    return (
                        <button key={i.id} type="button" className={`pf-raid${on ? " is-on" : ""}`} aria-pressed={on}
                            data-tip={instanceName(i.id, i.name)} data-tip-sub={i.status === "incomplete" ? t("profile.raids.incomplete") : undefined}
                            onClick={() => onChange(on ? value.filter((x) => x !== i.id) : [...value, i.id])}>
                            <WowIcon name={i.icon} size={20} />
                            {i.short}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** A short list of raiders with a search — the wishes, and the same for "nicht zusammen". */
function WishPicker({ wishes, max, classes, exclude = [], hint, onChange }: {
    wishes: RaiderRef[];
    max: number;
    classes: GameClass[];
    /** Raiders already on the other list — nobody is wished for and avoided at once. */
    exclude?: RaiderRef[];
    hint: string;
    onChange: (next: RaiderRef[]) => void;
}) {
    const t = useT();
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<RaiderRef[]>([]);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => {
        window.clearTimeout(timer.current);
        if (!q.trim()) { setHits([]); return; }
        timer.current = window.setTimeout(() => {
            searchRaiders(q).then((r) => setHits(r.raiders)).catch(() => setHits([]));
        }, 250);
        return () => window.clearTimeout(timer.current);
    }, [q]);

    const chosen = new Set([...wishes, ...exclude].map((w) => w.userId));
    const colorOf = (id: string) => classColorProps(classes.find((c) => c.id === id)?.color);
    return (
        <div className="pf-wishes">
            {wishes.length > 0 && (
                <div className="pf-wish-list">
                    {wishes.map((w) => {
                        const color = colorOf(w.className);
                        return (
                            <span key={w.userId} className="pf-wish">
                                <span className={color.className} style={color.style}>{w.main || w.name || t("profile.char.unknown")}</span>
                                {w.main && w.name && <span className="pf-muted">{w.name}</span>}
                                <IconButton icon={<XIcon />} tip={t("profile.wishes.remove")} size="sm" onClick={() => onChange(wishes.filter((x) => x.userId !== w.userId))} />
                            </span>
                        );
                    })}
                </div>
            )}
            {wishes.length < max && (
                <div className="pf-search">
                    <SearchIcon />
                    <input className="inp-sm" placeholder={t("profile.wishes.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("profile.wishes.searchAria")} />
                </div>
            )}
            {hits.filter((h) => !chosen.has(h.userId)).slice(0, 6).map((h) => {
                const color = colorOf(h.className);
                return (
                    <button key={h.userId} type="button" className="pf-hit" onClick={() => { onChange([...wishes, h]); setQ(""); }}>
                        <span className={color.className} style={color.style}>{h.main || h.name}</span>
                        {h.main && <span className="pf-muted">{h.name}</span>}
                    </button>
                );
            })}
            <p className="hint">{hint}</p>
        </div>
    );
}

function NoteField({ value, max, onSave }: { value: string; max: number; onSave: (note: string) => void }) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const dirty = useMemo(() => draft.trim() !== value.trim(), [draft, value]);
    return (
        <div className="pf-note">
            <textarea
                value={draft} maxLength={max} rows={3} aria-label={t("profile.fold.note")}
                placeholder={t("profile.note.placeholder")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (dirty) onSave(draft); }}
            />
            <span className="kicker">{draft.length} / {max}</span>
        </div>
    );
}
