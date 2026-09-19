// Which commit the running process is (#314). The one rule this module has to
// keep is that it never throws: no git, no repository, a hanging or nonsense
// output must all leave the fields empty and the bot running.
jest.mock("child_process", () => ({ execFileSync: jest.fn() }));

const { execFileSync } = require("child_process");

const SHA = "26bf95c46be094715d4ffe3d8cecbc87cad99748";

function load() {
    const mod = require("../../src/web/version");
    mod.resetVersionCache();
    return mod;
}

describe("web/version", () => {
    const envCommit = process.env.GIT_COMMIT;

    beforeEach(() => {
        // Not jest.resetModules(): that would rebuild the child_process mock, and
        // a freshly required version.js would then call a different jest.fn()
        // than the one asserted on here. resetVersionCache() forces the re-read.
        execFileSync.mockReset();
        delete process.env.GIT_COMMIT;
    });

    afterAll(() => {
        if (envCommit === undefined) delete process.env.GIT_COMMIT;
        else process.env.GIT_COMMIT = envCommit;
    });

    it("reads sha, commit date and subject from git", () => {
        execFileSync.mockReturnValue(`${SHA}\n2026-09-18T11:54:34+02:00\nMerge pull request #313\n`);
        const info = load().versionInfo();
        expect(info.commit).toBe(SHA);
        expect(info.short).toBe("26bf95c");
        expect(info.committedAt).toBe(new Date("2026-09-18T11:54:34+02:00").toISOString());
        expect(info.subject).toBe("Merge pull request #313");
        expect(new Date(info.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("asks git only once per process", () => {
        execFileSync.mockReturnValue(`${SHA}\n2026-09-18T11:54:34+02:00\nsubject\n`);
        const mod = load();
        mod.versionInfo();
        mod.versionInfo();
        mod.versionInfo();
        expect(execFileSync).toHaveBeenCalledTimes(1);
    });

    it("hands out a copy, so no caller can edit the cache", () => {
        execFileSync.mockReturnValue(`${SHA}\n2026-09-18T11:54:34+02:00\nsubject\n`);
        const mod = load();
        mod.versionInfo().commit = "tampered";
        expect(mod.versionInfo().commit).toBe(SHA);
    });

    it("leaves the fields empty when git is not there at all", () => {
        execFileSync.mockImplementation(() => { throw new Error("spawn git ENOENT"); });
        expect(load().versionInfo()).toMatchObject({ commit: "", short: "", committedAt: "", subject: "" });
    });

    it("leaves the fields empty outside a repository", () => {
        execFileSync.mockImplementation(() => { throw new Error("fatal: not a git repository"); });
        expect(load().versionInfo().commit).toBe("");
    });

    it("refuses a broken output instead of reporting nonsense as a commit", () => {
        for (const out of ["", "\n\n", "not-a-sha\n2026-09-18\nsubject", "usage: git [--version]", null, undefined]) {
            execFileSync.mockReset();
            execFileSync.mockReturnValue(out);
            expect(load().versionInfo().commit).toBe("");
        }
    });

    it("keeps the sha but drops a date git could not format", () => {
        execFileSync.mockReturnValue(`${SHA}\n%cI\nsubject`);
        const info = load().versionInfo();
        expect(info.commit).toBe(SHA);
        expect(info.committedAt).toBe("");
    });

    it("falls back to GIT_COMMIT when git is unavailable (Docker, tarball)", () => {
        execFileSync.mockImplementation(() => { throw new Error("no git"); });
        process.env.GIT_COMMIT = SHA.toUpperCase();
        const info = load().versionInfo();
        expect(info.commit).toBe(SHA);
        expect(info.short).toBe("26bf95c");
        expect(info.committedAt).toBe("");
    });

    it("ignores a GIT_COMMIT that is not a sha", () => {
        execFileSync.mockImplementation(() => { throw new Error("no git"); });
        process.env.GIT_COMMIT = "unknown";
        expect(load().versionInfo().commit).toBe("");
    });

    it("prefers git over the environment variable", () => {
        execFileSync.mockReturnValue(`${SHA}\n2026-09-18T11:54:34+02:00\nsubject`);
        process.env.GIT_COMMIT = "0000000000000000000000000000000000000000";
        expect(load().versionInfo().commit).toBe(SHA);
    });

    it("runs git with a timeout and never lets its stderr out", () => {
        execFileSync.mockReturnValue(`${SHA}\n2026-09-18T11:54:34+02:00\nsubject`);
        load().versionInfo();
        const [cmd, args, opts] = execFileSync.mock.calls[0];
        expect(cmd).toBe("git");
        expect(args).toEqual(["log", "-1", "--format=%H%n%cI%n%s"]);
        expect(opts.timeout).toBeGreaterThan(0);
        expect(opts.stdio).toEqual(["ignore", "pipe", "ignore"]);
    });
});
