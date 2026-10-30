import type { ApiError } from "../../api/client";
import { MAX_NOTES } from "../../api/vermerke";
import type { useT } from "../../i18n";

/**
 * A refusal of a Vermerke write in plain words (#980): a page loaded for another
 * server (`server_switched`), an archived entry, too many notes; anything else
 * as "<fallback>: <message>".
 */
export function vermerkErrorText(t: ReturnType<typeof useT>, err: unknown, fallbackKey: string): string {
    const e = err as ApiError | undefined;
    const code = e && e.code;
    if (code === "server_switched") return t("vermerke.error.serverSwitched");
    if (code === "archived") return t("vermerke.error.archived");
    if (code === "too_many") return t("vermerke.dialog.tooMany", { max: MAX_NOTES });
    return t(fallbackKey, { message: (e && e.message) || String(err) });
}
