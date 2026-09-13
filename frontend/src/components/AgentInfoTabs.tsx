import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface AgentInfoTabDef {
  /** Stable identifier, e.g. 'terminal' | 'skills' | 'diff' | 'usage' | 'checkpoints'. */
  id: string
  label: string
  /**
   * Whether this tab appears in the tablist at all. Defaults to true. An absent
   * (per-agent) tab is omitted entirely — never rendered disabled — per TASK-157.
   */
  present?: boolean
  /**
   * Panel content. Every present tab's content is rendered on every render (never
   * conditionally mounted/unmounted) — only the `hidden` attribute toggles which
   * panel is visible. This mirrors LogTail's own Live/History toggle (the xterm
   * container keeps a literal `hidden` class appended/removed rather than being
   * conditionally rendered) so a stateful panel — the Terminal tab's xterm instance
   * chief among them — never gets disposed and recreated by switching tabs.
   */
  content: ReactNode
}

interface AgentInfoTabsProps {
  tabs: AgentInfoTabDef[]
  activeId: string
  onActiveIdChange: (id: string) => void
  /** aria-label for the tablist container. */
  tabListLabel?: string
  className?: string
}

/**
 * Hand-built WAI-ARIA Authoring Practices "Tabs" pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
 *
 * - role="tablist" of role="tab" buttons, each aria-controls-ing its panel and
 *   id-referenced by that panel's aria-labelledby.
 * - Roving tabindex: 0 on the active tab, -1 on the rest.
 * - ArrowLeft/ArrowRight move focus among *visible* tabs, wrapping; Home/End jump
 *   to the first/last visible tab. Automatic activation — moving focus also
 *   selects, matching the cheap, already-mounted panel switch below.
 * - Every tabpanel is always rendered (tabIndex 0 for keyboard/AT safety) with
 *   only the inactive ones marked `hidden`; see AgentInfoTabDef.content.
 */
export default function AgentInfoTabs({ tabs, activeId, onActiveIdChange, tabListLabel = 'Agent detail sections', className }: AgentInfoTabsProps) {
  const uid = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const visibleTabs = tabs.filter((tab) => tab.present !== false)

  // Defensive fallback: if the currently-active id isn't (or is no longer) among
  // the visible tabs — e.g. its mount condition just flipped false — treat the
  // first visible tab as active for rendering purposes so the strip always has
  // exactly one focusable/selected tab and one visible panel. This never calls
  // onActiveIdChange itself; the caller owns resetting real selection state.
  const activeIndex = visibleTabs.findIndex((tab) => tab.id === activeId)
  const effectiveActiveId = activeIndex === -1 ? (visibleTabs[0]?.id ?? activeId) : activeId

  function tabElementId(id: string): string {
    return `${uid}-tab-${id}`
  }

  function panelElementId(id: string): string {
    return `${uid}-panel-${id}`
  }

  function focusAndSelect(index: number) {
    const tab = visibleTabs[index]
    if (!tab) return
    onActiveIdChange(tab.id)
    tabRefs.current[index]?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = visibleTabs.length
    if (count === 0) return
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusAndSelect((index + 1) % count)
        break
      case 'ArrowLeft':
        e.preventDefault()
        focusAndSelect((index - 1 + count) % count)
        break
      case 'Home':
        e.preventDefault()
        focusAndSelect(0)
        break
      case 'End':
        e.preventDefault()
        focusAndSelect(count - 1)
        break
      default:
        break
    }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={tabListLabel} className="flex flex-shrink-0 items-center gap-1 border-b border-line">
        {visibleTabs.map((tab, index) => {
          const selected = tab.id === effectiveActiveId
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[index] = el }}
              role="tab"
              type="button"
              id={tabElementId(tab.id)}
              aria-selected={selected}
              aria-controls={panelElementId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => { onActiveIdChange(tab.id) }}
              onKeyDown={(e) => { handleKeyDown(e, index) }}
              className={`inline-flex h-8 cursor-pointer items-center rounded-t-[7px] px-3 text-[12px] font-medium transition ${selected
                ? 'border-b-2 border-accent-blue text-accent-blue'
                : 'border-b-2 border-transparent text-muted hover:text-ink'}`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {visibleTabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={panelElementId(tab.id)}
          aria-labelledby={tabElementId(tab.id)}
          tabIndex={0}
          className={tab.id === effectiveActiveId ? undefined : 'hidden'}
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
