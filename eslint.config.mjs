export default [
  {
    files: ["src/**/*.js"],
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
