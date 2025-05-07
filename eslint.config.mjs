// eslint.config.js
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
  // Base configuration for all JavaScript files
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
      globals: {
        node: true,
        mocha: true,
        es2020: true
      }
    },
    rules: {
      "curly": 0,
      "no-lonely-if": 1,
      "no-mixed-requires": 0,
      "no-underscore-dangle": 0,
      "no-unused-vars": [2, {
        "vars": "all",
        "args": "after-used"
      }],
      "no-use-before-define": [2, "nofunc"],
      "quotes": 0,
      "semi": [2, "always"],
      "space-infix-ops": 0,
      "strict": 0,
      "max-len": [1, 160, 2]
    }
  },
  // TypeScript-specific configuration
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": typescriptEslint
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
      parser: typescriptParser,
      globals: {
        node: true,
        mocha: true,
        es2020: true
      },
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    rules: {
      // Disable JavaScript rules that are handled by TypeScript
      "no-unused-vars": "off",
      "no-use-before-define": "off",

      // Enable TypeScript-specific rules
      "@typescript-eslint/no-unused-vars": [2, {
        "vars": "all",
        "args": "after-used"
      }],
      "@typescript-eslint/no-use-before-define": [2, { "functions": false }],

      // Inherit base rules
      "curly": 0,
      "no-lonely-if": 1,
      "no-mixed-requires": 0,
      "no-underscore-dangle": 0,
      "quotes": 0,
      "semi": [2, "always"],
      "space-infix-ops": 0,
      "strict": 0,
      "max-len": [1, 160, 2]
    }
  }
];
