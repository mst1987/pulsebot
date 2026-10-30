import { useState } from "react";
import {
    editCharacterOf, getAllCharacters, getLogCharactersOf, removeCharacterOf, saveCharacterOf,
    type ApiError, type CharacterOwner, type GameClass, type ProfileCharacter, type ProfileData,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { Badge, Chip, IconButton, Modal, RaidLoader, Segment, WowIcon, useConfirm } from "../../components/ui";
import DataTable, { type Column } from "../../components/ui/DataTable";
import { useToast } from "../../components/shell/Jobs";
import { classColorProps } from "../../components/character/ClassSpec";
import EditCharacterDialog from "../../components/character/EditCharacterDialog";
import { CheckMark, EditIcon, EyeOffIcon, SearchIcon, TrashIcon, WarnIcon } from "../../components/ui/icons";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort } from "../../lib/ui/tableSort";
import { characterRows, editToast, filterRows, replaceRaider, unverified, type CharacterFilter, type CharacterRow } from "../../lib/profile/allCharacters";
import { classLabel, specLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { CharacterCard } from "./CharacterCard";

// "Alle Charaktere" — the orga's tab on the profile page: every character of
// every raider profile in one sortable list. A click opens the character's
// card as the raider sees it (specs, gear, the two switches, take it out); the
// pencil opens "Charakter bearbeiten" — set a wrong name right, by hand or by
// picking the logged character (src/web/apiRoutes/roster/characters.js); the bin
// takes a character out straight from the row (a mistyped second entry).
// Without write access to the roster area the list only reads.

type SortKey = "name" | "owner" | "cls" | "status" | "wish";

const FILTER_DEFAULT: CharacterFilter = { search: "", version: "", onlyUnverified: false };

export default function AllCharactersTab({ data, canWrite }: { data: ProfileData; canWrite: boolean }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const list = useApi(() => getAllCharacters(), []);
    const [filter, setFilter] = usePersistedState<CharacterFilter>("profile-all-filter", FILTER_DEFAULT);
    const sort = useTableSort<SortKey>("profile-all-sort", { name: "asc", owner: "asc", cls: "asc", status: "asc", wish: "desc" }, "name");
    const [open, setOpen] = useState<{ userId: string; key: string } | null>(null);
    const [editing, setEditing] = useState<{ userId: string; key: string } | null>(null);

    if (list.error) return <div className="empty">{t("profile.all.loadError", { message: list.error.message })}</div>;
    if (!list.data) return <RaidLoader text={t("profile.all.loading")} />;

    const raiders = list.data.raiders;
    const f = { ...FILTER_DEFAULT, ...filter };
    const all = characterRows(raiders);
    const rows = filterRows(all, f);
    const versions = (data.versions || []).filter((v) => all.some((r) => (r.character.versionId || "tbc") === v.id));
    const classesOf = (c: ProfileCharacter): GameClass[] => (c.versionId && data.classesByVersion?.[c.versionId]) || data.classes;
    const clsOf = (c: ProfileCharacter) => classesOf(c).find((x) => x.id === c.className);
    const find = (ref: { userId: string; key: string } | null) => {
        const owner = ref ? raiders.find((r) => r.userId === ref.userId) : undefined;
        const character = owner?.characters.find((c) => c.key === ref?.key);
        return owner && character ? { owner, character } : null;
    };
    const setRaider = (next: CharacterOwner) => list.setData((d) => (d ? { raiders: replaceRaider(d.raiders, next) } : d));

    const shown = find(open);
    const edited = find(editing);

    const save = async (userId: string, key: string, patch: Parameters<typeof saveCharacterOf>[2]) => {
        try {
            setRaider((await saveCharacterOf(userId, key, patch)).raider);
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    const remove = async (owner: CharacterOwner, c: ProfileCharacter) => {
        if (!(await ask({ title: t("profile.all.removeTitle", { name: c.name, owner: owner.name }), text: t("profile.all.removeText"), action: t("profile.remove.action") }))) return;
        try {
            setRaider((await removeCharacterOf(owner.userId, c.key)).raider);
            setOpen(null);
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    const status = (c: ProfileCharacter) => {
        if (c.claimedBy.length) return <Badge tone="mid" tip={t("profile.char.claimed")} tipSub={c.claimedBy.map((x) => x.name).join(", ")}>{t("profile.all.claimed")}</Badge>;
        if (unverified(c)) return <Badge tone="mid" icon={<WarnIcon />} tip={t("profile.char.unverified")} tipSub={t("profile.char.unverifiedTip")}>{t("profile.char.unverified")}</Badge>;
        return <Badge tone="ok" icon={<CheckMark />}>{t(`profile.all.via.${c.evidence?.via || "manual"}`)}</Badge>;
    };
    const statusRank = (c: ProfileCharacter) => (c.claimedBy.length ? 0 : unverified(c) ? 1 : 2);

    const columns: Column<CharacterRow, SortKey>[] = [
        {
            id: "name", label: t("profile.all.colCharacter"), sortKey: "name",
            cell: ({ character: c }) => {
                const cls = clsOf(c);
                const color = classColorProps(cls?.color);
                return (
                    <span className="pf-all-char">
                        <WowIcon name={cls?.icon || "inv_misc_questionmark"} size={24} />
                        <span>
                            <b className={color.className} style={color.style}>{c.name}</b>
                            {c.realm && <span className="kicker">{c.realm}</span>}
                        </span>
                    </span>
                );
            },
        },
        { id: "owner", label: t("profile.all.colOwner"), sortKey: "owner", cell: (r) => r.owner || "–" },
        { id: "cls", label: t("profile.all.colClass"), sortKey: "cls", cell: ({ character: c }) => classLabel(c.className, clsOf(c)?.label || c.className) },
        {
            id: "specs", label: t("profile.all.colSpecs"),
            cell: ({ character: c }) => (c.specs.length ? (
                <span className="pf-all-specs">
                    {c.specs.map((s) => (
                        <span key={s.key} data-tip={specLabel(s.key, s.label)} data-tip-sub={t(`profile.gear.${s.gear}`)} className={`pf-all-spec pf-gear-${s.gear}`}>
                            <WowIcon name={s.icon || "inv_misc_questionmark"} size={22} />
                        </span>
                    ))}
                </span>
            ) : <span className="note">{t("profile.all.noSpec")}</span>),
        },
        ...(versions.length > 1 ? [{ id: "version", label: t("profile.all.colVersion"), cell: (r: CharacterRow) => (data.versions || []).find((v) => v.id === (r.character.versionId || "tbc"))?.short || r.character.versionId } as Column<CharacterRow, SortKey>] : []),
        { id: "status", label: t("profile.all.colStatus"), sortKey: "status", cell: ({ character: c }) => status(c) },
        // the raider's wish items (Loot-Council rosters) - only the orga reads this list
        {
            id: "wish", label: t("profile.all.colWish"), sortKey: "wish",
            cell: ({ character: c }) => {
                const wishes = c.wishItems || [];
                return wishes.length
                    ? <Badge icon={<EyeOffIcon />} tip={t("profile.all.wishTip", { count: wishes.length })} tipSub={wishes.map((w) => w.name).join("\n")}>{t("profile.all.wishCount", { count: wishes.length })}</Badge>
                    : <span className="note">–</span>;
            },
        },
        ...(canWrite ? [{
            id: "actions", actions: true,
            cell: (r: CharacterRow) => {
                const owner = raiders.find((x) => x.userId === r.userId);
                return (
                    <span className="row-actions is-end pf-all-actions">
                        <IconButton icon={<EditIcon />} size="sm" tip={t("profile.char.edit")} tipSub={t("profile.all.editSub", { name: r.character.name })}
                            onClick={() => setEditing({ userId: r.userId, key: r.character.key })} />
                        {owner && (
                            <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("profile.char.remove")} tipSub={t("profile.all.removeSub")}
                                aria-label={`${t("profile.char.remove")}: ${r.character.name}`} onClick={() => { void remove(owner, r.character); }} />
                        )}
                    </span>
                );
            },
        } as Column<CharacterRow, SortKey>] : []),
    ];

    const sortValue = (r: CharacterRow, key: SortKey) => {
        if (key === "owner") return (r.owner || "").toLowerCase();
        if (key === "cls") return r.character.className.toLowerCase();
        if (key === "status") return statusRank(r.character);
        if (key === "wish") return (r.character.wishItems || []).length;
        return r.character.name.toLowerCase();
    };

    const unverifiedCount = all.filter((r) => unverified(r.character)).length;

    return (
        <section className="pf-all" aria-label={t("profile.tabs.all")}>
            <div className="pf-all-bar">
                <div className="pf-search">
                    <SearchIcon />
                    <input className="inp-sm" value={f.search} placeholder={t("profile.all.search")} aria-label={t("profile.all.search")}
                        onChange={(e) => setFilter({ ...f, search: e.target.value })} />
                </div>
                {versions.length > 1 && (
                    <Segment<string>
                        size="sm"
                        ariaLabel={t("profile.all.versionAria")}
                        value={f.version}
                        onChange={(version) => setFilter({ ...f, version })}
                        options={[{ value: "", label: t("profile.all.allVersions") }, ...versions.map((v) => ({ value: v.id, label: v.short || v.label }))]}
                    />
                )}
                <Chip pressed={f.onlyUnverified} tone={f.onlyUnverified ? "accent" : undefined} icon={<WarnIcon />}
                    onClick={() => setFilter({ ...f, onlyUnverified: !f.onlyUnverified })}>
                    {t("profile.all.onlyUnverified", { count: unverifiedCount })}
                </Chip>
                <span className="pf-all-grow" />
                <span className="note">{t("profile.all.count", { count: rows.length })}</span>
            </div>

            <DataTable
                rows={rows}
                columns={columns}
                rowKey={(r) => `${r.userId}:${r.character.key}`}
                sort={sort}
                sortValue={sortValue}
                onRowClick={canWrite ? (r) => setOpen({ userId: r.userId, key: r.character.key }) : undefined}
                rowClassName={canWrite ? "pf-all-row is-clickable" : "pf-all-row"}
                wrapClassName="pf-all-wrap"
                pageSize={50}
                empty={<p className="empty">{all.length ? t("profile.all.noHit") : t("profile.all.none")}</p>}
            />

            {shown && (
                <Modal open onClose={() => setOpen(null)} icon={clsOf(shown.character)?.icon} tone="profile"
                    kicker={t("profile.edit.kickerOf", { owner: shown.owner.name })} title={shown.character.name} width={760}>
                    <CharacterCard
                        character={shown.character}
                        cls={clsOf(shown.character)}
                        data={data}
                        onMove={{}}
                        onSpecs={(specs) => save(shown.owner.userId, shown.character.key, { specs: specs.map((s) => ({ key: s.key, gear: s.gear })) })}
                        onRoles={(field, value) => save(shown.owner.userId, shown.character.key, { [field]: value })}
                        onRemove={() => remove(shown.owner, shown.character)}
                        onEdit={() => { setOpen(null); setEditing({ userId: shown.owner.userId, key: shown.character.key }); }}
                    />
                </Modal>
            )}

            <EditCharacterDialog
                character={edited ? edited.character : null}
                classes={edited ? classesOf(edited.character) : data.classes}
                lastName={!!edited && !!(data.versions || []).find((v) => v.id === edited.character.versionId)?.lastName}
                owner={edited?.owner.name || ""}
                loadLog={(q) => getLogCharactersOf(edited?.owner.userId || "", edited?.character.key || "", q)}
                onClose={() => setEditing(null)}
                onSave={async (input) => {
                    if (!edited) return;
                    const res = await editCharacterOf(edited.owner.userId, edited.character.key, input);
                    setRaider(res.raider);
                    setEditing(null);
                    toast(editToast(edited.character.name, res.renamed ? res.renamed.toName : null, res.moved));
                }}
            />
        </section>
    );
}
