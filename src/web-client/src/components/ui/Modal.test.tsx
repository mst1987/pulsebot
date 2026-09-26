import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmProvider, Modal, useConfirm, type ConfirmOptions } from "./Modal";
import { t } from "../../i18n";

describe("Modal", () => {
    it("shows its title and content while open and nothing while closed", () => {
        const { rerender } = render(<Modal open={false} onClose={() => undefined} title="Raid bearbeiten">Inhalt</Modal>);
        expect(screen.queryByText("Inhalt")).not.toBeInTheDocument();
        rerender(<Modal open onClose={() => undefined} title="Raid bearbeiten">Inhalt</Modal>);
        expect(screen.getByText("Raid bearbeiten")).toBeInTheDocument();
        expect(screen.getByText("Inhalt")).toBeVisible();
    });

    it("closes on Escape", async () => {
        const onClose = vi.fn();
        render(<Modal open onClose={onClose} title="Raid bearbeiten">Inhalt</Modal>);
        await userEvent.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalled();
    });

    it("closes on its close button and on the backdrop, not on a click into the content", async () => {
        const onClose = vi.fn();
        render(<Modal open onClose={onClose} title="Raid bearbeiten">Inhalt</Modal>);
        const user = userEvent.setup();
        await user.click(screen.getByText("Inhalt"));
        expect(onClose).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: t("common.close") }));
        expect(onClose).toHaveBeenCalledTimes(1);
        // a click whose target is the <dialog> itself landed on the backdrop
        await user.click(screen.getByRole("dialog"));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

type User = ReturnType<typeof userEvent.setup>;

/** A page that asks and writes down every answer. */
function Asker({ options, answers }: { options: ConfirmOptions; answers: boolean[] }) {
    const ask = useConfirm();
    return <button type="button" onClick={async () => { answers.push(await ask(options)); }}>Fragen</button>;
}

async function askOnce(options: ConfirmOptions = { title: "Log löschen?", text: "Weg ist weg.", action: "Löschen" }) {
    const answers: boolean[] = [];
    render(<ConfirmProvider><Asker options={options} answers={answers} /></ConfirmProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fragen" }));
    const dialog = screen.getByRole("dialog");
    return { answers, user, dialog };
}

describe("useConfirm — the page's own dialog instead of window.confirm", () => {
    it("asks with title, text and action, and says yes only on the action", async () => {
        const { answers, user, dialog } = await askOnce();
        expect(within(dialog).getByText("Log löschen?")).toBeInTheDocument();
        expect(within(dialog).getByText("Weg ist weg.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Löschen" }));
        await waitFor(() => expect(answers).toEqual([true]));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("never preselects the destructive button: the focus is on Abbrechen", async () => {
        const { dialog } = await askOnce();
        expect(within(dialog).getByRole("button", { name: t("common.cancel") })).toHaveFocus();
    });

    it.each<[string, (user: User, dialog: HTMLElement) => Promise<void>]>([
        ["Abbrechen", (user, dialog) => user.click(within(dialog).getByRole("button", { name: t("common.cancel") }))],
        ["the close button", (user, dialog) => user.click(within(dialog).getByRole("button", { name: t("common.close") }))],
        ["Escape", (user) => user.keyboard("{Escape}")],
        ["the backdrop", (user, dialog) => user.click(dialog)],
    ])("says no on %s", async (_, dismiss) => {
        const { answers, user, dialog } = await askOnce();
        await dismiss(user, dialog);
        await waitFor(() => expect(answers).toEqual([false]));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("answers two questions one after the other", async () => {
        const answers: boolean[] = [];
        render(
            <ConfirmProvider>
                <Asker options={{ title: "Erste?", action: "Ja 1" }} answers={answers} />
                <Asker options={{ title: "Zweite?", action: "Ja 2" }} answers={answers} />
            </ConfirmProvider>,
        );
        const user = userEvent.setup();
        const [first, second] = screen.getAllByRole("button", { name: "Fragen" });
        await user.click(first);
        // modal in a browser; in jsdom the second page button is still reachable
        await user.click(second);
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ja 1" }));
        expect(await within(screen.getByRole("dialog")).findByText("Zweite?")).toBeInTheDocument();
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("common.cancel") }));
        await waitFor(() => expect(answers).toEqual([true, false]));
    });
});
