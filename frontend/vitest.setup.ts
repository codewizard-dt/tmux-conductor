// The bare '@testing-library/jest-dom' entry extends a global `expect`,
// which only exists when vitest.config.ts sets `test.globals: true` — it
// doesn't here, so that import throws "expect is not defined" before any
// test file even loads. '@testing-library/jest-dom/vitest' is jest-dom's
// own vitest-specific entry point: it extends vitest's `expect` via `vi`
// directly, with no globals requirement. Fixes the harness for every test
// file, not just this one.
import '@testing-library/jest-dom/vitest'
