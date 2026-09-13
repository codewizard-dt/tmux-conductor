import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AgentActionsMenu, { type AgentActionsMenuItem } from './AgentActionsMenu'

// vitest.setup.ts doesn't register RTL's auto-cleanup (see ConfirmDialog.test.tsx's
// note — it requires `test.globals: true`, which this repo doesn't set), so clean
// up explicitly to avoid duplicate-node "multiple elements found" failures across tests.
afterEach(() => {
  cleanup()
})

function makeItems(overrides?: Partial<Record<'a' | 'b' | 'c', Partial<AgentActionsMenuItem>>>): {
  items: AgentActionsMenuItem[]
  onSelectA: ReturnType<typeof vi.fn>
  onSelectB: ReturnType<typeof vi.fn>
  onSelectC: ReturnType<typeof vi.fn>
} {
  const onSelectA = vi.fn()
  const onSelectB = vi.fn()
  const onSelectC = vi.fn()
  const items: AgentActionsMenuItem[] = [
    { key: 'a', label: 'Item A', onSelect: onSelectA, ...overrides?.a },
    { key: 'b', label: 'Item B', onSelect: onSelectB, ...overrides?.b },
    { key: 'c', label: 'Item C', onSelect: onSelectC, ...overrides?.c },
  ]
  return { items, onSelectA, onSelectB, onSelectC }
}

describe('AgentActionsMenu', () => {
  it('renders a closed trigger with WAI-ARIA menu-button attributes and no menu panel', () => {
    const { items } = makeItems()
    render(<AgentActionsMenu items={items} />)

    const trigger = screen.getByRole('button', { name: 'Agent actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clicking the trigger opens the menu, renders each item as a menuitem, and focuses the first enabled item', () => {
    const { items } = makeItems()
    render(<AgentActionsMenu items={items} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent actions' }))

    expect(screen.getByRole('button', { name: 'Agent actions' })).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Agent actions' })
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems.map((el) => el.textContent)).toEqual(['Item A', 'Item B', 'Item C'])
    expect(menu).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toHaveTextContent('Item A')
  })

  it('opening via Enter on the trigger skips a disabled first item and focuses the first enabled one', () => {
    const { items } = makeItems({ a: { disabled: true } })
    render(<AgentActionsMenu items={items} />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Agent actions' }), { key: 'Enter' })

    expect(document.activeElement).toHaveTextContent('Item B')
  })

  it('ArrowDown/ArrowUp move roving focus between enabled items, wrapping and skipping a disabled item', () => {
    const { items } = makeItems({ b: { disabled: true } })
    render(<AgentActionsMenu items={items} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent actions' }))
    expect(document.activeElement).toHaveTextContent('Item A')

    // ArrowDown from A skips disabled B, lands on C.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Item C')

    // ArrowDown from the last enabled item wraps back to A.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Item A')

    // ArrowUp from the first enabled item wraps to the last enabled item (C, skipping disabled B).
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toHaveTextContent('Item C')
  })

  it('Escape closes the menu, stops propagation to an ancestor keydown handler, and returns focus to the trigger', () => {
    const { items } = makeItems()
    const ancestorKeyDown = vi.fn()
    render(
      <div onKeyDown={ancestorKeyDown}>
        <AgentActionsMenu items={items} />
      </div>,
    )

    const trigger = screen.getByRole('button', { name: 'Agent actions' })
    fireEvent.click(trigger)
    expect(document.activeElement).toHaveTextContent('Item A')

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger)
    expect(ancestorKeyDown).not.toHaveBeenCalled()
  })

  it('clicking outside the menu closes it', () => {
    const { items } = makeItems()
    render(
      <div>
        <div data-testid="outside">outside</div>
        <AgentActionsMenu items={items} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agent actions' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('selecting an enabled item (click) calls its onSelect exactly once, closes the menu, and returns focus to the trigger', () => {
    const { items, onSelectB } = makeItems()
    render(<AgentActionsMenu items={items} />)

    const trigger = screen.getByRole('button', { name: 'Agent actions' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Item B' }))

    expect(onSelectB).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('a disabled item is rendered with the disabled attribute and is not part of the roving-tabindex focus order', () => {
    const { items } = makeItems({ b: { disabled: true } })
    render(<AgentActionsMenu items={items} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent actions' }))

    const disabledItem = screen.getByRole('menuitem', { name: 'Item B' })
    expect(disabledItem).toBeDisabled()
    expect(disabledItem).toHaveAttribute('tabIndex', '-1')
  })
})
