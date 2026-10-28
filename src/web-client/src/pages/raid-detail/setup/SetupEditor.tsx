// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — ONE bar: the setup's one state and its counts
// as square fields that wrap but are never cut ("Tanks 1/2", "Heiler 1/2",
// "DD 6/6", "8/10 Plätze", "7/8 bestätigt"), then "Mehr ▾", ONE secondary action
// ("Freie Plätze füllen", or "Alle bestätigen" once it is out) and the one primary
// button as a split button: "Setup posten" until it is out, then "Alle pingen" —
// its chevron holds the switches "Bank mitposten" / "DMs an Spieler", their state
// written beside it ("mit DMs · ohne Bank"). Then the group cards with one compact
// line per raider, the bench and "Angemeldet" as rows, and one summary line
// (buffs, fairness, wishes, "nicht zusammen" — asked once, counts only, never
// names) whose "Details" opens the tiles and switches. Everything rarer sits
// under "Mehr": proposing anew, the group count, the ping text, the switches,
// the weights, Claude's explanation.
//
// A raider's info: resting the mouse on a line (or focusing it) shows it beside
// the line after a moment (the peek, peek.ts — read only, gone at a drag); a click
// pins it in the side drawer with the actions.
//
// Moving: drag a raider onto a group, onto the bench, back into "Angemeldet"
// (the pool of who signed up and is neither placed nor benched, #517) or onto
// another raider (swap — inside one group that reorders it; every group always
// shows its five places). A double click on somebody in a group or on the bench
// takes them out of the raid, back into "Angemeldet". Without a mouse: activate
// a raider (click, Enter), then the target. Every move is saved at once and comes back valued by the
// server. Posting carries the bench only with "Bank mitposten" on.
//
// A raid group (#811): an overbooked raid gets further raids ("Weiteren Raid
// hinzufügen" — a calm line under the bar while more signed up than there are
// places, else under "Mehr"). The editor then shows the tabs "Raid 1 | Raid 2" (RaidTabs.tsx):
// one raid at a time, ONE shared pool "Angemeldet" (whoever stands in another
// raid is not in it), a raider dragged onto a tab goes into that raid. Proposal
// and "Freie Plätze füllen" run over every raid; approving and posting stay per raid.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addGroupRaid, moveToGroupRaid, removeGroupRaid, approveRaidSetup, getRaidSetup, pingSetup, previewSetupPing, proposeRaidSetup, publishRaidSetup, saveRaidSetup, saveSetupExtraRole, saveSetupPingText, saveSetupSignup, setSetupConfirmation, confirmAllSetup, updateRaidSize, type ApiError, type SetupConfirmation, type SetupEditorData, type SetupPerson, type SetupPlacementInput, type SetupSignupInput, type SetupActivity, type SetupCharacter, type SetupPresenceAction, type StoredSetup } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { applyLocal, asCharacter, moveRaider, peopleOf, publishHint, resizeLineup, respecRaider, setupState, suggestGroup, switchCharacter, toInput, toggleLock, withAllGroups, withSetupDefaults, GROUP_SIZE, type CharacterChoice, type SetupTarget } from "../../../lib/signups/setupEditor";
import { useT } from "../../../i18n";
import { Button, IconButton } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { useConfirm } from "../../../components/ui/Modal";
import RaidLoader from "../../../components/ui/RaidLoader";
import WowIcon from "../../../components/ui/WowIcon";
import { useJobs } from "../../../components/shell/Jobs";
import { LockIcon, XIcon } from "../../../components/ui/icons";
import type { RaidCtx } from "../meta";
import "../../../styles/setup-editor.css";
import { clock, readCompact, storeCompact } from "./setupText";
import { BenchCard, GroupCard, GroupGrid, type Interaction, ReadOnly } from "./Board";
import { PoolPanel } from "./PoolPanel";
import { ActivityFeed, PresenceChip } from "./LiveParts";
import { presenceColor, usePresence } from "./usePresence";
import { BarCounts, MoreMenu, PingTextField, PostSplit, SizeControl, StatusBadge, type BarCount, type MoreItem } from "./Controls";
import { PEEK_DELAY_MS } from "./peek";
import Popover from "../../../components/ui/Popover";
import { besidePlacement } from "../../../lib/ui/popoverPosition";
import { Summary, SummaryLine } from "./Summary";
import { roleFigures, summaryOptions } from "./summaryFigures";
import { SlotTip, type SlotActions } from "./SlotTip";
import { EditorDialog, ExplainModal, FillModal, WeightsModal } from "./SetupModals";
import { SearchModal } from "./SearchModal";
import { SignupEditModal } from "./SignupEditModal";
import { AddRaidModal, RaidTabs } from "./RaidTabs";

/**
 * `raidId`: which raid of the event's raid group (#811) the editor shows (the
 * page's own event without one); `onSwitchRaid` changes it — a tab, a new raid,
 * a dissolved one.
 */
export default function SetupEditor({ ctx, raidId, onSwitchRaid }: { ctx: RaidCtx; raidId?: string; onSwitchRaid?: (id: string) => void }) {
    const t = useT();
    const eventId = raidId || ctx.eventId;
    const raidCtx: RaidCtx = eventId === ctx.eventId ? ctx : { ...ctx, eventId };
    const jobs = useJobs();
    const ask = useConfirm();
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    // Several characters (#293): the character a drag or pick in "Angemeldet" is for — a
    // "kann auch mit" line — so the move takes exactly that one. Empty = as they stand.
    const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
    const choice = useRef<{ userId: string; character: string } | null>(null);
    // the dialogs: the rare tools under "Mehr", and the summary line's "Details"
    const [dialog, setDialog] = useState<"weights" | "explain" | "search" | "size" | "ping" | "details" | "fill" | "addRaid" | null>(null);
    const [grouping, setGrouping] = useState(false);
    const [posting, setPosting] = useState(false);
    const [pinging, setPinging] = useState(false);
    // "Anmeldung bearbeiten" (#521): the raider whose signup the dialog changes
    const [editing, setEditing] = useState<string | null>(null);
    // "Bench mitposten" (#517): null = what the event remembered from the last post (off by default)
    const [benchChoice, setBenchChoice] = useState<boolean | null>(null);
    // "DMs an Spieler": null = what the event (else its category) says; sent with the next post
    const [dmsChoice, setDmsChoice] = useState<boolean | null>(null);
    const [compact, setCompact] = useState(readCompact);
    const toggleCompact = () => setCompact((on) => {
        storeCompact(!on);
        return !on;
    });
    const saving = useRef(0);

    const setupData = useApi(() => getRaidSetup(eventId).then((d) => (d.setup ? { ...d, setup: withSetupDefaults(d.setup) } : d)), [eventId]);
    const { data, setData } = setupData;
    const load = setupData.reload;

    // The raider the side drawer shows: the one clicked last (nothing stands open
    // before a click). Unlike `selected` (picked to be moved — the next raider
    // clicked is swapped with it) it outlives a panel action: confirm, fix or edit
    // drop the pick, the drawer stays, and the next click on a raider just picks
    // that one. Esc or its close button lets go.
    const [pinned, setPinned] = useState<string | null>(null);
    // a phone: the sheet stays one slim line while a raider is picked, until "Details" opens it — closed again at every new pick
    const [sheetOpen, setSheetOpen] = useState(false);
    useEffect(() => setSheetOpen(false), [selected]);

    // The peek (peek.ts): the raider whose line the mouse rests on or the focus is on —
    // their info beside the line, PEEK_DELAY_MS later, so passing over draws nothing.
    // Gone when the pointer or focus leaves, at a drag, a pick or Esc.
    const [peek, setPeek] = useState<{ userId: string; character?: string; el: HTMLElement } | null>(null);
    const peekTimer = useRef<number | undefined>(undefined);
    const peekAt = (userId: string, el?: HTMLElement | null, character?: string) => {
        window.clearTimeout(peekTimer.current);
        if (!el) return;
        peekTimer.current = window.setTimeout(() => setPeek({ userId, character, el }), PEEK_DELAY_MS);
    };
    const unpeek = () => {
        window.clearTimeout(peekTimer.current);
        setPeek(null);
    };
    useEffect(() => () => window.clearTimeout(peekTimer.current), []);

    useEffect(() => {
        if (!selected && !pinned && !peek) return undefined;
        const esc = (e: globalThis.KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setSelected(null);
            setPinned(null);
            window.clearTimeout(peekTimer.current);
            setPeek(null);
        };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [selected, pinned, peek]);

    const setup = data?.setup || null;

    // Who else is in this editor (setupPresence): what this orga member holds goes out with
    // every heartbeat, the others are drawn in the bar and on the raiders they hold, and what
    // they just moved glows a moment with their name.
    const myAction: SetupPresenceAction | null = dragging ? { kind: "drag", userId: dragging }
        : selected ? { kind: "drag", userId: selected }
            : editing ? { kind: "edit", userId: editing } : null;
    const [flash, setFlash] = useState<Record<string, { name: string; color: string }>>({});
    const flashFor = (entries: SetupActivity[]) => {
        const lit: Record<string, { name: string; color: string }> = {};
        for (const e of entries) {
            const ids = e.kind === "move" && e.userId ? [e.userId] : e.kind === "many" ? (e.userIds || []) : [];
            for (const id of ids) lit[id] = { name: e.byName, color: presenceColor(e.by) };
        }
        if (!Object.keys(lit).length) return;
        setFlash((prev) => ({ ...prev, ...lit }));
        setTimeout(() => setFlash((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !(id in lit)))), 4000);
    };
    const presence = usePresence(eventId, myAction, { enabled: !!data?.canWrite, onNew: flashFor });
    const postBench = benchChoice ?? !!data?.publish?.bench;
    const postDms = dmsChoice ?? !!data?.publish?.dmsEnabled;

    // The DMs of an approval run on in the background: poll only their state, so
    // a move the orga makes meanwhile is never overwritten by an older lineup.
    const dmsRunning = data?.publish?.dms?.status === "running";
    useEffect(() => {
        if (!dmsRunning) return undefined;
        const timer = setInterval(() => {
            getRaidSetup(eventId)
                .then((next) => setData((prev) => (prev ? { ...prev, publish: next.publish } : prev)))
                .catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [dmsRunning, eventId, setData]);

    // Moves come faster than answers. Every save waits for the one before it and
    // carries the version the server last confirmed, and the next move builds on
    // the lineup as drawn (current.data) — so quick moves never trip the
    // server's "changed in the meantime" check on their own.
    const current = useRef<SetupEditorData | null>(null);
    current.current = data;
    const confirmedVersion = useRef(0);
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    useEffect(() => { if (data?.setup && !saving.current) confirmedVersion.current = data.setup.version; }, [data]);

    // Somebody else changed the setup (the heartbeat says a newer version is stored): fetch it
    // light — no names, no attendance; the page keeps its own — unless a move of ours is on its way.
    const syncing = useRef(false);
    useEffect(() => {
        if (!presence.version || presence.version <= confirmedVersion.current || saving.current || syncing.current) return;
        syncing.current = true;
        getRaidSetup(eventId, { light: true })
            .then((next) => {
                if (saving.current || !next.setup || next.setup.version <= confirmedVersion.current) return;
                confirmedVersion.current = next.setup.version;
                setData({ ...withNames(next), attendance: current.current?.attendance || next.attendance });
            })
            // a failed fetch is no news: the next heartbeat asks again
            .catch(() => undefined)
            .finally(() => { syncing.current = false; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presence.version]);

    /** A server answer, with the Discord names the page already knows (mutations do not resolve them again). */
    const withNames = (raw: SetupEditorData): SetupEditorData => {
        if (!raw.setup) return raw;
        const next = { ...raw, setup: withSetupDefaults(raw.setup) };
        const known = current.current?.setup ? peopleOf(current.current.setup) : new Map<string, SetupPerson>();
        const named = (p: SetupPerson) => (p.name ? p : { ...p, name: known.get(p.userId)?.name || "" });
        return { ...next, setup: { ...next.setup, groups: next.setup.groups.map((g) => ({ ...g, slots: g.slots.map(named) })), bench: next.setup.bench.map(named), pool: (next.setup.pool || []).map(named) } };
    };

    /** Answer of a mutating call: take the server's lineup, tell the parent the step changed. */
    const accept = (next: SetupEditorData, message?: string) => {
        if (next.setup) confirmedVersion.current = next.setup.version;
        // attendance is only read on the page load — keep it across the answers of moves
        setData({ ...withNames(next), attendance: next.attendance || current.current?.attendance });
        ctx.onChanged(message || "");
    };

    // `patch`: other top-level fields to redraw at once alongside the lineup —
    // only the resize uses it, to show the new size/group count instantly
    // instead of waiting for the server's answer.
    // `redo`: the move once more on a newer lineup — when somebody else saved in
    // between (409 "conflict"), the move is applied to their lineup and saved again
    // instead of "changed in the meantime, reload".
    const save = (input: SetupPlacementInput, extra: { fairness?: boolean; wishes?: boolean; avoid?: boolean } = {}, patch: Partial<SetupEditorData> = {}, redo?: (fresh: StoredSetup) => SetupPlacementInput | null) => {
        const shown = current.current;
        if (!shown?.setup) return chain.current;
        const ticket = ++saving.current;
        setData({ ...shown, ...patch, setup: applyLocal(shown.setup, input) });
        chain.current = chain.current.then(async () => {
            try {
                const next = await saveRaidSetup(eventId, { ...input, ...extra, version: confirmedVersion.current });
                if (next.setup) confirmedVersion.current = next.setup.version;
                // only the last pending save redraws; earlier answers would flash an older lineup
                if (ticket === saving.current) {
                    saving.current = 0;
                    // a move answers quietly — a message only when the posted setup could not follow
                    accept(next, next.message);
                }
            } catch (e) {
                if ((e as ApiError).code === "conflict" && redo && await replay(redo, extra, ticket)) return;
                saving.current = 0;
                jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
                load();
            }
        });
        return chain.current;
    };

    /** A move that met a newer lineup: fetch it, apply the move there, save again — true when that worked. */
    const replay = async (redo: (fresh: StoredSetup) => SetupPlacementInput | null, extra: { fairness?: boolean; wishes?: boolean; avoid?: boolean }, ticket: number) => {
        try {
            const fresh = withNames(await getRaidSetup(eventId, { light: true }));
            const again = fresh.setup ? redo(withSetupDefaults(fresh.setup)) : null;
            if (!fresh.setup || !again) return false;
            const next = await saveRaidSetup(eventId, { ...again, ...extra, version: fresh.setup.version });
            if (next.setup) confirmedVersion.current = next.setup.version;
            if (ticket === saving.current) {
                saving.current = 0;
                accept(next, next.message);
            }
            jobs.notify(t("setup.live.rebased"));
            return true;
        } catch {
            return false;
        }
    };

    /** Put a raider into the setup as another spec of their class (the third tank, an extra healer) — saved like any move. */
    const respec = (userId: string, specKey: string) => {
        const shown = current.current;
        if (!shown?.setup) return;
        const person = peopleOf(shown.setup).get(userId);
        const spec = person?.classSpecs?.find((x) => x.key === specKey);
        if (!spec) return;
        const result = respecRaider(toInput(shown.setup), userId, spec);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    /** "Charakter wechseln" (#293): the raider plays another character they signed up with — place kept, locked, saved like any move. */
    const switchTo = (userId: string, c: SetupCharacter) => {
        const shown = current.current;
        if (!shown?.setup) return;
        const result = switchCharacter(toInput(shown.setup), userId, c);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    /**
     * `targetCharacter`: a click on a "kann auch mit" line of somebody in "Angemeldet" while
     * another raider is picked — the swap brings in that character.
     */
    const move = (target: SetupTarget, userId?: string, targetCharacter?: string) => {
        const who = userId || selected;
        const picked: CharacterChoice = {};
        if (who && choice.current && choice.current.userId === who) picked[who] = choice.current.character;
        if (targetCharacter && "userId" in target) picked[target.userId] = targetCharacter;
        choice.current = null;
        setSelected(null);
        setSelectedCharacter(null);
        setDragging(null);
        const shown = current.current;
        if (!who || !shown?.setup) return;
        const result = moveRaider(toInput(shown.setup), who, target, peopleOf(shown.setup), shown.event.size || 0, picked);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        const redo = (fresh: StoredSetup) => {
            const again = moveRaider(toInput(fresh), who, target, peopleOf(fresh), shown.event.size || 0, picked);
            return "input" in again && again.input ? again.input : null;
        };
        if (result.input) save(result.input, {}, {}, redo);
    };

    /**
     * A raid group (#811): a raider of this raid (group place, bench or the shared
     * pool) into another raid of the group — dragged onto its tab, or picked and
     * the tab clicked. The server puts them on that raid's first free place.
     */
    const moveRaid = async (target: string, userId?: string) => {
        const who = userId || selected || dragging;
        const character = who && choice.current && choice.current.userId === who ? choice.current.character : undefined;
        choice.current = null;
        setSelected(null);
        setSelectedCharacter(null);
        setDragging(null);
        if (!who) return;
        setBusy(true);
        try {
            await chain.current;
            const next = await moveToGroupRaid(eventId, target, who, character);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.raidGroup.moveFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /** "Weiteren Raid hinzufügen" (#811): the new raid is created and the editor switches to its tab. */
    const addRaid = async (title: string) => {
        setGrouping(true);
        try {
            await chain.current;
            const out = await addGroupRaid(eventId, title);
            setDialog(null);
            ctx.onChanged(out.message || t("setup.raidGroup.created", { title: out.title }));
            if (onSwitchRaid) onSwitchRaid(out.event);
            else load();
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.raidGroup.addFailed"), "err");
        } finally {
            setGrouping(false);
        }
    };

    /** Dissolve this further raid (#811) — asked first; its raiders fall back into "Angemeldet". */
    const removeRaid = async () => {
        const shown = current.current;
        if (!shown) return;
        const placedHere = (shown.setup?.groups || []).reduce((n, g) => n + g.slots.length, 0) + (shown.setup?.bench || []).length;
        const okay = await ask({
            title: t("setup.raidGroup.removeTitle", { title: shown.event.title }),
            text: t("setup.raidGroup.removeText", { title: shown.event.title, count: placedHere }),
            action: t("setup.raidGroup.removeAction"),
            icon: "members",
        });
        if (!okay) return;
        setGrouping(true);
        try {
            await chain.current;
            const out = await removeGroupRaid(eventId);
            ctx.onChanged(out.message);
            if (onSwitchRaid) onSwitchRaid(out.event);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.raidGroup.removeFailed"), "err");
        } finally {
            setGrouping(false);
        }
    };

    const pick = (userId: string, character?: string) => {
        // a click pins the drawer — the peek beside the line gives way
        unpeek();
        if (!selected) {
            setPinned(userId);
            choice.current = character ? { userId, character } : null;
            setSelectedCharacter(character || null);
            return setSelected(userId);
        }
        if (selected === userId) {
            // another of the same raider's lines: the pick moves to that character
            if ((character || "") !== (selectedCharacter || "")) {
                choice.current = character ? { userId, character } : null;
                return setSelectedCharacter(character || null);
            }
            setPinned(null);
            choice.current = null;
            setSelectedCharacter(null);
            return setSelected(null);
        }
        move({ userId }, undefined, character);
    };

    /** A drag starts (with the character of the line, #293) or ends. */
    const drag = (userId: string | null, character?: string) => {
        unpeek();
        setDragging(userId);
        if (userId) choice.current = character ? { userId, character } : null;
    };

    /** A panel action on the raider shown: done, the pick is dropped (no swap on the next click), the panel stays. */
    const act = (fn: () => void) => () => {
        setSelected(null);
        fn();
    };

    /**
     * Resize the raid (#354): reshuffled locally at once (resizeLineup), then
     * persisted — the size itself through the event's own PATCH (the create
     * dialog's endpoint, `updateRaidSize`), the resulting lineup through the
     * usual setup save, so both land together.
     */
    const resize = async (newSize: number) => {
        const shown = current.current;
        if (!shown?.setup || newSize === shown.event.size) return;
        const groupCount = Math.max(1, Math.ceil(newSize / GROUP_SIZE));
        const resized = resizeLineup(toInput(shown.setup), newSize);
        // reshuffled at once, in the browser — no server round trip needed to see it
        setData({ ...shown, event: { ...shown.event, size: newSize }, groupCount, setup: applyLocal(shown.setup, resized) });
        setBusy(true);
        try {
            await chain.current;
            // the size itself first, so the lineup save below already reads it back applied
            await updateRaidSize(eventId, newSize);
            await save(resized, {}, { event: { ...shown.event, size: newSize }, groupCount });
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.sizeFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /**
     * "Nicht zusammen": asked once per event, the first time a proposal is made
     * while such pairs stand among the signups. Afterwards the side column's
     * switch changes it; the server remembers the answer.
     */
    const avoidAnswer = async (): Promise<boolean | undefined> => {
        const shown = current.current;
        if (!shown?.avoidPairs || typeof shown.setup?.options?.avoid === "boolean") return undefined;
        return ask({
            title: t("setup.avoid.askTitle"),
            text: t("setup.avoid.askText", { count: shown.avoidPairs }),
            action: t("setup.avoid.askYes"),
            cancelLabel: t("setup.avoid.askNo"),
            icon: "members",
        });
    };

    /** A proposal: everything anew (fixed places kept), or — `keep: "placed"`, "Freie Plätze füllen" — only the free places. */
    const propose = async (weights?: Record<string, number>, keep?: "placed") => {
        setDialog(null);
        const avoid = await avoidAnswer();
        setBusy(true);
        await chain.current;
        const next = await jobs.run({ label: t("setup.editor.proposalJob"), detail: data?.event.title || "", icon: "home", quiet: true }, () => (
            proposeRaidSetup(eventId, { ...(weights ? { weights } : {}), ...(avoid === undefined ? {} : { avoid }), ...(keep ? { keep } : {}) })
        ));
        setBusy(false);
        if (next) accept(next, next.message);
    };

    const approve = async () => {
        if (!setup) return;
        if (!setup.checks.ok) {
            const okay = await ask({
                title: t("setup.editor.approveAnywayTitle"),
                text: t("setup.editor.approveAnywayText"),
                action: t("setup.editor.approve"),
                icon: "home",
            });
            if (!okay) return;
        }
        setBusy(true);
        try {
            // approve what is drawn: wait for the moves still on their way first
            await chain.current;
            const next = await approveRaidSetup(eventId, confirmedVersion.current, { bench: postBench, dms: postDms });
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.approveFailed"), "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    /**
     * "Alle pingen" — the posted setup's one action: everybody in its groups, in the
     * event channel, with the ping text (the web's twin of "Ping everyone" under the
     * message). Asks first, with how many and the text, from the server's dry run.
     */
    const pingAll = async () => {
        setPinging(true);
        try {
            const plan = await previewSetupPing(eventId);
            const ok = await ask({
                title: t("setup.ping.askTitle"),
                text: t("setup.ping.askText", { count: plan.count, text: plan.text }),
                action: t("setup.ping.action"),
                icon: "notify",
                tone: "primary",
            });
            if (!ok) return;
            const r = await pingSetup(eventId);
            jobs.notify(r.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.ping.failed"), "err");
        } finally {
            setPinging(false);
        }
    };

    const post = async () => {
        setPosting(true);
        try {
            await chain.current;
            const next = await publishRaidSetup(eventId, { bench: postBench, dms: postDms });
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.postFailed"), "err");
            load();
        } finally {
            setPosting(false);
        }
    };

    // The orga's marks, many in a row: each is drawn at once and sent one after
    // the other (the server answers at once, the Discord message follows a
    // moment after the last). A mark still on its way overrides whatever an
    // answer to an earlier one says — so a quick second click never jumps back.
    const pendingMarks = useRef(new Map<string, SetupConfirmation | "">());
    const markChain = useRef<Promise<unknown>>(Promise.resolve());
    const withPending = (marks: Record<string, SetupConfirmation>) => {
        const out = { ...marks };
        for (const [id, status] of pendingMarks.current) {
            if (status) out[id] = status;
            else delete out[id];
        }
        return out;
    };
    // When the last own mark was answered, and whether "Alle bestätigen" is on its way: a heartbeat
    // sent before either knows nothing of it and would turn the checks back for a moment.
    const lastMarkAt = useRef(0);
    const markingAll = useRef(false);
    const settle = (userId: string, sent: SetupConfirmation | "") => {
        if (pendingMarks.current.get(userId) === sent) pendingMarks.current.delete(userId);
        lastMarkAt.current = Date.now();
    };

    // A raider answered under the setup message in Discord: that changes no version, so the
    // heartbeat brings the stored marks along — taken over unless they are older than our own.
    useEffect(() => {
        const marks = presence.marks;
        if (!marks || markingAll.current || marks.sentAt <= lastMarkAt.current) return;
        setData((prev) => {
            if (!prev) return prev;
            const next = withPending(marks.confirmations);
            const was = prev.confirmations || {};
            const same = Object.keys(next).length === Object.keys(was).length && Object.entries(next).every(([id, s]) => was[id] === s);
            return same ? prev : { ...prev, confirmations: next };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presence.marks]);

    /** The check in the raider panel: confirmed ↔ none (a "Cancel" turns into confirmed). */
    const toggleConfirm = (userId: string) => {
        const was = (current.current?.confirmations || {})[userId];
        const next: SetupConfirmation | "" = was === "confirmed" ? "" : "confirmed";
        pendingMarks.current.set(userId, next);
        setData((prev) => (prev ? { ...prev, confirmations: withPending(prev.confirmations || {}) } : prev));
        markChain.current = markChain.current.then(async () => {
            try {
                const answer = await setSetupConfirmation(eventId, userId, next);
                settle(userId, next);
                setData((prev) => (prev ? { ...prev, confirmations: withPending(answer.confirmations || {}) } : prev));
            } catch (e) {
                settle(userId, next);
                // back to what the line showed before this click — unless a newer click is already on its way
                setData((prev) => {
                    if (!prev || pendingMarks.current.has(userId)) return prev;
                    const marks = { ...(prev.confirmations || {}) };
                    if (was) marks[userId] = was;
                    else delete marks[userId];
                    return { ...prev, confirmations: marks };
                });
                jobs.notify((e as ApiError).message || t("setup.editor.confirmFailed"), "err");
            }
        });
    };

    /** "Alle bestätigen": asked once, then — after the marks still on their way — the check for everybody in a group without an answer. */
    const confirmEveryone = async (count: number) => {
        const ok = await ask({
            title: t("setup.confirmAll.askTitle"),
            text: t("setup.confirmAll.askText", { count }),
            action: t("setup.editor.confirmAll"),
            icon: "members",
            tone: "primary",
        });
        if (!ok) return;
        await markChain.current;
        markingAll.current = true;
        try {
            const answer = await confirmAllSetup(eventId);
            setData((prev) => (prev ? { ...prev, confirmations: withPending(answer.confirmations || {}) } : prev));
            jobs.notify(answer.count ? t("setup.editor.confirmAllDone", { count: answer.count }) : t("setup.editor.confirmAllNone"));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.confirmFailed"), "err");
        } finally {
            markingAll.current = false;
            lastMarkAt.current = Date.now();
        }
    };

    const toggleExtra = async (userId: string, role: "tank" | "healer", on: boolean) => {
        try {
            const next = await saveSetupExtraRole(eventId, userId, role, on);
            setData((prev) => (prev ? { ...prev, extraRoles: next.extraRoles } : prev));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
        }
    };

    /**
     * The orga changes a raider's signup (#521). Waits for the moves still on
     * their way, then the server saves the signup and the setup follows (place
     * kept, a signed-off raider out) — its answer is drawn like any other.
     * A failure stays in the dialog (it throws back).
     */
    const saveSignup = async (input: SetupSignupInput) => {
        await chain.current;
        const next = await saveSetupSignup(eventId, input);
        accept(next, next.message);
        setEditing(null);
    };

    const savePingText = async (text: string) => {
        try {
            const next = await saveSetupPingText(eventId, text);
            setData((prev) => (prev ? { ...prev, pingText: next.pingText } : prev));
        } catch (e) {
            jobs.notify((e as ApiError).message || t("setup.editor.saveFailed"), "err");
        }
    };

    if (setupData.error) return <div className="empty">{t("setup.editor.loadFailed", { message: setupData.error.message })}</div>;
    if (!data) return <RaidLoader text={t("setup.editor.loading")} compact />;
    if (!data.canWrite) return <ReadOnly data={data} />;

    if (!setup) {
        return (
            <div className="se-start">
                <WowIcon name="home" size={40} />
                <div>
                    <div className="se-start-title">{t("setup.editor.noSetup")}</div>
                    <div className="se-start-sub">
                        {[
                            t("setup.editor.signedUp", { count: data.signupCount || 0 }),
                            data.absent ? t("setup.editor.absent", { count: data.absent }) : "",
                            t("setup.editor.places", { count: data.event.size }),
                        ].filter(Boolean).join(" · ")}
                    </div>
                </div>
                <Button icon="simulate" running={busy} disabled={!data.signupCount} onClick={() => propose()}>{t("setup.editor.createProposal")}</Button>
            </div>
        );
    }

    // the glow: where the raider being dragged (or picked) helps a group most
    const moving = dragging || selected;
    const movingPerson = moving ? peopleOf(setup).get(moving) : undefined;
    const suggest = movingPerson ? suggestGroup(movingPerson, withAllGroups(setup.groups, data.groupCount || 1)) : null;
    // The drawer shows the raider clicked last (`pinned`) — looked up fresh every
    // render, so a move redraws its group and buffs. Nothing stands open before a click.
    const shownId = pinned && peopleOf(setup).has(pinned) ? pinned : null;
    const inspectedPerson = shownId ? peopleOf(setup).get(shownId) : undefined;
    const editPerson = editing ? peopleOf(setup).get(editing) : undefined;
    // on the bench or in the pool: no slot yet, so no "im Setup als" and no extra role
    const inspectedIsBench = !!inspectedPerson && [...setup.bench, ...(setup.pool || [])].some((b) => b.userId === inspectedPerson.userId);
    const inspectedInPool = !!inspectedPerson && (setup.pool || []).some((b) => b.userId === inspectedPerson.userId);
    const inspectedInGroup = !!inspectedPerson && setup.groups.some((g) => g.slots.some((s) => s.userId === inspectedPerson.userId));
    const confirmations = data.confirmations || {};
    // what the others hold right now, by raider — ringed in their colour, not to be taken meanwhile
    const held: NonNullable<Interaction["held"]> = {};
    for (const e of presence.editors) if (e.action) held[e.action.userId] = { name: e.name, color: presenceColor(e.userId), kind: e.action.kind };
    const characters = new Map([...peopleOf(setup).values()].map((p) => [p.userId, p.character]));
    const onHeld = (userId: string) => {
        const h = held[userId];
        if (h) jobs.notify(t(h.kind === "edit" ? "setup.live.editsMsg" : "setup.live.holdsMsg", { name: h.name, character: characters.get(userId) || "?" }));
    };
    const ui: Interaction = { held, flash, onHeld, editable: !busy, selected, selectedCharacter, dragging, attendance: data.attendance || {}, extraRoles: data.extraRoles || {}, suggest, onInspect: peekAt, onLeave: unpeek, onPick: pick, onDrop: move, onDrag: drag, onEdit: setEditing, confirmations, pinned: shownId };
    const closeDrawer = () => {
        setPinned(null);
        setSelected(null);
    };
    // the peek: the raider under the pointer or focus — not during a drag, not the one the drawer already shows,
    // and only while their line is still on the page (a move redraws it)
    const peekBase = peek && !dragging && peek.userId !== shownId && peek.el.isConnected ? peopleOf(setup).get(peek.userId) : undefined;
    const peekChar = peekBase && peek?.character ? (peekBase.characters || []).find((c) => c.character === peek.character) : undefined;
    const peekPerson = peekBase && peekChar ? asCharacter(peekBase, peekChar) : peekBase;
    // the actions on the raider shown (SlotTip) — the check only for a group place of a posted (= approved) setup
    const actions: SlotActions = inspectedPerson && !busy ? {
        confirmation: inspectedInGroup ? confirmations[inspectedPerson.userId] : undefined,
        onConfirm: inspectedInGroup && setup.status === "approved" ? act(() => toggleConfirm(inspectedPerson.userId)) : undefined,
        locked: !!inspectedPerson.locked,
        onLock: inspectedInPool ? undefined : act(() => void save(toggleLock(toInput(current.current?.setup || setup), inspectedPerson.userId))),
        onEdit: act(() => setEditing(inspectedPerson.userId)),
    } : {};
    // who in the groups has no answer yet — "Alle bestätigen" is there only while somebody is left
    const placed = setup.groups.reduce((n, g) => n + g.slots.length, 0);
    const unanswered = setup.groups.reduce((n, g) => n + g.slots.filter((s) => !confirmations[s.userId]).length, 0);
    const confirmed = setup.groups.reduce((n, g) => n + g.slots.filter((s) => confirmations[s.userId] === "confirmed").length, 0);
    const groups = withAllGroups(setup.groups, data.groupCount || 1);
    const partyBuffs = setup.checks.buffs.party;
    const lockedCount = [...setup.groups.flatMap((g) => g.slots), ...setup.bench].filter((p) => p.locked).length;
    const size = setup.checks.size;
    const approved = setup.status === "approved";
    const cancelled = !!data.publish?.cancelled;
    // ONE state (never "Gepostet" beside "noch nicht gepostet") and ONE primary button that follows it;
    // the switches "Bank mitposten" / "DMs an Spieler" count as soon as they are flipped, before the post sends them
    const publish = data.publish ? { ...data.publish, dmsEnabled: postDms } : data.publish;
    const state = setupState(setup, publish);
    const hint = publishHint(publish, approved, clock);
    // a switch flipped after the post: "Setup posten" applies it (the bench into the message, the DMs still open)
    const optionsChanged = !!data.publish && ((benchChoice !== null && benchChoice !== !!data.publish.bench) || (dmsChoice !== null && dmsChoice !== !!data.publish.dmsEnabled));
    const poolCount = (setup.pool || []).length;
    // the proposal is a tool now, not the start: fill everything, or only the free places once somebody stands
    const canFill = !cancelled && poolCount > 0 && placed < (data.event.size || 0);
    const fill = () => (placed === 0 ? void propose() : setDialog("fill"));
    const opts = summaryOptions(data, setup);
    const keep = () => toInput(current.current?.setup || setup);

    let primary: ReactNode = null;
    if (!cancelled && !approved) {
        primary = (
            <Button icon="discord" disabled={busy || placed === 0} data-tip={t("setup.editor.approve")} data-tip-sub={t("setup.editor.approveSub")} onClick={approve}>
                {t("setup.editor.approve")}
            </Button>
        );
    } else if (!cancelled && (state.needsPost || optionsChanged)) {
        primary = (
            <Button icon="discord" running={posting || !!hint?.running} disabled={busy} data-tip={t("setup.publishLine.post")} data-tip-sub={t("setup.publishLine.postSub")} onClick={post}>
                {t("setup.publishLine.post")}
            </Button>
        );
    } else if (!cancelled) {
        primary = (
            <Button icon="message" running={pinging} disabled={busy} data-tip={t("setup.ping.button")} data-tip-sub={t("setup.ping.buttonSub")} onClick={() => void pingAll()}>
                {t("setup.ping.button")}
            </Button>
        );
    }

    // a raid group (#811): more signed up than every raid of the evening has places → "Weiteren Raid hinzufügen" in the bar
    const group = data.raidGroup || null;
    const groupPlaces = group ? group.places : (data.event.size || 0);
    const signed = data.signupCount || 0;
    const overbooked = !cancelled && signed > groupPlaces;
    const thisRaid = group ? group.raids.find((r) => r.id === eventId) : undefined;
    const isFurther = !!thisRaid && thisRaid.index > 1;
    const nextIndex = group ? Math.max(...group.raids.map((r) => r.index)) + 1 : 2;
    const primaryTitle = group ? (group.raids.find((r) => r.index === 1)?.title || data.event.title) : data.event.title;
    const groupItems: (MoreItem | "sep")[] = cancelled ? [] : [
        ...(overbooked ? [] : [{ id: "addRaid", label: t("setup.raidGroup.add"), sub: t("setup.raidGroup.addSub"), icon: "members", disabled: busy || grouping, onSelect: () => setDialog("addRaid") }]),
        ...(isFurther ? [{
            id: "removeRaid", label: t("setup.raidGroup.remove", { title: data.event.title }),
            sub: thisRaid && thisRaid.approved ? t("setup.raidGroup.removeLocked", { title: data.event.title }) : t("setup.raidGroup.removeSub"),
            icon: "cancel", disabled: busy || grouping || !!(thisRaid && thisRaid.approved), onSelect: () => void removeRaid(),
        }] : []),
        "sep",
    ];
    const more: (MoreItem | "sep")[] = [
        ...groupItems,
        { id: "repropose", label: t("setup.editor.repropose"), sub: t("setup.more.reproposeSub"), icon: "simulate", disabled: busy, onSelect: () => void propose() },
        // the size is the event's own (PATCH /api/raids): only who may change the event (#725, the category orga with #728)
        ...(data.canEditEvent ? [{ id: "size", label: t("setup.more.size"), sub: t("setup.more.sizeSub", { groups: Math.max(1, Math.ceil((data.event.size || 0) / GROUP_SIZE)), size: data.event.size || 0 }), icon: "members", disabled: busy, onSelect: () => setDialog("size") }] : []),
        { id: "ping", label: t("setup.pingText.title"), sub: data.pingText || t("setup.more.pingDefault"), icon: "notify", disabled: busy, onSelect: () => setDialog("ping") },
        "sep",
        { id: "fairness", label: t("setup.summary.fairness"), sub: t("setup.summary.fairnessCap"), icon: "spell_holy_divineintervention", on: opts.fairness, disabled: busy, onSelect: () => void save(keep(), { fairness: !opts.fairness }) },
        { id: "wishes", label: t("setup.summary.wishes"), sub: opts.wishes ? t("setup.summary.wishesCapOn", { met: setup.checks.wishes.met, total: setup.checks.wishes.total }) : t("setup.more.wishesOffSub"), icon: "inv_valentineschocolate02", on: opts.wishes, disabled: busy, onSelect: () => void save(keep(), { wishes: !opts.wishes }) },
        ...(opts.avoidTotal > 0 ? [{ id: "avoid", label: t("setup.summary.avoid"), sub: t("setup.summary.avoidSub", { count: opts.avoidTotal }), icon: "cancel", on: opts.avoid, disabled: busy, onSelect: () => void save(keep(), { avoid: !opts.avoid }) }] : []),
        "sep",
        // posted and current: posting again sends the DMs a live change left open, or redraws the message
        ...(approved && !state.needsPost && hint?.canPost ? [{ id: "repost", label: t("setup.publishLine.post"), sub: t("setup.publishLine.postSub"), icon: "discord", disabled: busy || posting, onSelect: () => void post() }] : []),
        { id: "compact", label: t("setup.editor.compact"), sub: t("setup.editor.compactSub"), icon: "setup", on: compact, onSelect: toggleCompact },
        { id: "search", label: t("setup.editor.search"), sub: t("setup.editor.searchSub"), icon: "search", disabled: !data.search, onSelect: () => setDialog("search") },
        { id: "explain", label: t("setup.editor.explain"), sub: t("setup.editor.explainSub"), icon: "help", onSelect: () => setDialog("explain") },
        { id: "weights", label: t("setup.summary.weights"), sub: t("setup.editor.weightsSub"), icon: "settings", disabled: busy, onSelect: () => setDialog("weights") },
    ];

    // the counts as square fields, toned by their check — compact ("Tanks 1/2"), each with its word, never cut
    const counts: BarCount[] = roleFigures(setup).map((f) => ({
        key: f.key,
        tone: f.ok ? "ok" : f.value === 0 ? "bad" : "mid",
        text: <>{f.label} <b>{f.target ? `${f.value}/${f.target}` : f.value}</b></>,
        tip: f.target ? t("setup.summary.statTipTarget", { label: f.label, value: f.value, target: f.target }) : t("setup.summary.statTip", { label: f.label, value: f.value }),
        tipSub: f.tip,
    }));
    if (size.size) {
        counts.push({
            key: "places", tone: size.ok ? "ok" : size.count === 0 ? "bad" : "mid",
            text: <b>{t("setup.bar.placesChip", { count: size.count, size: size.size })}</b>,
            tip: t("setup.bar.places", { count: size.count, size: size.size }),
            tipSub: t("setup.editor.placesSub", { count: size.count, size: size.size, bench: setup.bench.length }),
        });
    }
    if (approved && placed > 0) {
        counts.push({
            key: "confirmed", tone: confirmed >= placed ? "ok" : "plain",
            text: <b>{t("setup.bar.confirmedChip", { count: confirmed, total: placed })}</b>,
            tip: t("setup.bar.confirmed", { count: confirmed, total: placed }), tipSub: t("setup.bar.confirmedSub"),
        });
    }
    // the split button's menu: what posting sends along — the state stays written beside it
    const postOptions = !cancelled && data.publish ? {
        bench: postBench, dms: postDms, disabled: busy, onBench: setBenchChoice, onDms: setDmsChoice,
        dmsTip: postDms === !!data.publish.dmsDefault ? t("setup.postOptions.dmsSub") : t("setup.postOptions.dmsSubOwn"),
    } : undefined;

    return (
        <div className={`se-editor${compact ? " se-compact" : ""}${selected ? " se-picking" : ""}`}>
            {/* a raid group (#811): one tab per raid of the evening, a drop target while a raider moves */}
            {group && (
                <RaidTabs
                    group={group} current={eventId} moving={!!(dragging || selected)} editable={!busy}
                    elsewhere={data.placedElsewhere || 0}
                    onSwitch={(id) => { if (id !== eventId && onSwitchRaid) onSwitchRaid(id); }}
                    onMove={(id, userId) => void moveRaid(id, userId)}
                />
            )}
            {/* ONE bar: the state and the counts (wrapping, never cut), then "Mehr", one secondary action and the split primary */}
            <div className="se-bar">
                <div className="se-bar-info">
                    <StatusBadge setup={setup} publish={data.publish} />
                    <PresenceChip editors={presence.editors} names={characters} />
                    {/* while a raider is picked the counts make room for where to click next */}
                    {selected
                        ? <span className="se-bar-pick">{t("setup.editor.pickTarget")}</span>
                        : <BarCounts counts={counts} />}
                    {lockedCount > 0 && (
                        <Badge tone="accent" icon={<LockIcon />} tip={t("setup.editor.lockedTip")} tipSub={t("setup.editor.lockedSub")}>
                            {t("setup.editor.locked", { count: lockedCount })}
                        </Badge>
                    )}
                </div>
                <div className="se-bar-act">
                    <MoreMenu items={more} />
                    {canFill && (
                        <Button
                            variant="ghost" size="sm" icon="simulate" running={busy} disabled={busy}
                            data-tip={placed === 0 ? t("setup.fill.auto") : t("setup.fill.free")} data-tip-sub={placed === 0 ? t("setup.fill.autoSub") : t("setup.fill.freeSub")}
                            onClick={fill}
                        >
                            {placed === 0 ? t("setup.fill.auto") : t("setup.fill.free")}
                        </Button>
                    )}
                    {approved && unanswered > 0 && (
                        <Button
                            variant="ghost" size="sm" icon="members" disabled={busy}
                            data-tip={t("setup.editor.confirmAll")} data-tip-sub={t("setup.editor.confirmAllSub")}
                            onClick={() => void confirmEveryone(unanswered)}
                        >
                            {t("setup.editor.confirmAll")}
                        </Button>
                    )}
                    {/* the one primary button; its chevron holds what posting sends along, the state written beside it */}
                    {primary && <PostSplit button={primary} options={postOptions} />}
                </div>
            </div>
            {/* overbooked: a calm line under the bar, the way out inside it (#811) */}
            {overbooked && (
                <div className="se-overbooked" role="status">
                    <WowIcon name="members" size={22} />
                    <span className="se-overbooked-text">{t("setup.raidGroup.overbookedHint", { count: signed, places: groupPlaces })}</span>
                    <span className="se-overbooked-sep" aria-hidden="true">—</span>
                    <Button
                        variant="ghost" size="sm" running={grouping} disabled={busy || grouping}
                        data-tip={t("setup.raidGroup.add")} data-tip-sub={t("setup.raidGroup.addOverbooked", { signed, places: groupPlaces })}
                        onClick={() => setDialog("addRaid")}
                    >
                        {t("setup.raidGroup.add")}
                    </Button>
                </div>
            )}

            {/* a container of its own: "Angemeldet" lies under the setup, or — where too narrow — docks at the bottom (setup-editor.css) */}
            <div className="se-stage">
                {/* the groups right under the bar, the bench as a row under them, "Angemeldet" (#517) under the setup — never
                    beside it, so the groups keep their width whether somebody is left or not — then one summary line */}
                <div className="se-layout">
                    <div className="se-main">
                        <GroupGrid count={groups.length}>
                            {groups.map((g) => (
                                <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                            ))}
                        </GroupGrid>
                        <BenchCard bench={setup.bench} ui={ui} />
                    </div>
                    <PoolPanel pool={setup.pool || []} ui={ui} absent={data.absent || 0} />
                    <SummaryLine data={data} setup={setup} onDetails={() => setDialog("details")} />
                    <ActivityFeed activity={presence.activity} />
                </div>
            </div>

            {/* the raider's details: a side drawer that a click opens, never an empty box */}
            {/* on a phone, while the raider is picked, the sheet is one slim line ("… gewählt – Ziel antippen"), so the
                places to tap stay in view; "Details" opens it in full */}
            {inspectedPerson && (
                <div className={`se-drawer${selected === shownId ? " se-drawer-picking" : ""}${sheetOpen ? " se-drawer-open" : ""}`}>
                    <div className="se-drawer-head">
                        <span className="kicker se-drawer-kicker">{t("setup.drawer.kicker")}</span>
                        {selected === shownId && (
                            <>
                                <span className="se-drawer-pick">{t("setup.drawer.picked", { name: inspectedPerson.character })}</span>
                                <Button variant="ghost" size="sm" className="se-drawer-more" aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)}>
                                    {sheetOpen ? t("setup.drawer.less") : t("setup.drawer.details")}
                                </Button>
                            </>
                        )}
                        <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={closeDrawer} />
                    </div>
                    <SlotTip
                        p={inspectedPerson} attendance={data.attendance ? data.attendance[inspectedPerson.userId] : undefined}
                        extra={(data.extraRoles || {})[inspectedPerson.userId] || []}
                        onExtra={inspectedIsBench ? undefined : (role, on) => void toggleExtra(inspectedPerson.userId, role, on)}
                        onSpec={busy || inspectedIsBench ? undefined : (key) => respec(inspectedPerson.userId, key)}
                        onCharacter={busy || inspectedInPool ? undefined : (c) => switchTo(inspectedPerson.userId, c)}
                        actions={actions} pinned={selected === shownId}
                    />
                </div>
            )}

            {/* the peek: the raider under the pointer or focus, read only, beside the line — never over it, never in a drag's way */}
            {peek && peekPerson && (
                <Popover anchor={peek.el} place={besidePlacement()} dismiss={false} onClose={unpeek} className="se-peek" role="tooltip">
                    <SlotTip
                        p={peekPerson} attendance={data.attendance ? data.attendance[peekPerson.userId] : undefined}
                        extra={(data.extraRoles || {})[peekPerson.userId] || []} peek
                        removable={!(setup.pool || []).some((x) => x.userId === peekPerson.userId)}
                    />
                </Popover>
            )}

            <EditorDialog open={dialog === "size"} onClose={() => setDialog(null)} icon="members" title={t("setup.more.size")}>
                <SizeControl size={data.event.size} disabled={busy} onCommit={resize} />
            </EditorDialog>
            <EditorDialog open={dialog === "ping"} onClose={() => setDialog(null)} icon="notify" title={t("setup.pingText.title")}>
                <PingTextField value={data.pingText || ""} disabled={busy} onSave={savePingText} />
            </EditorDialog>
            <EditorDialog open={dialog === "details"} onClose={() => setDialog(null)} icon="home" title={t("setup.line.detailsTitle")} width={640}>
                <Summary
                    data={data} setup={setup} busy={busy}
                    onFairness={(on) => save(keep(), { fairness: on })}
                    onWishes={(on) => save(keep(), { wishes: on })}
                    onAvoid={(on) => save(keep(), { avoid: on })}
                />
            </EditorDialog>
            <FillModal open={dialog === "fill"} onClose={() => setDialog(null)} placed={placed} free={Math.max(0, (data.event.size || 0) - placed)} onFill={(keepPlaced) => void propose(undefined, keepPlaced ? "placed" : undefined)} />
            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <SearchModal open={dialog === "search"} onClose={() => setDialog(null)} ctx={raidCtx} search={data.search} />
            <AddRaidModal open={dialog === "addRaid"} onClose={() => setDialog(null)} suggested={`${primaryTitle} ${nextIndex}`} running={grouping} onCreate={(title) => void addRaid(title)} />
            {editPerson && <SignupEditModal key={editPerson.userId} eventId={eventId} person={editPerson} onClose={() => setEditing(null)} onSave={saveSignup} />}
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={raidCtx} data={data} setup={setup} onDone={load} />
        </div>
    );
}
