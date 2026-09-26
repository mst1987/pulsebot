import type { ReactNode } from "react";
import type { ApiError } from "../../api";
import type { AsyncState } from "../../lib/asyncState";
import RaidLoader from "./RaidLoader";

/**
 * Renders one useApi state the way every page does (#437): the error in the
 * page's plain style when the last call failed, the loader until the first
 * answer, the data otherwise. The order is the one the pages had by hand —
 * `if (error) …; if (!data) …;` — so a failed reload shows its error the same
 * way a failed first load does.
 */
export default function AsyncView<T>({ state, loading, error, children }: {
    state: AsyncState<T>;
    /** What stands in for the page until the first answer (default: the raid loader without a line). */
    loading?: ReactNode;
    /** The error line; the default is the message alone. */
    error?: (err: ApiError) => ReactNode;
    children: (data: T) => ReactNode;
}) {
    if (state.error) return <>{error ? error(state.error) : <div className="empty">{state.error.message}</div>}</>;
    if (state.data === null) return <>{loading ?? <RaidLoader />}</>;
    return <>{children(state.data)}</>;
}
