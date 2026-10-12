import { useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../../components/shell/Shell";
import { getProfile, saveProfile, removeProfileCharacter, getCalendarTokens, type ApiError, type ProfileCharacter, type ProfilePatch, type RaiderProfile } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Button, PageHead, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/shell/Jobs";
import AddCharacterDialog, { type AddWay } from "../../components/character/AddCharacterDialog";
import { EyeOffIcon } from "../../components/ui/icons";
import { formatDate } from "../../lib/format";
import { specSuggestion } from "../../lib/settings/raidhelperRetirement";
import { tOr, useT } from "../../i18n";
import "../../styles/profile.css";
import { AvoidPart, type Fold, FoldPart, NoteField, RaidPicker, WishPicker } from "./ProfileParts";
import { CharacterCard, CharChip, FirstCharacter } from "./CharacterCard";
import { CalendarPart } from "./CalendarPart";
import { charactersOfVersion, groupByVersion, moveInVersion, versionOf } from "../../lib/roster/characterVersions";
import { useContentVersion } from "../../hooks/useContentVersion";
import { useFollowVersion } from "../../hooks/useFollowVersion";

export default function ProfilePage() {
    const content = useContentVersion();
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
    // One version at a time (#741): the page shows the characters of the menu's
    // version only - Forever characters under Forever, TBC characters under TBC.
    // Without a menu version (outside the shell) every version, grouped.
    const shownVersion = content.version || "";
    const shownChars = charactersOfVersion(profile?.characters || [], shownVersion);
    // A link to a character of another version (?char=) switches the menu to its
    // version; switching the menu away again leaves the character.
    const linked = profile?.characters.find((c) => c.key === params.get("char")) || null;
    useFollowVersion(linked ? versionOf(linked) : "", () => {
        const next = new URLSearchParams(params);
        next.delete("char");
        setParams(next, { replace: true });
    });
    // the shown version's (else the main version's) first character - there is no main, only the raider's order
    const firstOfVersion = charactersOfVersion(shownChars, shownVersion ? "" : data?.mainVersion || "")[0] || shownChars[0] || null;
    const selected = (linked && shownChars.includes(linked) ? linked : null) || firstOfVersion;
    // A character's class from its own version's rule set (#543), the main version's as a fallback.
    const classOf = (c: ProfileCharacter) => ((c.versionId && data?.classesByVersion?.[c.versionId]) || data?.classes || []).find((x) => x.id === c.className);

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

    const first = firstOfVersion;
    const headClass = first ? classOf(first) : undefined;

    /** One place forward / back inside its version, saved as the raider's whole order (optimistic). */
    const moveOf = (c: ProfileCharacter) => {
        const to = (dir: -1 | 1) => {
            const next = moveInVersion(profile.characters, c.key, dir);
            // the moved character stays the one shown — the default selection is the first, which may now be another
            return next ? () => { selectChar(c.key); void patch({ order: next.map((x) => x.key) }, { characters: next }); } : undefined;
        };
        return { forward: to(-1), back: to(1) };
    };
    // Grouped by game version, the main version first (#543) — one group needs no heading.
    // The menu's version only (#741); other versions hidden (#563): only the main version's (nothing is removed).
    const groups = groupByVersion(shownChars, data.versions || [], data.mainVersion || "")
        .filter((g) => !content.hidden || !content.mainVersion || g.id === content.mainVersion);
    // A new character is one of the shown version: the add dialog offers no other while a version is shown.
    const addVersions = shownVersion && (data.versions || []).some((v) => v.id === shownVersion)
        ? (data.versions || []).filter((v) => v.id === shownVersion) : data.versions;
    const labelOf = (versionId: string) => groups.find((g) => g.id === versionId)?.label || versionId;

    return (
        <div className="pf-page">
            <PageHead
                icon={headClass ? headClass.icon : "achievement_character_human_male"}
                tone="profile"
                kicker={`Discord · ${user.name} · ${t("profile.characters", { count: shownChars.length })}`}
                title={t("profile.title")}
                meta={profile.updatedAt ? <Badge>{t("profile.changed", { date: formatDate(profile.updatedAt) })}</Badge> : <Badge tone="accent">{t("profile.new")}</Badge>}
                action={shownChars.length > 0 && (
                    <Button icon="inv_misc_grouplooking" onClick={() => setAdding("log")}>{t("profile.addCharacter")}</Button>
                )}
            />

            {shownChars.length === 0 ? (
                <FirstCharacter onPick={setAdding} />
            ) : (
                <>
                    <div className="pf-chip-groups">
                        {groups.map((g) => (
                            <div key={g.id} className="pf-chip-group" data-version={g.id}>
                                {groups.length > 1 && <span className="kicker pf-chip-group-label">{t("profile.versionGroup", { version: g.label })}</span>}
                                <div className="pf-chips" role="tablist" aria-label={groups.length > 1 ? t("profile.versionGroup", { version: g.label }) : t("profile.charactersAria")}>
                                    {g.characters.map((c) => (
                                        <CharChip key={c.key} character={c} cls={classOf(c)} active={c.key === selected?.key} onClick={() => selectChar(c.key)} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="pf-grid">
                        <div className="pf-col">
                            {selected && (
                                <CharacterCard
                                    character={selected}
                                    cls={classOf(selected)}
                                    versionLabel={groups.length > 1 ? labelOf(selected.versionId) : ""}
                                    data={data}
                                    onMove={moveOf(selected)}
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
                                summary={profile.wishes.length ? profile.wishes.map((w) => w.character || w.name).join(", ") : t("profile.fold.wishesNone")}
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
                                    : profile.avoid.length ? profile.avoid.map((w) => w.character || w.name).join(", ") : t("profile.fold.avoidNone")}
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
                versions={addVersions}
                classesByVersion={data.classesByVersion}
                defaultVersion={shownVersion || data.mainVersion}
                suggestionFor={(versionId) => specSuggestion((data.specHistory || []).filter((h) => (h.versionId || "tbc") === versionId))}
                onAdded={(next, key) => {
                    setProfile(next);
                    selectChar(key);
                    setAdding(null);
                }}
            />
        </div>
    );
}
