import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import AgentInfoTabs, { type AgentInfoTabDef } from './AgentInfoTabs'

// Same leak-prevention note as AgentList.test.tsx: this repo's vitest.config doesn't set
// `test.globals: true`, so RTL's auto-cleanup registration never fires — without this, a
// render() from one test leaks into the next within this file.
afterEach(() => { cleanup() })

// Controlled harness: AgentInfoTabs is a controlled component (activeId/onActiveIdChange owned
// by the caller), so a thin stateful wrapper is needed to drive it the way AgentDetailView
// really does.
function Harness({ tabs, initialActiveId, label }: { tabs: AgentInfoTabDef[]; initialActiveId: string; label?: string }) {
  const [activeId, setActiveId] = useState(initialActiveId)
  return <AgentInfoTabs tabs={tabs} activeId={activeId} onActiveIdChange={setActiveId} tabListLabel={label ?? 'Test sections'} />
}

// Four synthetic tabs with one (Charlie) absent, positioned in the middle — this is what lets
// the wrap/skip and Home/End tests prove an absent tab is never a landing target, not just that
// it's missing from the tablist.
function makeTabs(): AgentInfoTabDef[] {
  return [
    { id: 'a', label: 'Alpha', present: true, content: <div data-testid="panel-a">Alpha content</div> },
    { id: 'b', label: 'Bravo', present: true, content: <div data-testid="panel-b">Bravo content</div> },
    { id: 'c', label: 'Charlie', present: false, content: <div data-testid="panel-c">Charlie content</div> },
    { id: 'd', label: 'Delta', present: true, content: <div data-testid="panel-d">Delta content</div> },
  ]
}

describe('AgentInfoTabs (TASK-157)', () => {
  it('omits an absent tab from the tablist entirely — not rendered disabled, not rendered at all', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="a" />)
    const tablist = screen.getByRole('tablist', { name: 'Test sections' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Alpha', 'Bravo', 'Delta'])
    expect(within(tablist).queryByText('Charlie')).toBeNull()
    // The absent tab's panel content is never rendered either (not just visually hidden).
    expect(screen.queryByTestId('panel-c')).toBeNull()
  })

  it('clicking a tab selects it (aria-selected) and swaps which panel is visible', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="a" />)
    const bravoTab = screen.getByRole('tab', { name: 'Bravo' })
    fireEvent.click(bravoTab)

    expect(bravoTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false')

    const bravoPanel = screen.getByRole('tabpanel', { name: 'Bravo' })
    const alphaPanel = screen.getByRole('tabpanel', { name: 'Alpha' })
    expect(bravoPanel.className.split(' ')).not.toContain('hidden')
    expect(alphaPanel.className.split(' ')).toContain('hidden')
  })

  it('uses roving tabindex: only the active tab is focusable (tabIndex 0), the rest are -1', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="b" />)
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Bravo' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Delta' })).toHaveAttribute('tabindex', '-1')
  })

  it('ArrowRight moves selection to the next visible tab, skips the absent tab, and wraps from the last visible tab to the first', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="a" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Bravo' })).toHaveAttribute('aria-selected', 'true')

    // Bravo -> Delta directly: Charlie (present: false) is never a stop along the way.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Bravo' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Delta' })).toHaveAttribute('aria-selected', 'true')

    // Delta is the last visible tab: ArrowRight wraps back to Alpha (not to the absent Charlie).
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Delta' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowLeft wraps from the first visible tab to the last visible tab', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="a" />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Delta' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Home jumps to the first visible tab and End jumps to the last visible tab, from any starting tab', () => {
    render(<Harness tabs={makeTabs()} initialActiveId="b" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Bravo' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Delta' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Delta' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps every present tab mounted at all times: switching tabs never unmounts a panel, only toggles the hidden class', () => {
    const mountSpy = vi.fn()
    const unmountSpy = vi.fn()
    function TrackedContent({ label }: { label: string }) {
      useEffect(() => {
        mountSpy(label)
        return () => { unmountSpy(label) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div>{label} content</div>
    }
    const tabs: AgentInfoTabDef[] = [
      { id: 'a', label: 'Alpha', content: <TrackedContent label="Alpha" /> },
      { id: 'b', label: 'Bravo', content: <TrackedContent label="Bravo" /> },
    ]
    render(<Harness tabs={tabs} initialActiveId="a" />)

    // Both present tabs' content mounts immediately on first render, not lazily on first visit.
    expect(mountSpy).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('tab', { name: 'Bravo' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Bravo' }))

    expect(mountSpy).toHaveBeenCalledTimes(2)
    expect(unmountSpy).not.toHaveBeenCalled()
  })
})
