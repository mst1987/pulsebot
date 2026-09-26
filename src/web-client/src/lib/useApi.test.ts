// One way to load what a page shows (#437): hooks/useApi.ts over the pure
// rules in lib/asyncState.ts, drawn by components/ui/AsyncView.tsx. The race
// protection is what matters most and is tested here without React: a call is
// numbered when it starts, and only the newest call's answer counts.
// The hook, the view and the pages are checked by source in test/web-client/useApi.test.js.
import { describe, expect, it } from "vitest";
import { initialState, started, settled, stopped } from "./asyncState";

describe("lib/asyncState.ts — the rules under useApi", () => {
    const err = { code: "x", message: "boom" };

    it("starts loading at once when a request is about to go out, quiet when it is not", () => {
        expect(initialState(true)).toEqual({ data: null, error: null, loading: true });
        expect(initialState(false)).toEqual({ data: null, error: null, loading: false });
        expect(initialState(true, { n: 1 })).toEqual({ data: { n: 1 }, error: null, loading: true });
    });

    it("keeps the last answer and error on screen while a new call runs", () => {
        const s = { data: { n: 1 }, error: err, loading: false };
        expect(started(s)).toEqual({ data: { n: 1 }, error: err, loading: true });
        const already = { data: null, error: null, loading: true };
        expect(started(already)).toBe(already);
    });

    it("applies the newest call's answer: success replaces the data and clears the error, failure keeps the data", () => {
        const s = { data: { n: 1 }, error: err, loading: true };
        expect(settled(s, 3, 3, { ok: true, data: { n: 2 } })).toEqual({ data: { n: 2 }, error: null, loading: false });
        expect(settled(s, 3, 3, { ok: false, error: { code: "y", message: "no" } })).toEqual({ data: { n: 1 }, error: { code: "y", message: "no" }, loading: false });
    });

    it("drops a stale answer — the last call wins, whatever order the answers arrive in", () => {
        const s = { data: { n: 1 }, error: null, loading: true };
        // call 2 answers after call 3 went out: nothing changes, the page keeps waiting for 3
        expect(settled(s, 2, 3, { ok: true, data: { n: 99 } })).toBe(s);
        expect(settled(s, 2, 3, { ok: false, error: err })).toBe(s);
        // then 3 lands
        expect(settled(s, 3, 3, { ok: true, data: { n: 3 } })).toEqual({ data: { n: 3 }, error: null, loading: false });
        // an answer to a call that was never issued (unmounted, deps changed) is stale too
        expect(settled(s, 3, 4, { ok: true, data: { n: 3 } })).toBe(s);
    });

    it("stops the spinner without touching data or error when the request is switched off", () => {
        expect(stopped({ data: { n: 1 }, error: err, loading: true })).toEqual({ data: { n: 1 }, error: err, loading: false });
        const idle = { data: null, error: null, loading: false };
        expect(stopped(idle)).toBe(idle);
    });
});
