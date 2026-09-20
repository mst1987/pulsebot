// A throwaway git repository for the Claude-Code hook tests: one commit, a
// linked worktree and a .gitignore — the shape of eventhelper plus
// ../eventhelper-<name>. Everything lives under os.tmpdir() in a directory of
// its own (mkdtemp), so suites running side by side never meet.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function git(args, cwd) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * @param {object} opts { ignore } - the .gitignore to commit
 * @returns {{ root: string, main: string, linked: string }}
 */
function makeRepo({ ignore = ".env.dev\ndata/\n" } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eh-guard-"));
    const main = path.join(root, "repo");
    const linked = path.join(root, "repo-feature");
    fs.mkdirSync(main);
    // `git init -b` needs git >= 2.28; the branch name is irrelevant here.
    git(["init", "-q"], main);
    git(["config", "user.email", "t@example.com"], main);
    git(["config", "user.name", "t"], main);
    git(["config", "commit.gpgsign", "false"], main);
    fs.writeFileSync(path.join(main, ".gitignore"), ignore);
    fs.writeFileSync(path.join(main, "a.js"), "module.exports = 1;\n");
    fs.mkdirSync(path.join(main, "src"), { recursive: true });
    fs.writeFileSync(path.join(main, "src", "web.js"), "module.exports = 2;\n");
    git(["add", "."], main);
    git(["commit", "-q", "-m", "init"], main);
    git(["worktree", "add", linked, "-b", "feature/x", "HEAD"], main);
    return { root, main, linked };
}

function removeRepo(repo) {
    if (repo && repo.root) fs.rmSync(repo.root, { recursive: true, force: true, maxRetries: 3 });
}

module.exports = { makeRepo, removeRepo, git };
