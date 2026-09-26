import js from "@eslint/js";
import globals from "globals";
import jest from "eslint-plugin-jest";

// Rules shared by every CommonJS block (src/, scripts/, hooks, test/).
const sharedRules = {
    "no-undef": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "prefer-const": "error",
    "no-var": "error",
    "no-useless-escape": "error",
    "no-console": "off",
    "consistent-return": "off",
    complexity: ["warn", 30],
    eqeqeq: ["error", "always"],
    // Line endings are left to Git (.gitattributes) + the editor, not ESLint:
    // git stores LF blobs, so a fixed "windows" rule fails the Linux CI while a
    // "unix" rule fails local Windows checkouts. So linebreak-style stays off.
    "linebreak-style": "off",
    // New in @eslint/js 10 recommended. Cleaned up (32 hits, mostly
    // no-useless-assignment) and enforced since.
    "no-useless-assignment": "error",
    "preserve-caught-error": "error",
    // Core formatting rules (indent/quotes/semi) are deprecated in favour of
    // @stylistic but still ship until ESLint 11 — one move for all three later.
    indent: ["error", 4, { SwitchCase: 1 }],
    quotes: ["error", "double"],
    semi: ["error", "always"],
};

export default [
    {
        // The React client has its own toolchain/config (src/web-client/eslint.config.js).
        ignores: ["src/web-client/**"],
    },
    js.configs.recommended,
    {
        files: ["src/**/*.js", "scripts/**/*.js", ".claude/hooks/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: sharedRules,
    },
    {
        // The report pages' client script runs in the browser (#423); it only
        // touches `module` to hand its pure helpers to the Jest tests.
        // It is plain ES5 on purpose (served unbundled, no build step), hence
        // `var` stays allowed there.
        files: ["src/web/static/**/*.js"],
        languageOptions: {
            globals: { ...globals.browser },
        },
        rules: { "no-var": "off", "prefer-const": "off" },
    },
    {
        // scripts/render-ui-emojis.js keeps the flat UI icons as SVG fragments, and
        // SVG attributes are written in double quotes ('<path d="…"/>'). The
        // project's double-quote rule would mean escaping every attribute of every
        // drawing — unreadable, and `--fix` would do it silently, which is why the
        // whole folder stayed out of the lint run until #320. So the quote rule is
        // off for this one file; every other rule still applies to it.
        files: ["scripts/render-ui-emojis.js"],
        rules: { quotes: "off" },
    },
    {
        files: ["test/**/*.js", "jest.config.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: { ...globals.node, ...globals.jest },
        },
        rules: sharedRules,
    },
    {
        files: ["test/**/*.js"],
        plugins: { jest },
        rules: {
            "jest/no-focused-tests": "error",
            "jest/no-disabled-tests": "error",
            "jest/valid-expect": "error",
            "jest/no-identical-title": "error",
        },
    },
];
