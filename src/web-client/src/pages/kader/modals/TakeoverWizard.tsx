// The Kader's one way out (docs/kaderplaner.md "Übernahme"): the green button on
// the decision and the composition page ("Roster anlegen" without a linked
// roster, "In Discord übernehmen" with one, gone after a takeover) opens this
// assistant with a precheck loaded at that moment.
// With Discord: four steps — the role (name, colour, icon where the server can
// show one; without a linked roster also the new roster's name and optional raid
// category - only full admins get that far), the category and channels, who gets
// the role (with the switch that unlocks the start), the result (each Discord
// step, then the role hand-out as it runs).
// Without a linked roster step one has a switch "Auch in Discord anlegen". Off:
// only the roster's name and category, then who comes along (Roster → Stamm,
// Bench → Ersatz, Tentative → Probe) and POST /api/rosters/create; a Discord
// blocker (bot offline, missing rights) locks only this switch, never that way.
// After the takeover the Kader's head shows one line instead: the role, how many
// of the planned players have it, the category, and "Rolle nachziehen (n)" for
// the players who reached provisional afterwards. The logic sits in
// lib/kader/takeover.ts, the server checks everything again.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
    createKaderRoster, getKaderTakeover, pullKaderTakeoverRole, startKaderTakeover,
    type ApiError, type KaderServerEmoji, type KaderTakeoverCheck, type KaderTakeoverPlayer, type KaderTakeoverStart, type KaderTakeoverStep,
} from "../../../api";
import { Button, DataTable, Field, IconButton, Modal, Segment, Switch, type Column } from "../../../components/ui";
import EmojiPicker from "../../../components/ui/overlay/EmojiPicker";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import { useConfirm } from "../../../components/ui/overlay/Modal";
import { AlertIcon, ArrowLeftIcon, CheckIcon, ChevronRightIcon, DiscordIcon, PlusIcon, RefreshIcon, TrashIcon, XIcon } from "../../../components/ui/icons/icons";
import { useToast } from "../../../components/shell/Jobs";
import { useApi } from "../../../hooks/useApi";
import { useT } from "../../../i18n";
import { countStates, playerName } from "../../../lib/kader/model";
import {
    MAX_TAKEOVER_CHANNELS, ROSTER_NAME_MAX, ROSTER_ONLY_STATES, TAKEOVER_NAME_MAX, TAKEOVER_STATES, bodyOf, canStartDraft, categoryPreview, channelKey, channelPreview,
    defaultDraft, entryBlocker, isHexColor, pendingOf, progressOf, rosterBlocker, startBlocker, stepProblems, takeoverErrorKey, visibleSteps, withCheckRoster,
    type TakeoverDraft, type TakeoverStep,
} from "../../../lib/kader/takeover";
import { useTableSort } from "../../../lib/ui/tableSort";
import { StateBadge } from "../parts";
import { useKader } from "../kaderContext";

/** How often the result step and the head look again while the role goes out (ms). */
const POLL_MS = 3000;

type T = ReturnType<typeof useT>;

/** A refusal in words: our own for the known codes, else the server's message. */
function errorText(e: unknown, t: T): string {
    const err = e as ApiError;
    const key = err && err.code ? takeoverErrorKey(err.code) : null;
    return key ? t(key) : (err && err.message) || t("kader.error");
}

/** The coloured square of a role colour ("" = Discord's grey). */
function RoleSwatch({ color }: { color: string }) {
    return <span className="kp-tk-swatch" style={color ? { "--tk-role": color } as CSSProperties : undefined} aria-hidden="true" />;
}

/** The refusals of "Roster anlegen" in words (kader.roster.error.*). */
const CREATE_CODES = ["category_taken", "kader_not_found", "invalid_name", "name_too_long", "admin_only", "kader_taken", "version_mismatch", "version_hidden"];

/** The step bar: three or four words, the open one marked, the done ones with a check. */
function StepBar({ step, steps, discord }: { step: TakeoverStep; steps: TakeoverStep[]; discord: boolean }) {
    const t = useT();
    const at = steps.indexOf(step);
    return (
        <ol className="kp-tk-steps" aria-label={t("kader.takeover.stepsAria")}>
            {steps.map((s, i) => (
                <li key={s} className={`kp-tk-step${i === at ? " kp-active" : ""}${i < at ? " kp-done" : ""}`} aria-current={i === at ? "step" : undefined}>
                    <span className="kp-tk-stepn" aria-hidden="true">{i < at ? <CheckIcon /> : i + 1}</span>
                    {t(!discord && s === "role" ? "kader.takeover.step.roster" : `kader.takeover.step.${s}`)}
                </li>
            ))}
        </ol>
    );
}

/**
 * An emoji field: the picker and, with an emoji set, a button that clears it.
 * With `server` the server's own emojis come first ("Server"); picking one sets
 * `serverValue` (its id) and clears the Unicode one, and the other way round.
 */
function EmojiField({ value, onChange, label, disabled = false, server, serverValue = "", onServerChange }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    disabled?: boolean;
    server?: KaderServerEmoji[];
    serverValue?: string;
    onServerChange?: (id: string) => void;
}) {
    const t = useT();
    const currentCustom = (serverValue && server?.find((e) => e.id === serverValue)) || null;
    const set = !!(value || currentCustom);
    const clear = () => {
        onChange("");
        onServerChange?.("");
    };
    return (
        <span className="kp-tk-emoji">
            <EmojiPicker label={label} current={value} host="dialog" disabled={disabled} onPick={onChange}
                custom={server && server.length ? { label: t("emoji.server"), emojis: server } : undefined}
                onPickCustom={onServerChange ? (e) => onServerChange(e.id) : undefined} currentCustom={currentCustom} />
            {set && !disabled && (
                <IconButton icon={<XIcon />} tone="ghost" tip={t("kader.takeover.emojiClear")} onClick={clear} />
            )}
        </span>
    );
}

function Problems({ draft, step }: { draft: TakeoverDraft; step: TakeoverStep }) {
    const t = useT();
    const list = stepProblems(draft, step);
    if (!list.length) return null;
    return (
        <ul className="kp-tk-problems" role="alert">
            {list.map((p) => <li key={p}><AlertIcon />{t(`kader.takeover.problem.${p}`, { max: MAX_TAKEOVER_CHANNELS })}</li>)}
        </ul>
    );
}

/**
 * Without a linked roster: the roster the takeover creates - its name (the
 * Kader's, changeable) and optionally a raid category of the Kader's version
 * that has no roster yet ("none" by default, the Kader's attendance categories
 * marked as suggestion).
 */
function NewRosterBlock({ draft, set, check }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck }) {
    const t = useT();
    const nr = draft.newRoster;
    if (!nr) return null;
    const cats = check.rosterCategories || [];
    const setNr = (p: Partial<NonNullable<TakeoverDraft["newRoster"]>>) => set({ newRoster: { ...nr, ...p } });
    return (
        <div className="kp-tk-block">
            <span className="kicker">{t("kader.takeover.roster.title")}</span>
            <Field label={t("kader.takeover.roster.name")} htmlFor="kp-tk-roster">
                <input id="kp-tk-roster" value={nr.name} maxLength={ROSTER_NAME_MAX} onChange={(e) => setNr({ name: e.target.value })} />
            </Field>
            <Field label={t("kader.takeover.roster.category")} htmlFor="kp-tk-rostercat">
                <select id="kp-tk-rostercat" value={nr.categoryId} disabled={!cats.length} onChange={(e) => setNr({ categoryId: e.target.value })}>
                    <option value="">{t("kader.takeover.roster.noCategory")}</option>
                    {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.suggested ? t("kader.takeover.roster.suggested", { name: c.name }) : c.name}</option>
                    ))}
                </select>
            </Field>
            <span className="hint">{cats.length ? t("kader.takeover.roster.categoryHint") : t("kader.takeover.roster.noFreeCategory")}</span>
        </div>
    );
}

function RoleStep({ draft, set, check }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck }) {
    const t = useT();
    const old = check.roster ? check.roster.roleIds.length : 0;
    const icon = check.iconPossible;
    const serverIcon = icon && draft.roleEmojiId ? (check.emojis || []).find((e) => e.id === draft.roleEmojiId) : undefined;
    return (
        <div className="kp-stack">
            <Field label={t("kader.takeover.role.name")} htmlFor="kp-tk-role">
                <input id="kp-tk-role" value={draft.roleName} maxLength={TAKEOVER_NAME_MAX} onChange={(e) => set({ roleName: e.target.value })} />
            </Field>
            <Field label={t("kader.takeover.role.color")} htmlFor="kp-tk-color">
                <span className="kp-tk-color">
                    <input type="color" className="kp-tk-colorpick" aria-label={t("kader.takeover.role.colorPick")}
                        value={isHexColor(draft.roleColor) ? draft.roleColor : "#99aab5"} onChange={(e) => set({ roleColor: e.target.value })} />
                    <input id="kp-tk-color" className="kp-tk-hex" value={draft.roleColor} placeholder="#rrggbb" maxLength={7}
                        onChange={(e) => set({ roleColor: e.target.value.trim() })} />
                    <Button variant="ghost" disabled={!draft.roleColor} onClick={() => set({ roleColor: "" })}>{t("kader.takeover.role.noColor")}</Button>
                </span>
            </Field>
            <Field label={t("kader.takeover.role.icon")} htmlFor="kp-tk-icon">
                <span className="kp-tk-iconrow" id="kp-tk-icon">
                    <EmojiField value={icon ? draft.roleEmoji : ""} onChange={(v) => set({ roleEmoji: v, roleEmojiId: "" })}
                        label={t("kader.takeover.role.iconPick")} disabled={!icon}
                        server={icon ? check.emojis : undefined} serverValue={icon ? draft.roleEmojiId : ""}
                        onServerChange={(id) => set({ roleEmojiId: id, roleEmoji: "" })} />
                    <span className="hint">
                        {check.iconPossible ? t("kader.takeover.role.iconHint") : t("kader.takeover.role.iconOff", { tier: check.premiumTier ?? 0 })}
                    </span>
                </span>
            </Field>
            <div className="kp-tk-preview">
                <span className="kicker">{t("kader.takeover.preview")}</span>
                <span className="kp-tk-rolechip"><RoleSwatch color={isHexColor(draft.roleColor) ? draft.roleColor : ""} />
                    {serverIcon ? <img className="emo-img" src={serverIcon.url} alt="" aria-hidden="true" />
                        : icon && draft.roleEmoji && <span aria-hidden="true">{draft.roleEmoji}</span>}@{draft.roleName.trim() || "…"}</span>
            </div>
            <NewRosterBlock draft={draft} set={set} check={check} />
            <p className="kp-tk-note">
                {check.roster ? t("kader.takeover.role.becomes", { roster: check.roster.name })
                    : draft.newRoster ? t("kader.takeover.role.createsRoster", { roster: draft.newRoster.name.trim() || "…" })
                        : t("kader.takeover.blocker.no_roster")}
                {old > 0 && <> {t("kader.takeover.role.replaces", { count: old })}</>}
            </p>
            <Problems draft={draft} step="role" />
        </div>
    );
}

function ChannelsStep({ draft, set, check }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck }) {
    const t = useT();
    const setChannel = (key: string, p: Partial<TakeoverDraft["channels"][number]>) =>
        set({ channels: draft.channels.map((c) => (c.key === key ? { ...c, ...p } : c)) });
    return (
        <div className="kp-stack">
            <div className="kp-tk-block">
                <span className="kicker">{t("kader.takeover.channels.category")}</span>
                <Segment
                    ariaLabel={t("kader.takeover.channels.category")}
                    value={draft.categoryMode}
                    onChange={(v) => set({ categoryMode: v })}
                    options={[
                        { value: "new", label: t("kader.takeover.channels.newCategory") },
                        { value: "existing", label: t("kader.takeover.channels.existingCategory"), disabled: !check.categories.length, tip: check.categories.length ? undefined : t("kader.takeover.channels.noCategories") },
                    ]}
                />
                {draft.categoryMode === "new" ? (
                    <div className="field is-last kp-tk-row">
                        <EmojiField value={draft.categoryEmoji} onChange={(v) => set({ categoryEmoji: v })} label={t("kader.takeover.channels.categoryEmoji")} />
                        <input className="kp-grow" aria-label={t("kader.takeover.channels.categoryName")} value={draft.categoryName} maxLength={TAKEOVER_NAME_MAX}
                            onChange={(e) => set({ categoryName: e.target.value })} />
                    </div>
                ) : (
                    <select aria-label={t("kader.takeover.channels.categoryPick")} value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                        <option value="">{t("kader.takeover.channels.categoryPick")}</option>
                        {check.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                )}
                <span className="hint">
                    {draft.categoryMode === "new"
                        ? t("kader.takeover.channels.newHint", { name: categoryPreview(draft) || "…" })
                        : t("kader.takeover.channels.existingHint")}
                </span>
                {/* the role may have a server emoji; names only take Unicode - say why where it matters */}
                {draft.categoryMode === "new" && (check.emojis || []).length > 0 && (
                    <span className="hint">{t("kader.takeover.channels.unicodeOnly")}</span>
                )}
            </div>
            <div className="kp-tk-block">
                <span className="kicker">{t("kader.takeover.channels.title", { count: draft.channels.length })}</span>
                <ul className="kp-tk-chlist">
                    {draft.channels.map((c, i) => (
                        <li key={c.key} className="kp-tk-ch">
                            <div className="field is-last kp-tk-row">
                                <EmojiField value={c.emoji} onChange={(v) => setChannel(c.key, { emoji: v })} label={t("kader.takeover.channels.emoji")} />
                                <input className="kp-grow" aria-label={t("kader.takeover.channels.name", { n: i + 1 })} value={c.name} maxLength={TAKEOVER_NAME_MAX}
                                    onChange={(e) => setChannel(c.key, { name: e.target.value })} />
                                <IconButton icon={<TrashIcon />} tone="no" tip={t("kader.takeover.channels.remove")}
                                    onClick={() => set({ channels: draft.channels.filter((x) => x.key !== c.key) })} />
                            </div>
                            <div className="kp-tk-chmeta">
                                <span className="kp-tk-mono">#{channelPreview(c) || "…"}</span>
                                <Switch checked={c.orgaOnlyWrite} onChange={(v) => setChannel(c.key, { orgaOnlyWrite: v })}
                                    label={t("kader.takeover.channels.orgaOnly")} tip={t("kader.takeover.channels.orgaOnlyTip")} />
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="kp-tk-row">
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} disabled={draft.channels.length >= MAX_TAKEOVER_CHANNELS}
                        onClick={() => set({ channels: [...draft.channels, { key: channelKey(), name: "", emoji: "", orgaOnlyWrite: false }] })}>
                        {t("kader.takeover.channels.add")}
                    </Button>
                    <span className="hint">{t("kader.takeover.channels.who")}</span>
                </div>
            </div>
            <Problems draft={draft} step="channels" />
        </div>
    );
}

/** The "who" step's line about the roster the takeover creates. */
function newRosterFact(nr: NonNullable<TakeoverDraft["newRoster"]>, check: KaderTakeoverCheck, t: T): string {
    const category = nr.categoryId ? (check.rosterCategories || []).find((c) => c.id === nr.categoryId)?.name : "";
    return category
        ? t("kader.takeover.who.newRosterIn", { roster: nr.name.trim(), category })
        : t("kader.takeover.who.newRoster", { roster: nr.name.trim() });
}

type WhoKey = "name" | "state" | "discord";
const DISCORD_ORDER = (p: KaderTakeoverPlayer) => (p.onServer === false ? 0 : p.hasRole ? 2 : 1);

function WhoStep({ draft, set, check, blocker }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck; blocker: string | null }) {
    const t = useT();
    const { view } = useKader();
    const sort = useTableSort<WhoKey>("kader-takeover-sort", { name: "asc", state: "asc", discord: "asc" }, "state");
    const players = check.players;
    const byState = TAKEOVER_STATES.map((s) => ({ s, n: players.filter((p) => p.state === s).length })).filter((x) => x.n > 0);
    const away = players.filter((p) => p.onServer === false).length;
    const inRoster = players.filter((p) => p.inRoster).length;
    const nameOfP = (p: KaderTakeoverPlayer) => playerName(view, p.userId);
    const columns: Column<KaderTakeoverPlayer, WhoKey>[] = [
        { id: "name", label: t("kader.takeover.who.player"), sortKey: "name", cell: (p) => (
            <span className="kp-tk-who"><span>{nameOfP(p)}</span>{p.characterName && <span className="kp-sub">{p.characterName}</span>}</span>
        ) },
        { id: "state", label: t("kader.takeover.who.state"), sortKey: "state", cell: (p) => <StateBadge state={p.state} /> },
        { id: "discord", label: t("kader.takeover.who.discord"), sortKey: "discord", cell: (p) => (
            p.onServer === false
                ? (
                <span className="kp-tk-bad kp-tk-away" data-tip={t("kader.takeover.who.notOnServer")}>
                    <span className="kp-tk-long">{t("kader.takeover.who.notOnServer")}</span>
                    <span className="kp-tk-short" aria-hidden="true">{t("kader.takeover.who.notOnServerShort")}</span>
                </span>
            )
                : p.hasRole ? <span className="kp-sub">{t("kader.takeover.who.hasRole")}</span> : <span className="kp-sub">{t("kader.takeover.who.getsRole")}</span>
        ) },
    ];
    return (
        <div className="kp-stack">
            <div className="kp-tk-sum">
                <p className="kp-tk-big">{t("kader.takeover.who.count", { count: players.length })}</p>
                <p className="kp-sub">{byState.map((x) => t(`kader.takeover.who.byState.${x.s}`, { count: x.n })).join(" · ")}</p>
                <ul className="kp-tk-facts">
                    <li>{t("kader.takeover.who.core")}</li>
                    {check.outsideCount > 0 && <li>{t("kader.takeover.who.outside", { count: check.outsideCount })}</li>}
                    {inRoster > 0 && <li>{t("kader.takeover.who.inRoster", { count: inRoster })}</li>}
                    {away > 0 && <li className="kp-tk-bad">{t("kader.takeover.who.away", { count: away })}</li>}
                    {draft.newRoster && <li>{newRosterFact(draft.newRoster, check, t)}</li>}
                    <li>{t("kader.takeover.who.made", {
                        role: draft.roleName.trim(),
                        category: draft.categoryMode === "new" ? categoryPreview(draft) : (check.categories.find((c) => c.id === draft.categoryId)?.name || ""),
                        count: draft.channels.length,
                    })}</li>
                </ul>
            </div>
            <DataTable
                rows={players}
                columns={columns}
                rowKey={(p) => p.userId}
                sort={sort}
                sortValue={(p, key) => (key === "name" ? nameOfP(p).toLowerCase() : key === "state" ? TAKEOVER_STATES.indexOf(p.state) : DISCORD_ORDER(p))}
                className="idx kp-tk-table"
                wrapClassName="kp-tk-tablewrap"
                empty={<p className="hint">{t("kader.takeover.blocker.no_players")}</p>}
            />
            <Switch checked={draft.confirmed} onChange={(v) => set({ confirmed: v })} label={t("kader.takeover.who.confirm")} tip={t("kader.takeover.who.confirmTip")} />
            {blocker && <p className="kp-livehint" role="alert">{t(`kader.takeover.blocker.${blocker}`)}</p>}
        </div>
    );
}

/**
 * The roster-only way's "who": exactly the players POST /api/rosters/create takes
 * along and what they become. Provisional players stay out here (unlike a takeover,
 * where everybody from provisional on comes as Stamm), so the table says so.
 */
type RosterWhoKey = "name" | "as";

function RosterWhoStep({ draft, set, check, blocker }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck; blocker: string | null }) {
    const t = useT();
    const { view } = useKader();
    const sort = useTableSort<RosterWhoKey>("kader-roster-create-sort", { name: "asc", as: "asc" }, "as");
    const players = check.players.filter((p) => ROSTER_ONLY_STATES.includes(p.state));
    const left = check.players.filter((p) => p.state === "provisional").length;
    const nameOfP = (p: KaderTakeoverPlayer) => playerName(view, p.userId);
    const columns: Column<KaderTakeoverPlayer, RosterWhoKey>[] = [
        { id: "name", label: t("kader.takeover.who.player"), sortKey: "name", cell: (p) => (
            <span className="kp-tk-who"><span>{nameOfP(p)}</span>{p.characterName && <span className="kp-sub">{p.characterName}</span>}</span>
        ) },
        { id: "as", label: t("kader.takeover.rosterOnly.asColumn"), sortKey: "as", cell: (p) => t(`kader.takeover.rosterOnly.as.${p.state}`) },
    ];
    return (
        <div className="kp-stack">
            <div className="kp-tk-sum">
                <p className="kp-tk-big">{t("kader.takeover.rosterOnly.count", { count: players.length })}</p>
                <ul className="kp-tk-facts">
                    {draft.newRoster && <li>{newRosterFact(draft.newRoster, check, t)}</li>}
                    {left > 0 && <li>{t("kader.takeover.rosterOnly.provisionalStayOut", { count: left })}</li>}
                    <li>{t("kader.takeover.rosterOnly.noDiscord")}</li>
                </ul>
            </div>
            <DataTable
                rows={players}
                columns={columns}
                rowKey={(p) => p.userId}
                sort={sort}
                sortValue={(p, key) => (key === "name" ? nameOfP(p).toLowerCase() : ROSTER_ONLY_STATES.indexOf(p.state))}
                className="idx kp-tk-table"
                wrapClassName="kp-tk-tablewrap"
                empty={<p className="hint">{t("kader.takeover.rosterOnly.noPlayers")}</p>}
            />
            <Switch checked={draft.confirmed} onChange={(v) => set({ confirmed: v })} label={t("kader.takeover.rosterOnly.confirm")} tip={t("kader.takeover.rosterOnly.confirmTip")} />
            {blocker && <p className="kp-livehint" role="alert">{t(`kader.takeover.blocker.${blocker}`)}</p>}
        </div>
    );
}

/** What "Roster anlegen" did. */
type RosterResult = { name: string; added: number; skipped: number; roleFailures: number };

function RosterResultStep({ result }: { result: RosterResult }) {
    const t = useT();
    return (
        <div className="kp-stack">
            <ul className="kp-tk-reslist">
                <li className="kp-tk-res">
                    <span className="kp-tk-resicon" aria-hidden="true"><CheckIcon /></span>
                    <span className="kp-grow">{t("kader.takeover.result.step.rosterCreated")}: {result.name}</span>
                </li>
            </ul>
            <div className="kp-tk-sum">
                <p className="kp-tk-big">{t("kader.roster.created", { count: result.added })}</p>
                {result.skipped > 0 && <p className="kp-sub">{t("kader.takeover.rosterOnly.skipped", { count: result.skipped })}</p>}
                {result.roleFailures > 0 && <p className="kp-tk-bad">{t("kader.roster.roleFailures", { count: result.roleFailures })}</p>}
            </div>
        </div>
    );
}

function StepLine({ s }: { s: KaderTakeoverStep }) {
    const t = useT();
    const extra = s.step === "role" && s.icon === "not_possible" ? t("kader.takeover.result.iconNotPossible")
        : s.step === "role" && s.icon === "set" ? t("kader.takeover.result.iconSet")
            : s.step === "category" && s.existing ? t("kader.takeover.result.existing") : "";
    return (
        <li className={`kp-tk-res${s.ok ? "" : " kp-tk-bad"}`}>
            <span className="kp-tk-resicon" aria-hidden="true">{s.ok ? <CheckIcon /> : <AlertIcon />}</span>
            <span className="kp-grow">
                {t(s.step === "roster" && s.created ? "kader.takeover.result.step.rosterCreated" : `kader.takeover.result.step.${s.step}`)}{s.name ? `: ${s.name}` : ""}
                {extra && <span className="kp-sub"> · {extra}</span>}
                {!s.ok && <span className="kp-sub"> · {s.error ? (takeoverErrorKey(s.error) ? t(takeoverErrorKey(s.error) as string) : s.error) : t("kader.takeover.result.failed")}</span>}
            </span>
        </li>
    );
}

function ResultStep({ result, check }: { result: KaderTakeoverStart; check: KaderTakeoverCheck | null }) {
    const t = useT();
    const { kader } = useKader();
    const taken = check?.takeover || result.takeover;
    const p = taken ? progressOf(kader, taken) : null;
    // while the job runs only the loader; the numbers once it is done
    const running = !!check?.running || taken?.status === "running";
    return (
        <div className="kp-stack">
            <ul className="kp-tk-reslist">{result.steps.map((s, i) => <StepLine key={`${s.step}${i}`} s={s} />)}</ul>
            {!result.takeover ? (
                <p className="kp-livehint" role="alert">{t("kader.takeover.result.notRecorded")}</p>
            ) : running ? (
                <div className="kp-tk-sum"><RaidLoader compact text={t("kader.takeover.lineRunning")} /></div>
            ) : p && (
                <div className="kp-tk-sum">
                    <p className="kp-tk-big">{t("kader.takeover.progress", { given: p.given, total: p.total })}</p>
                    <p className="kp-sub">
                        {[
                            p.open > 0 ? t("kader.takeover.result.open", { count: p.open }) : t("kader.takeover.result.finished"),
                            p.missing > 0 ? t("kader.takeover.result.missing", { count: p.missing }) : "",
                            p.failed > 0 ? t("kader.takeover.result.failedCount", { count: p.failed }) : "",
                        ].filter(Boolean).join(" · ")}
                    </p>
                    {p.missing > 0 && <span className="hint">{t("kader.takeover.result.missingHint")}</span>}
                </div>
            )}
        </div>
    );
}

/** Refusals after which the assistant reloads: the Kader or its roster link changed meanwhile. */
const RELOAD_ON = ["stale", "roster_linked", "kader_taken", "no_roster"];

/**
 * Step one's switch while no roster is linked: also in Discord or the roster alone.
 * A Discord blocker turns it off and locks it, the reason in its tooltip.
 */
function DiscordSwitch({ draft, set, check, locked }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck; locked: string | null }) {
    const t = useT();
    if (!check.createsRoster) return null;
    return (
        <Switch
            className="kp-tk-discord"
            checked={draft.discord}
            disabled={!!locked}
            onChange={(v) => set({ discord: v, confirmed: false })}
            label={t("kader.takeover.discordSwitch")}
            tip={t("kader.takeover.discordSwitchTip")}
            tipHead={locked ? t(`kader.takeover.blocker.${locked}`) : undefined}
        />
    );
}

/** The roster-only first step: name and category of the new roster. */
function RosterStep({ draft, set, check }: { draft: TakeoverDraft; set: (p: Partial<TakeoverDraft>) => void; check: KaderTakeoverCheck }) {
    return (
        <div className="kp-stack">
            <NewRosterBlock draft={draft} set={set} check={check} />
            <Problems draft={draft} step="role" />
        </div>
    );
}

/** The assistant; mounted while open. */
export function TakeoverWizard({ check, reload, onClose, canCreate = false, onDone }: {
    check: KaderTakeoverCheck;
    reload: () => Promise<unknown> | void;
    onClose: () => void;
    /** May this person create a roster (`canCreate` of GET /api/kader/roster)? */
    canCreate?: boolean;
    /** A roster came into being or changed: whoever shows it loads again. */
    onDone?: () => Promise<unknown> | void;
}) {
    const t = useT();
    const { kader, refresh } = useKader();
    const [step, setStep] = useState<TakeoverStep>("role");
    const [draft, setDraft] = useState<TakeoverDraft>(() => ({
        ...defaultDraft(kader.name, { announce: t("kader.takeover.channels.announce"), chat: t("kader.takeover.channels.chat") }, check.newRoster),
        discord: !check.createsRoster || !startBlocker(check),
    }));
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const [result, setResult] = useState<KaderTakeoverStart | null>(null);
    const [rosterResult, setRosterResult] = useState<RosterResult | null>(null);
    const set = (p: Partial<TakeoverDraft>) => setDraft((d) => ({ ...d, ...p }));
    const steps = visibleSteps(draft);
    // the switch may fall while the channels step is open (the bot went offline)
    const current: TakeoverStep = steps.includes(step) ? step : "role";
    const at = steps.indexOf(current);
    const blocker = startBlocker(check);
    const rosterLock = rosterBlocker(check, canCreate);
    const running = !!result?.takeover && (check.running || check.takeover?.status === "running");

    // a roster linked or unlinked since the assistant opened: the draft follows the check.
    // Not on the result step: there the check already shows what was just created.
    useEffect(() => {
        if (step === "result") return;
        setDraft((d) => {
            let next = withCheckRoster(d, check);
            if (check.createsRoster && startBlocker(check) && next.discord) next = { ...next, discord: false };
            // another way than the one confirmed: the switch has to go on again
            return next.discord !== d.discord ? { ...next, confirmed: false } : next;
        });
    }, [check, step]);

    // the role goes out in the background: look again while it runs
    useEffect(() => {
        if (step !== "result" || !running) return undefined;
        const id = window.setInterval(() => { void reload(); }, POLL_MS);
        return () => window.clearInterval(id);
    }, [step, running, reload]);

    const start = async () => {
        if (!canStartDraft(draft, check, canCreate) || busy) return;
        setBusy(true);
        setProblem("");
        try {
            if (draft.discord) {
                const res = await startKaderTakeover(kader.id, bodyOf(draft, check.kader.rev, check.iconPossible));
                setResult(res);
            } else {
                const nr = draft.newRoster;
                if (!nr) return;
                const res = await createKaderRoster(kader.id, { name: nr.name.trim(), ...(nr.categoryId ? { categoryId: nr.categoryId } : {}) });
                setRosterResult({ name: res.roster.name, added: res.initial.added, skipped: res.initial.skipped, roleFailures: res.initial.roleFailures.length });
            }
            setStep("result");
            await refresh();
            await reload();
            await onDone?.();
        } catch (e) {
            const err = e as ApiError;
            setProblem(!draft.discord && err && CREATE_CODES.includes(err.code) ? t(`kader.roster.error.${err.code}`) : errorText(e, t));
            if (err && RELOAD_ON.includes(err.code)) {
                // somebody planned or linked a roster meanwhile: show the new state, the switch has to go on again
                set({ confirmed: false });
                await refresh();
                await reload();
                await onDone?.();
            }
        } finally {
            setBusy(false);
        }
    };

    const nextOk = stepProblems(draft, current).length === 0;
    const footer = current === "result" ? (
        <Button variant="go" icon={<CheckIcon />} onClick={onClose}>{t("kader.takeover.close")}</Button>
    ) : (
        <>
            <Button variant="ghost" className="kp-foot-left" onClick={onClose}>{t("common.cancel")}</Button>
            {at > 0 && <Button variant="ghost" icon={<ArrowLeftIcon />} disabled={busy} onClick={() => setStep(steps[at - 1])}>{t("kader.takeover.back")}</Button>}
            {current === "who" ? (
                <Button variant="go" icon={draft.discord ? <DiscordIcon /> : <PlusIcon />} disabled={!canStartDraft(draft, check, canCreate)} running={busy} onClick={() => void start()}>
                    {t(draft.discord ? "kader.takeover.start" : "kader.takeover.rosterOnly.start")}
                </Button>
            ) : (
                <Button variant="go" icon={<ChevronRightIcon />} disabled={!nextOk} onClick={() => setStep(steps[at + 1])}>{t("kader.takeover.next")}</Button>
            )}
        </>
    );
    // the way actually taken decides the result's words, not the draft a reload may have changed
    const title = rosterResult ? "kader.takeover.rosterOnly.resultTitle"
        : !draft.discord && current === "role" ? "kader.takeover.title.roster"
            : !draft.discord && current === "who" ? "kader.takeover.rosterOnly.whoTitle"
                : `kader.takeover.title.${current}`;
    return (
        <Modal
            open
            onClose={onClose}
            icon="kader"
            tone="kader"
            kicker={t("kader.takeover.kicker", { name: kader.name })}
            title={t(title)}
            width={640}
            className="kp-dialog kp-tk"
            footer={footer}
        >
            <StepBar step={current} steps={steps} discord={draft.discord} />
            {current === "role" && <DiscordSwitch draft={draft} set={set} check={check} locked={blocker || rosterLock} />}
            {current === "role" && (draft.discord ? <RoleStep draft={draft} set={set} check={check} /> : <RosterStep draft={draft} set={set} check={check} />)}
            {current === "channels" && <ChannelsStep draft={draft} set={set} check={check} />}
            {current === "who" && (draft.discord
                ? <WhoStep draft={draft} set={set} check={check} blocker={blocker} />
                : <RosterWhoStep draft={draft} set={set} check={check} blocker={rosterLock} />)}
            {current === "result" && result && <ResultStep result={result} check={check} />}
            {current === "result" && rosterResult && <RosterResultStep result={rosterResult} />}
            {problem && <p className="kp-livehint" role="alert">{problem}</p>}
        </Modal>
    );
}

/** The button proper; only mounted while there is something to start or the assistant is open. */
function EntryButton({ canCreate, linked, onDone, shown, setShown }: {
    canCreate: boolean; linked: boolean; onDone: () => Promise<unknown> | void; shown: boolean; setShown: (v: boolean) => void;
}) {
    const t = useT();
    const toast = useToast();
    const { kader } = useKader();
    const [opening, setOpening] = useState(false);
    const taken = !!kader.takeover;
    const counts = countStates(kader);
    // only the step to or from "nobody to take along" changes the button; moving players
    // around needs no request (one vCPU): the precheck is loaded fresh on opening
    const hasPlayers = TAKEOVER_STATES.some((s) => counts[s] > 0);
    const check = useApi(() => getKaderTakeover(kader.id), [kader.id, taken, linked, hasPlayers]);
    const c = check.data;
    const open = async () => {
        setOpening(true);
        try {
            const fresh = await getKaderTakeover(kader.id);
            check.setData(fresh);
            const stop = entryBlocker(fresh, canCreate);
            if (stop) toast(t(`kader.takeover.blocker.${stop}`), "err");
            else setShown(true);
        } catch (e) {
            toast(errorText(e, t), "err");
        } finally {
            setOpening(false);
        }
    };
    const stop = c ? entryBlocker(c, canCreate) : null;
    // the roster alone is possible, Discord not: the button says why the switch will be off
    const discordStop = c && !linked ? startBlocker(c) : null;
    const tip = stop ? t(`kader.takeover.blocker.${stop}`) : t(linked ? "kader.takeover.entryTip" : "kader.takeover.createTip");
    const sub = stop ? undefined
        : linked ? t("kader.takeover.entryTipSub")
            : discordStop ? t(`kader.takeover.blocker.${discordStop}`) : t("kader.takeover.createTipSub");
    return (
        <>
            {!taken && c && (
                <span className="kp-tk-entry" data-tip={tip} data-tip-sub={sub}>
                    <Button variant="go" icon={linked ? <DiscordIcon /> : <PlusIcon />} className="kp-stage-act" disabled={!!stop} running={opening} onClick={() => void open()}>
                        {t(linked ? "kader.takeover.entry" : "kader.roster.createButton")}
                    </Button>
                </span>
            )}
            {shown && c && <TakeoverWizard check={c} reload={check.reload} canCreate={canCreate} onDone={onDone} onClose={() => setShown(false)} />}
        </>
    );
}

/**
 * The one green button on the decision and the composition page: "Roster anlegen"
 * without a linked roster, "In Discord übernehmen" with one, gone after a takeover
 * and for a reader. Locked, with the reason as tooltip, only when no way is open.
 * Without anything to start it asks the server for nothing.
 */
export function TakeoverEntry({ canCreate, linked, onDone }: { canCreate: boolean; linked: boolean; onDone: () => Promise<unknown> | void }) {
    const { kader, canWrite } = useKader();
    const [shown, setShown] = useState(false);
    if (!canWrite || (kader.takeover && !shown)) return null;
    return <EntryButton canCreate={canCreate} linked={linked} onDone={onDone} shown={shown} setShown={setShown} />;
}

/**
 * The head's line of a taken-over Kader: the role as Discord has it, how many
 * planned players have it, the category, and "Rolle nachziehen (n)" when some
 * wait for it (also after an aborted hand-out).
 */
export function TakeoverLine() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { kader, refresh } = useKader();
    const taken = kader.takeover || null;
    const waiting = pendingOf(kader).length;
    const check = useApi(() => (taken ? getKaderTakeover(kader.id) : Promise.resolve(null)), [kader.id, taken?.status, waiting, Object.keys(taken?.results || {}).length]);
    const [busy, setBusy] = useState(false);
    const c = check.data;
    const progress = useMemo(() => (taken ? progressOf(kader, taken) : null), [kader, taken]);
    const running = !!c?.running || taken?.status === "running";
    useEffect(() => {
        if (!running) return undefined;
        const id = window.setInterval(() => { void check.reload(); void refresh(); }, POLL_MS);
        return () => window.clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running]);
    if (!taken || !progress) return null;
    // only who is on the server: a later join gives nobody the role by itself, pulling does nothing for the others
    const pending = c ? c.pullCount : waiting;
    const away = c?.pendingAway || 0;
    const roleName = c?.role?.name || taken.roleName;

    const pull = async () => {
        const ok = await ask({
            title: t("kader.takeover.pullTitle", { role: roleName }),
            text: t("kader.takeover.pullText", { count: pending }),
            action: t("kader.takeover.pullAction"),
            tone: "primary",
            icon: "kader",
        });
        if (!ok) return;
        setBusy(true);
        try {
            const res = await pullKaderTakeoverRole(kader.id);
            toast(t("kader.takeover.pulled", { count: res.count }));
            await refresh();
            await check.reload();
        } catch (e) {
            toast(errorText(e, t), "err");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="kp-tk-line">
            <span className="kicker">{t("kader.takeover.lineKicker")}</span>
            <span className={`kp-tk-rolechip${c?.role?.gone ? " kp-tk-gone" : ""}`} data-tip={c?.role?.gone ? t("kader.takeover.roleGone") : undefined}>
                <RoleSwatch color={c?.role?.color || ""} />@{roleName}
            </span>
            <span className="kp-tk-linetext">{t("kader.takeover.progress", { given: progress.given, total: progress.total })}</span>
            {c?.category && (
                <span className={`kp-sub${c.category.gone ? " kp-tk-gone" : ""}`}>{t("kader.takeover.lineCategory", { name: c.category.name })}</span>
            )}
            {running && <span className="kp-sub">{t("kader.takeover.lineRunning")}</span>}
            {c?.aborted && <span className="kp-tk-bad">{t("kader.takeover.lineAborted")}</span>}
            {away > 0 && !running && <span className="kp-sub" data-tip={t("kader.takeover.lineAwayTip")}>{t("kader.takeover.lineAway", { count: away })}</span>}
            <span className="kp-grow" />
            {pending > 0 && c?.canStart && !running && (
                <Button variant="go" size="sm" icon={<RefreshIcon />} running={busy} disabled={!!c.role?.gone} onClick={() => void pull()}
                    data-tip={c.role?.gone ? t("kader.takeover.error.role_gone") : t("kader.takeover.pullTip")}>
                    {t("kader.takeover.pull", { count: pending })}
                </Button>
            )}
        </div>
    );
}
