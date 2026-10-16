// The watch over the way to the acknowledgement (ackTiming.js): phases and the slow warning.
const { trackAck, ACK_WARN_MS } = require("../../../src/services/discord/ackTiming");

let clock;
const now = () => clock;

beforeEach(() => {
    clock = 1_000_000;
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("trackAck", () => {
    it("reports the phases: arrival lag, guard, handler until acknowledged", () => {
        const i = { createdTimestamp: clock - 300, deferred: false, replied: false };
        const t = trackAck(i, { name: "event-new", now, pollMs: 5 });
        clock += 40; // the guard
        t.guardDone();
        clock += 100; // the handler
        i.deferred = true;
        const phases = t.finish();
        expect(phases).toEqual({ name: "event-new", totalMs: 440, entryMs: 300, guardMs: 40, handlerMs: 100 });
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("warns above two seconds, with the command and all three phases", () => {
        const i = { createdTimestamp: clock - 900, deferred: false, replied: false };
        const t = trackAck(i, { name: "event-rename", now });
        clock += 700;
        t.guardDone();
        clock += 600;
        i.replied = true;
        t.finish();
        expect(ACK_WARN_MS).toBe(2000);
        const line = console.warn.mock.calls[0].join(" ");
        expect(line).toContain("[ack]");
        expect(line).toContain("event-rename");
        expect(line).toContain("2200 ms");
        expect(line).toContain("arrival 900 ms");
        expect(line).toContain("access guard 700 ms");
        expect(line).toContain("handler until acknowledged 600 ms");
    });

    it("stays quiet when the handler never acknowledged here, and tolerates a missing timestamp", () => {
        const i = { deferred: false, replied: false };
        const t = trackAck(i, { name: "x", now });
        clock += 5000;
        expect(t.finish()).toBeNull();
        expect(console.warn).not.toHaveBeenCalled();
        expect(trackAck(null, { now }).finish()).toBeNull();
    });

    it("sees an acknowledgement the poll has not yet noticed when the handler returns", () => {
        const i = { createdTimestamp: clock, deferred: false, replied: false };
        const t = trackAck(i, { name: "x", now, pollMs: 1000 });
        clock += 2500;
        i.deferred = true;
        t.guardDone();
        expect(t.finish()).toMatchObject({ totalMs: 2500 });
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("an interaction acknowledged before the timer started has zero handler time", () => {
        const i = { createdTimestamp: clock - 10, deferred: true };
        const t = trackAck(i, { name: "x", now });
        expect(t.finish()).toMatchObject({ entryMs: 10, handlerMs: 0, totalMs: 10 });
    });

    it("never touches the interaction's methods (handlers and their tests see the same object)", () => {
        const reply = jest.fn();
        const i = { createdTimestamp: clock, deferred: false, replied: false, reply };
        const t = trackAck(i, { now });
        t.finish();
        expect(i.reply).toBe(reply);
    });
});
