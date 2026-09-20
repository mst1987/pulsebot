export default [
  {
    // The React client has its own toolchain/config (src/web-client/eslint.config.js).
    ignores: ["src/web-client/**"],
  },
  {
    files: ["src/**/*.js", "scripts/**/*.js", ".claude/hooks/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off",
      "no-console": "off",
      "consistent-return": "off",
      eqeqeq: ["error", "always"],
      // Line endings are left to Git (core.autocrlf) + the editor, not ESLint:
      // git stores LF blobs, so a fixed "windows" rule fails the Linux CI while a
      // "unix" rule fails local Windows checkouts. So linebreak-style stays off.
      "linebreak-style": "off",
      quotes: ["error", "double"],
      semi: ["error", "always"],
    },
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
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        // Jest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off",
      "no-console": "off",
      eqeqeq: ["error", "always"],
      // See the src block: linebreak-style is off to keep the Linux CI green.
      "linebreak-style": "off",
      quotes: ["error", "double"],
      semi: ["error", "always"],
    },
  },
];
