import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../../components/shell/Shell";
import {
    canAccess, canAccessAny, editProfileCharacter, getLogCharacters, getProfile, getProfileRaiding, getRaiderAttendance, saveProfile,
    removeProfileCharacter, getCalendarTokens,
    type ApiError, type ProfileCharacter, type ProfilePatch, type RaiderProfile,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, PageHead, RaidLoader, useConfirm } from "../../components/ui";
import { useToast } from "../../components/shell/Jobs";
import AddCharacterDialog, { type AddWay } from "../../components/character/AddCharacterDialog";
import EditCharacterDialog from "../../components/character/EditCharacterDialog";
import { isOrga } from "../../lib/app/orgaArea";
import { editToast } from "../../lib/profile/allCharacters";
import AllCharactersTab from "./AllCharactersTab";
import { formatDate } from "../../lib/format";
import { specSuggestion } from "../../lib/settings/raidhelperRetirement";
import { useT } from "../../i18n";
import "../../styles/profile.css";
import type { Fold } from "./ProfileParts";
import { CharacterCard, FirstCharacter } from "./CharacterCard";
import { InfoTab } from "./InfoTab";
import { DungeonPart, LootPart, RosterPart, type Loaded } from "./CharacterTab";
import { ProfileTabs, type ProfileTab } from "./ProfileTabs";
import { charactersOfVersion, groupByVersion, moveInVersion, versionOf } from "../../lib/roster/characterVersions";
import { useContentVersion } from "../../hooks/useContentVersion";
import { useFollowVersion } from "../../hooks/useFollowVersion";

// "Mein Profil": tabs instead of character chips — [Meine Infos] first (what
// belongs to the person), then one tab per character of the menu's version in
// the raider's own order (no main), [+], and "Alle Charaktere" for the orga.
// The tab is in the URL: none = Meine Infos, `?char=<key>` a character,
// `?view=all` the orga's list — so every tab is a link.

export default function ProfilePage() {
    const content = useContentVersion();
    const { user } = useOutletContext<ShellContext>();
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();
    const profileData = useApi(() => getProfile(), []);
    const { data, setData } = profileData;
    const [params, setParams] = useSearchParams();
    const [infoFold, setInfoFold] = useState<Fold>("days");
    // null = not touched on this character yet: then its loot is open when it has some (rendered below)
    const [charFold, setCharFold] = useState<Fold | null>(null);
    const [adding, setAdding] = useState<AddWay | null>(null);
    const [editing, setEditing] = useState<ProfileCharacter | null>(null);
    // "Alle Charaktere" (?view=all): the orga's tab — every raider's characters, editable with write access to the roster area.
    const orga = isOrga(user) && canAccess(user, "roster");
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
    const selected = linked && shownChars.includes(linked) ? linked : null;
    const tab: ProfileTab = orga && params.get("view") === "all" ? { kind: "all" }
        : selected ? { kind: "char", key: selected.key } : { kind: "info" };

    // What the tabs read besides the profile, each asked for once its tab was open (and again for another version):
    // "Meine Infos" the attendance, a character's tab the roster, loot and dungeon runs.
    const [infoSeen, setInfoSeen] = useState(false);
    const [charSeen, setCharSeen] = useState(false);
    useEffect(() => {
        if (tab.kind === "info") setInfoSeen(true);
        if (tab.kind === "char") setCharSeen(true);
    }, [tab.kind]);
    // another character starts with its own default folds again
    const selectedKey = selected?.key || "";
    useEffect(() => { setCharFold(null); }, [selectedKey]);
    const attendance = useApi(() => getRaiderAttendance("", shownVersion), [shownVersion], { enabled: infoSeen });
    const shownKeys = shownChars.map((c) => c.key).join("|");
    const raiding = useApi(() => getProfileRaiding(shownVersion), [shownVersion, shownKeys], { enabled: charSeen });

    // A character's class from its own version's rule set (#543), the main version's as a fallback.
    const classesOf = (c: ProfileCharacter) => (c.versionId && data?.classesByVersion?.[c.versionId]) || data?.classes || [];
    const classOf = (c: ProfileCharacter) => classesOf(c).find((x) => x.id === c.className);

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

    const selectTab = (next: ProfileTab) => {
        const p = new URLSearchParams(params);
        p.delete("char");
        p.delete("view");
        if (next.kind === "char") p.set("char", next.key);
        if (next.kind === "all") p.set("view", "all");
        setParams(p, { replace: true });
    };
    const selectChar = (key: string) => selectTab({ kind: "char", key });

    const removeChar = async (c: ProfileCharacter) => {
        if (!(await ask({ title: t("profile.remove.title", { name: c.name }), text: t("profile.remove.text"), action: t("profile.remove.action") }))) return;
        try {
            const res = await removeProfileCharacter(c.key);
            setProfile(res.profile);
            selectTab({ kind: "info" });
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    // the shown version's (else the main version's) first character - there is no main, only the raider's order
    const first = charactersOfVersion(shownChars, shownVersion ? "" : data.mainVersion || "")[0] || shownChars[0] || null;
    const headClass = first ? classOf(first) : undefined;

    /** One place forward / back inside its version, saved as the raider's whole order (optimistic). */
    const moveOf = (c: ProfileCharacter) => {
        const to = (dir: -1 | 1) => {
            const next = moveInVersion(profile.characters, c.key, dir);
            return next ? () => { void patch({ order: next.map((x) => x.key) }, { characters: next }); } : undefined;
        };
        return { forward: to(-1), back: to(1) };
    };
    // Grouped by game version, the main version first (#543) — under the shell one version, so one group.
    // Other versions hidden (#563): only the main version's (nothing is removed).
    const groups = groupByVersion(shownChars, data.versions || [], data.mainVersion || "")
        .filter((g) => !content.hidden || !content.mainVersion || g.id === content.mainVersion);
    const tabChars = groups.flatMap((g) => g.characters);
    // A new character is one of the shown version: the add dialog offers no other while a version is shown.
    const addVersions = shownVersion && (data.versions || []).some((v) => v.id === shownVersion)
        ? (data.versions || []).filter((v) => v.id === shownVersion) : data.versions;
    const labelOf = (versionId: string) => groups.find((g) => g.id === versionId)?.label || versionId;

    // The raiding answer only while it is the current one: during a reload (another version, a character
    // added or renamed) the old answer is not shown - no TBC roster under Forever, no "Noch kein Loot" for
    // a character the old answer did not know yet.
    const raidingNow = !raiding.loading && raiding.data && (!shownVersion || raiding.data.versionId === shownVersion) ? raiding.data : null;
    /** A part of the raiding answer, as the folds read it: the data, or that it is loading / failed. */
    function raidingOf<T>(pick: (r: NonNullable<typeof raiding.data>) => T): Loaded<T> {
        if (raidingNow) return pick(raidingNow);
        return raiding.error && !raiding.loading ? "failed" : "loading";
    }
    const charRaiding = selected ? raidingNow?.characters[selected.key] : undefined;
    const dungeons = charRaiding?.dungeons || null;
    // the loot is open when there is some, until the raider opens or closes a part of this character
    const shownCharFold: Fold = charFold ?? (charRaiding && charRaiding.loot.count > 0 ? "loot" : "");

    return (
        <div className="pf-page">
            <PageHead
                icon={headClass ? headClass.icon : "achievement_character_human_male"}
                tone="profile"
                kicker={`Discord · ${user.name} · ${t("profile.characters", { count: shownChars.length })}`}
                title={t("profile.title")}
                meta={profile.updatedAt ? <Badge>{t("profile.changed", { date: formatDate(profile.updatedAt) })}</Badge> : <Badge tone="accent">{t("profile.new")}</Badge>}
            />

            <ProfileTabs
                characters={tabChars}
                classOf={classOf}
                current={tab}
                orga={orga}
                onSelect={selectTab}
                onAdd={() => setAdding("log")}
            />

            {tab.kind === "all" && <AllCharactersTab data={data} canWrite={canAccess(user, "roster", "write")} />}

            {tab.kind === "info" && (
                <>
                    {shownChars.length === 0 && <FirstCharacter onPick={setAdding} />}
                    <InfoTab
                        data={data}
                        profile={profile}
                        fold={infoFold}
                        onFold={setInfoFold}
                        patch={patch}
                        ask={ask}
                        calendar={cal}
                        onCalendar={setCal}
                        attendance={attendance.data}
                        attendanceFailed={!!attendance.error && !attendance.data}
                    />
                </>
            )}

            {tab.kind === "char" && selected && (
                <div className="pf-grid pf-grid-even">
                    <div className="pf-col">
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
                            onEdit={() => setEditing(selected)}
                        />
                        <RosterPart charKey={selected.key} rosters={raidingOf((r) => r.rosters)} fold={shownCharFold} onFold={setCharFold} />
                        {/* Part 2: the professions (Berufe) go here, under the roster. */}
                    </div>
                    <div className="pf-col">
                        <LootPart
                            name={selected.name}
                            loot={raidingOf((r) => r.characters[selected.key]?.loot || { count: 0, lastAt: 0, items: [] })}
                            fold={shownCharFold}
                            onFold={setCharFold}
                            historyLink={canAccessAny(user, ["history", "loot"])}
                        />
                        {/* Only with LevelHelper data for this character (WoW Forever): no block, no empty state otherwise. */}
                        {dungeons && <DungeonPart dungeons={dungeons} fold={shownCharFold} onFold={setCharFold} />}
                        {/* Part 2: the wish items (Wunsch-Items, loot-council categories only) go here. */}
                    </div>
                </div>
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

            <EditCharacterDialog
                character={editing}
                classes={editing ? classesOf(editing) : data.classes}
                lastName={!!editing && !!(data.versions || []).find((v) => v.id === editing.versionId)?.lastName}
                loadLog={(q) => getLogCharacters(q, editing?.key || "")}
                onClose={() => setEditing(null)}
                onSave={async (input) => {
                    if (!editing) return;
                    const res = await editProfileCharacter(editing.key, input);
                    setProfile(res.profile);
                    selectChar(res.character.key);
                    setEditing(null);
                    toast(editToast(editing.name, res.renamed ? res.renamed.toName : null, res.moved));
                }}
            />
        </div>
    );
}
