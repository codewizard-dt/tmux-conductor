// The bare '@testing-library/jest-dom' entry extends a global `expect`,
// which only exists when vitest.config.ts sets `test.globals: true` — it
// doesn't here, so that import throws "expect is not defined" before any
// test file even loads. '@testing-library/jest-dom/vitest' is jest-dom's
// own vitest-specific entry point: it extends vitest's `expect` via `vi`
// directly, with no globals requirement. Fixes the harness for every test
// file, not just this one.
import '@testing-library/jest-dom/vitest'

// Node >=22's own `globalThis.localStorage` accessor (unusable without the
// unset `--localstorage-file` flag) is already present on the test global
// before vitest's jsdom environment runs. vitest's populateGlobal() only
// copies a jsdom window key onto the test global when that key is *not*
// already present on global, or when it's on an explicit allowlist that
// "localStorage" isn't part of — so it leaves Node's broken accessor in
// place instead of wiring up jsdom's real, working implementation. The
// underlying jsdom Window instance is still reachable via `globalThis.jsdom`
// (vitest's jsdom environment stashes it there), so pull the *real*
// localStorage from there instead of the shadowed `window.localStorage`.
const realJsdomWindow = (globalThis as { jsdom?: { window?: Window } }).jsdom?.window
if (realJsdomWindow?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: realJsdomWindow.localStorage,
    configurable: true,
    writable: true,
  })
}
if (realJsdomWindow?.sessionStorage) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: realJsdomWindow.sessionStorage,
    configurable: true,
    writable: true,
  })
}
