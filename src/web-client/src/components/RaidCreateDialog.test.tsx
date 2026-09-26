// "Neues Event" as the guided dialog over the Raid-Events list: one step at a
// time, ?source=<id> straight into "Termin", explanations in tooltips, the
// result as a toast (the dialog closes, nothing navigates), the waiting list
// behind "Mehr" and the announcement in the channel step (#306), and the
// Raid-Helper templates the raid templates link. The steps' own rules are in
// lib/eventCreateDialog.test.ts.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { RaidCreateContext, RaidTemplate } from "../api";
import { t } from "../i18n";
import { renderPage } from "../test/render";
import RaidCreateDialog from "./RaidCreateDialog";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidCreateContext: vi.fn(),
    getChannelNameSuggestion: vi.fn(),
    createRaid: vi.fn(),
    updateRaid: vi.fn(),
    saveRaidTemplate: vi.fn(),
}));

// Thursday 17 September 2026: "Wiederholen" of a Thursday raid means the 24th.
const NOW = Date.UTC(2026, 8, 17, 10, 0);

function tpl(over: Partial<RaidTemplate>): RaidTemplate {
    return {
        id: "t0", name: "", versionId: "tbc", instanceIds: [], size: 25,
        composition: { tank: 2, healer: 5, melee: null, ranged: null },
        requiredBuffs: [], signupDeadline: null, durationMinutes: null, fairness: false, wishes: false,
        raidhelperTemplateId: "", ...over,
    };
}

const CONTEXT: RaidCreateContext = {
    defaults: { templateId: "rh-std", channelId: "ch1" },
    categoryTemplates: { c1: "rh-kara" },
    leaderId: "u1",
    leaderCandidates: [{ id: "u1", name: "Admin" }],
    channels: [{ id: "ch1", name: "kara-do-17-09", type: 0, typeLabel: "Text", category: "T4", parentId: "c1", isThread: false }],
    templates: [
        tpl({ id: "t1", name: "Kara-Abend", raidhelperTemplateId: "rh-kara" }),
        // shares the Raid-Helper id with t1: one option per id
        tpl({ id: "t2", name: "Kara-Kopie", raidhelperTemplateId: "rh-kara" }),
        // links no Raid-Helper template: cannot be sent
        tpl({ id: "t3", name: "Ohne Link" }),
        tpl({ id: "t4", name: "Gruul-Abend", raidhelperTemplateId: "rh-gruul" }),
    ],
    reusableEvents: [{
        id: "e1", title: "Kara Donnerstag", templateId: "", description: "", channelId: "ch1", channelName: "kara-do-17-09",
        categoryId: "c1", categoryName: "T4", startTime: Math.floor(Date.UTC(2026, 8, 17, 17, 45) / 1000), contentIds: ["kara"],
    }],
    signupSources: { c2: "eventhelper" },
    categoryAnnounce: { c2: { enabled: true, target: "talk" } },
    categories: [{ id: "c1", name: "T4" }, { id: "c2", name: "T6" }, { id: "c3", name: "Sonstiges" }],
    raidTemplates: [],
    versions: [],
};

function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
}

function show(props: { sourceId?: string } = {}) {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderPage(
        <>
            <RaidCreateDialog open sourceId={props.sourceId || ""} userId="u1" onClose={onClose} onCreated={onCreated} />
            <Where />
        </>,
        { route: "/raids/new" },
    );
    return { onClose, onCreated };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A field by the start of its label — labels with a tooltip also carry the "i". */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${escape(label)}`), { selector: "input, select, textarea" });

const currentStep = () => within(screen.getByRole("list", { name: t("raidCreate.progress") })).getByRole("listitem", { current: "step" });
const nextButton = () => screen.getByRole("button", { name: new RegExp(`^${escape(t("raidCreate.footer.next", { step: "" }).trim())}`) });

async function next(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await user.click(nextButton());
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    vi.mocked(api.getRaidCreateContext).mockReset().mockResolvedValue(CONTEXT);
    vi.mocked(api.getChannelNameSuggestion).mockReset().mockImplementation(async (input) => ({
        name: input.categoryId === "c2" ? "t6-do-24-09" : "kara-do-24-09",
        source: "previous", label: "abgeleitet", detail: "", design: "", fromChannel: "", templateChannelId: "", templateChannelName: "", replaced: [],
    }));
    vi.mocked(api.createRaid).mockReset().mockResolvedValue({ id: "new1", messageError: null, announced: false, announceError: null });
});

describe("Neues Event dialog", () => {
    it("walks through its steps and creates the event", async () => {
        const user = userEvent.setup();
        show();
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(t("raidCreate.footer.titleNew"))).toBeInTheDocument();
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.start"));
        expect(within(dialog).getByText(t("raidCreate.footer.stepOf", { n: 1, total: 4 }))).toBeInTheDocument();

        // nothing picked, no way on
        const card = await screen.findByRole("radio", { name: /Kara Donnerstag/ });
        expect(nextButton()).toBeDisabled();
        await user.click(card);
        expect(card).toHaveAttribute("aria-checked", "true");

        await next(user);
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.termin"));
        // repeating Thursday's raid means next Thursday, same time
        expect(field(t("raidCreate.termin.title"))).toHaveValue("Kara Donnerstag");
        expect(field(t("raidCreate.termin.date"))).toHaveValue("2026-09-24");
        expect(field(t("raidCreate.termin.time"))).toHaveValue("19:45");

        await next(user);
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.kanal"));
        expect(field(t("raidCreate.kanal.channel"))).toHaveValue("kara-do-24-09");

        await next(user);
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.check"));
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.create") }));

        await waitFor(() => expect(api.createRaid).toHaveBeenCalledTimes(1));
        expect(api.createRaid).toHaveBeenCalledWith(expect.objectContaining({
            title: "Kara Donnerstag", date: "2026-09-24", time: "19:45", leaderId: "u1",
            templateId: "rh-kara", signupSource: "raidhelper", sourceEventId: "e1", channelName: "kara-do-24-09",
        }));
    });

    it("opens a ?source link past the start step, with a way back to it", async () => {
        const user = userEvent.setup();
        show({ sourceId: "e1" });
        await waitFor(() => expect(currentStep()).toHaveTextContent(t("raidPlan.step.termin")));
        expect(screen.getByText(t("raidCreate.footer.stepOf", { n: 2, total: 4 }))).toBeInTheDocument();
        expect(field(t("raidCreate.termin.title"))).toHaveValue("Kara Donnerstag");

        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.back") }));
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.start"));
        expect(screen.getByRole("radio", { name: /Kara Donnerstag/ })).toHaveAttribute("aria-checked", "true");
    });

    it("explains fields in tooltips instead of hint paragraphs", async () => {
        const { container } = renderAtTermin();
        await waitFor(() => expect(currentStep()).toHaveTextContent(t("raidPlan.step.termin")));
        const label = container.querySelector("label[for=\"re-category\"]");
        const info = label?.querySelector("[data-tip-sub]");
        expect(info).toHaveAttribute("data-tip", t("raidCreate.termin.category"));
        expect(info).toHaveAttribute("data-tip-sub", t("raidCreate.termin.categoryTip"));
        expect(screen.queryByText(t("raidCreate.termin.categoryTip"))).not.toBeInTheDocument();
        expect(container.querySelector(".hint")).toBeNull();
    });

    it("reports the result as a toast and hands back instead of navigating", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRaid).mockResolvedValue({ id: "new1", messageError: "Kanal voll", announced: false, announceError: null });
        const { onCreated } = show({ sourceId: "e1" });
        await waitFor(() => expect(currentStep()).toHaveTextContent(t("raidPlan.step.termin")));
        await next(user);
        await next(user);
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.create") }));

        expect(await screen.findByText(t("raidCreate.toast.createdWithError", { error: "Kanal voll" }))).toBeInTheDocument();
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("where")).toHaveTextContent("/raids/new");
    });

    it("keeps the waiting list behind \"Mehr\" and the announcement in the channel step (#306)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.createRaid).mockResolvedValue({ id: "eh-1", messageError: null, announced: true, announceError: null });
        show();
        await user.click(await screen.findByRole("radio", { name: new RegExp(escape(t("raidCreate.start.empty"))) }));
        await next(user);

        // An EventHelper category: the planning step joins the walk.
        fireEvent.change(field(t("raidCreate.termin.title")), { target: { value: "Hyjal + BT" } });
        fireEvent.change(field(t("raidCreate.termin.date")), { target: { value: "2026-09-24" } });
        fireEvent.change(field(t("raidCreate.termin.time")), { target: { value: "19:30" } });
        await user.selectOptions(field(t("raidCreate.termin.category")), "c2");
        expect(screen.getByText(t("raidCreate.footer.stepOf", { n: 2, total: 5 }))).toBeInTheDocument();

        await next(user);
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.raid"));
        await user.click(screen.getByText(t("raidCreate.raid.more")));
        const overflow = screen.getByRole("checkbox", { name: t("raidCreate.raid.overflow") });
        const lock = screen.getByRole("checkbox", { name: t("raidCreate.raid.lockAtLimit") });
        expect(overflow).toBeChecked();
        expect(lock).not.toBeChecked();
        await user.click(lock);
        // the announcement is not part of the raid step
        expect(screen.queryByRole("checkbox", { name: t("raidCreate.kanal.announce") })).not.toBeInTheDocument();

        await next(user);
        expect(currentStep()).toHaveTextContent(t("raidPlan.step.kanal"));
        // switched on by the category
        expect(screen.getByRole("checkbox", { name: t("raidCreate.kanal.announce") })).toBeChecked();
        await waitFor(() => expect(field(t("raidCreate.kanal.channel"))).toHaveValue("t6-do-24-09"));

        await next(user);
        expect(screen.getByText(t("raidCreate.check.announcePing"))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.create") }));

        await waitFor(() => expect(api.createRaid).toHaveBeenCalledTimes(1));
        expect(api.createRaid).toHaveBeenCalledWith(expect.objectContaining({
            signupSource: "eventhelper", announce: true, overflow: "bench", lockAtLimit: true,
            newChannel: { name: "t6-do-24-09", categoryId: "c2" },
        }));
        expect(await screen.findByText(t("raidCreate.toast.createdAnnounced"))).toBeInTheDocument();
    });

    it("sends no announcement once it is switched off", async () => {
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("radio", { name: new RegExp(escape(t("raidCreate.start.empty"))) }));
        await next(user);
        fireEvent.change(field(t("raidCreate.termin.title")), { target: { value: "Hyjal + BT" } });
        fireEvent.change(field(t("raidCreate.termin.date")), { target: { value: "2026-09-24" } });
        fireEvent.change(field(t("raidCreate.termin.time")), { target: { value: "19:30" } });
        await user.selectOptions(field(t("raidCreate.termin.category")), "c2");
        await next(user);
        await next(user);
        await user.click(screen.getByRole("checkbox", { name: t("raidCreate.kanal.announce") }));
        await next(user);
        expect(screen.getByText(t("raidCreate.check.announceNone"))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.create") }));
        await waitFor(() => expect(api.createRaid).toHaveBeenCalledWith(expect.objectContaining({ announce: false })));
        expect(await screen.findByText(t("raidCreate.toast.created"))).toBeInTheDocument();
    });

    it("offers the raid templates that link a Raid-Helper template, preselecting the category default", async () => {
        const user = userEvent.setup();
        show();
        await user.click(await screen.findByRole("radio", { name: new RegExp(escape(t("raidCreate.start.empty"))) }));
        await next(user);
        fireEvent.change(field(t("raidCreate.termin.title")), { target: { value: "Kara" } });
        fireEvent.change(field(t("raidCreate.termin.date")), { target: { value: "2026-09-24" } });
        fireEvent.change(field(t("raidCreate.termin.time")), { target: { value: "19:45" } });
        await next(user);

        const select = field(t("raidCreate.kanal.rhTemplate")) as HTMLSelectElement;
        const options = within(select).getAllByRole("option").map((o) => o.textContent);
        expect(options).toEqual([t("raidCreate.kanal.rhPick"), "Kara-Abend · ID rh-kara", "Gruul-Abend · ID rh-gruul"]);
        // the default channel's category T4 brings its default template
        expect(select).toHaveValue("rh-kara");
        expect(screen.getByRole("link", { name: t("raidCreate.templatesLink") })).toHaveAttribute("href", "/raids/raid-templates");

        // a category without a default of its own falls back to the general default
        await user.click(screen.getByRole("button", { name: t("raidCreate.footer.back") }));
        await user.selectOptions(field(t("raidCreate.termin.category")), "c3");
        await next(user);
        expect(field(t("raidCreate.kanal.rhTemplate"))).toHaveValue("rh-std");
    });
});

function renderAtTermin() {
    const onClose = vi.fn();
    return renderPage(<RaidCreateDialog open sourceId="e1" userId="u1" onClose={onClose} onCreated={vi.fn()} />);
}
