import { useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../../components/Shell";
import { getProfile, saveProfile, removeProfileCharacter, getCalendarTokens, type ApiError, type ProfileCharacter, type ProfilePatch, type RaiderProfile } from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Button, PageHead, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/Jobs";
import AddCharacterDialog, { type AddWay } from "../../components/profile/AddCharacterDialog";
import { EyeOffIcon } from "../../components/icons";
import { formatDate } from "../../lib/format";
import { specSuggestion } from "../../lib/raidhelperRetirement";
import { tOr, useT } from "../../i18n";
import "../../styles/profil.css";
import { AvoidPart, type Fold, FoldPart, NoteField, RaidPicker, WishPicker } from "./ProfileParts";
import { CharacterCard, CharChip, FirstCharacter } from "./CharacterCard";
import { CalendarPart } from "./CalendarPart";

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
