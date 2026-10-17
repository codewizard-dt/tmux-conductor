---
topic: when the sidebar is minimzied, but then it gains a "hover", it should expand
slug: sidebar-hover-expand
researched: 2026-09-20
---

# Primary Sources — Sidebar Hover-to-Expand When Minimized

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentSidebar` (lines 1725-1789) | 2026-09-20 | Fixed-width `<aside>` (`style={{ width: SIDEBAR_WIDTH_PX }}`), no collapsed prop or toggle; contains filter, `InactiveAgentsPanel`, project groups |
| S2 | codebase | `frontend/src/components/AgentList.tsx::AgentList` (lines 1791-2204) | 2026-09-20 | Flex layout: sidebar is a flex sibling of the detail pane; selection state `expandedAgent`; `AgentSidebar` receives `selectedAgentId`/`onExpand` |
| S3 | codebase | `frontend/src/lib/layoutConstants.ts::SIDEBAR_WIDTH_PX` + `find_referencing_symbols` | 2026-09-20 | `SIDEBAR_WIDTH_PX = 320`; consumers are `AgentSidebar`, `terminalSizeProbe`, `AgentList.test.tsx`, `terminalSizeProbe.test.ts` |
| S4 | codebase | `frontend/src/lib/terminalSizeProbe.ts::getProbeMount`, `probeAndSyncTerminalSize`, `registerResizeListener` | 2026-09-20 | Probe positioned at `left: SIDEBAR_WIDTH_PX`; re-probe only on window `resize` (400 ms debounce); pushes cols/rows via `syncTerminalSize` |
| S5 | codebase | `frontend/src/components/LogTail.tsx` (line 386, `useEffect` callback) | 2026-09-20 | `ResizeObserver` on `xtermContainerRef` refits the local xterm on container width change |
| S6 | codebase | `frontend/src/components/AgentList.tsx::AgentItem` (lines 1172-1247) | 2026-09-20 | Full-size `role="button"` card with `borderRightColor: getStatusColor(status)`; no compact variant |
| S7 | codebase | `frontend/package.json` | 2026-09-20 | react ^19.2.7, tailwindcss ^3.4.17, vite ^6.3.5, vitest ^4.1.10, @testing-library/react ^16.3.2; no animation/headless-UI lib |
| S8 | codebase | `raw/research/agents-page-sidebar-layout/index.md` (+ symbol/text search of `wiki/`, `raw/`, `.docs/` for minimize/rail/hover) | 2026-09-20 | Prior sidebar-layout research does not mention a minimized state; no tracked doc plans one |
| S9 | context7 | `/websites/v3_tailwindcss` — "group-hover and focus-within variants, motion-reduce, hoverOnlyWhenSupported future flag" | 2026-09-20 | `motion-reduce` / `motion-safe` variants for reduced-motion (`motion-reduce:transition-none`); query did not return `group-hover`/`hoverOnlyWhenSupported` details |
| S10 | web | https://github.com/chatwoot/chatwoot/issues/15710 | 2026-09-20 | Hover-expand overlays without shifting content, short collapse delay, pin persists, Esc dismiss, not hover-only |
| S11 | web | https://codefronts.com/navigation/css-side-menu/ | 2026-09-20 | Touch caveat for `:hover`; `:has(:focus-within)` opens rail on keyboard focus |
| S12 | web | https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html | 2026-09-20 | WCAG 1.4.13 — need an Esc-style dismiss for hover-revealed content that covers page content |
| S13 | web | https://ui.aceternity.com/sidebar | 2026-09-20 | Collapsed rails must not leave hidden links in tab order; toggle exposes `aria-expanded`; accessible names required |
| S14 | web | https://css-tricks.com/dropdown-menus-with-more-forgiving-mouse-movement-paths/ | 2026-09-20 | "Hover intent" and "unhover intent" delays |
| S15 | web | https://stackoverflow.com/questions/60396808/hovering-browser-elements-breaks-hover-functionality-on-expand-collapse-sidebar | 2026-09-20 | `mouseenter`/`mouseleave` vs `mouseover`/`mouseout` for expand/collapse sidebars |
| S16 | web | https://www.shadcn-svelte.com/docs/components/sidebar | 2026-09-20 | Icon-collapse mode with fixed icon width constant, keyboard shortcut `b`, persisted state |
| S17 | web | https://uipotion.com/potions/components/sidebar-navigation | 2026-09-20 | Hover expand is an optional mode over a collapsed sidebar; collapsed state saved to localStorage |

## Excerpts

### S10 — Desktop sidebar hover expansion with pin/collapse control · Issue #15710 · chatwoot/chatwoot
https://github.com/chatwoot/chatwoot/issues/15710
> Hovering over the rail expands the full sidebar over the page, without shifting conversation content. Moving away collapses the preview after a short delay. Moving into a menu opened from the sidebar should keep it usable. Add a visible control near the top to pin the sidebar open or collapse it. Pinning reserves space in the layout and persists the user's preference. Preserve existing explicit sidebar preferences. Provide a keyboard-accessible open/pin control and Escape to dismiss a temporary preview; navigation must not depend exclusively on hover.

### S11 — 17 CSS Side Menu Designs — CodeFronts
https://codefronts.com/navigation/css-side-menu/
> Touch caveat: :hover doesn't fire on touchscreens, so add a @media (hover: hover) guard and provide a click-toggle fallback for mobile (the checkbox-hack from Demo #01 works as the fallback). Modern alternative: :has(:focus-within) opens the rail on keyboard focus, making it accessible without a separate toggle button

### S12 — Understanding Success Criterion 1.4.13: Content on Hover or Focus | WAI | W3C
https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html
> it's important to provide a way for users to dismiss any additional content without the need to move their mouse or keyboard focus, such as pressing the Esc key.

### S13 — Collapsible Sidebar Components for Dashboards - Aceternity UI
https://ui.aceternity.com/sidebar
> Tab through the whole rail and confirm the focus ring is visible against your background, that collapsed groups do not leave hidden links in the tab order, and that the collapse toggle exposes aria-expanded.

### S14 — Dropdown Menus with More Forgiving Mouse Movement Paths | CSS-Tricks
https://css-tricks.com/dropdown-menus-with-more-forgiving-mouse-movement-paths/
> Have you heard of “hover intent”? It’s this concept where you don’t trigger a response right away to mouse location events. You wait a split second, that way you can be sure the user wanted a reaction.
>
> The opposite of that we could call unhover intent. Like we react to a hover event immediately, but don’t react to a hover off for a little bit.

### S15 — Hovering browser elements breaks hover functionality on expand/collapse sidebar (Stack Overflow)
https://stackoverflow.com/questions/60396808/hovering-browser-elements-breaks-hover-functionality-on-expand-collapse-sidebar
> Check the test I made below: when you use mouseover and mouseout, it will generate the problem you mentioned but when you change the events for mouseenter and mouseleave, it works fine

### S16 — Sidebar - shadcn-svelte
https://www.shadcn-svelte.com/docs/components/sidebar
> export const SIDEBAR_COOKIE_NAME = "sidebar_state"; export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; export const SIDEBAR_WIDTH = "16rem"; export const SIDEBAR_WIDTH_MOBILE = "18rem"; export const SIDEBAR_WIDTH_ICON = "3rem"; export const SIDEBAR_KEYBOARD_SHORTCUT = "b";

### S17 — Sidebar Navigation - UI Potion
https://uipotion.com/potions/components/sidebar-navigation
> Collapsed mode: Icons only, labels hidden, tooltips appear on hover/focus · Hover expand (optional): Mouse hover over collapsed sidebar temporarily expands it; mouse leave collapses it · Persistence: Collapsed state saved to localStorage, restored on mount

### S9 — Tailwind CSS v3 docs (Context7 `/websites/v3_tailwindcss`)
Source cited by Context7: https://v3.tailwindcss.com/docs/transition-property
> For situations where the user has specified that they prefer reduced motion, you can conditionally apply animations and transitions using the `motion-safe` and `motion-reduce` variants.

### S5 — LogTail.tsx (codebase excerpt)
`frontend/src/components/LogTail.tsx:386`
> const ro = new ResizeObserver(() => { if (termRef.current && fitAddonRef.current) fitWithRightEdgeMargin(termRef.current, fitAddonRef.current) })

### S4 — terminalSizeProbe.ts (codebase excerpt)
`frontend/src/lib/terminalSizeProbe.ts::getProbeMount`
> outer.style.left = `${SIDEBAR_WIDTH_PX.toString()}px`
