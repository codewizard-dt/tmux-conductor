import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EllipsisVertical } from 'lucide-react'

export interface AgentActionsMenuItem {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
  title?: string
  tone?: 'default' | 'danger' | 'warning'
}

interface AgentActionsMenuProps {
  items: AgentActionsMenuItem[]
}

const TONE_CLASSES: Record<NonNullable<AgentActionsMenuItem['tone']>, string> = {
  default: 'text-ink hover:bg-canvas',
  danger: 'text-accent-red hover:bg-accent-red/5',
  warning: 'text-[#c07a10] hover:bg-[#e0901a]/10',
}

/**
 * Generic accessible actions-menu (kebab / "more") button, following the W3C WAI-ARIA
 * Authoring Practices "Actions Menu Button" pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
 */
export default function AgentActionsMenu({ items }: AgentActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const enabledIndexes = items.reduce<number[]>((acc, item, index) => {
    if (!item.disabled) acc.push(index)
    return acc
  }, [])

  // Click-outside-to-close — attached only while the menu is open.
  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => { document.removeEventListener('mousedown', handleMouseDown) }
  }, [open])

  // Move DOM focus onto whichever item is logically focused whenever the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[focusedIndex]?.focus()
  }, [open, focusedIndex])

  function firstEnabled(): number {
    return enabledIndexes[0] ?? 0
  }

  function lastEnabled(): number {
    return enabledIndexes[enabledIndexes.length - 1] ?? 0
  }

  function nextEnabled(from: number): number {
    if (enabledIndexes.length === 0) return from
    const found = enabledIndexes.find((index) => index > from)
    return found ?? firstEnabled()
  }

  function prevEnabled(from: number): number {
    if (enabledIndexes.length === 0) return from
    let found: number | undefined
    for (const index of enabledIndexes) {
      if (index < from) found = index
    }
    return found ?? lastEnabled()
  }

  function openMenu(focusIndex: number = firstEnabled()) {
    setOpen(true)
    setFocusedIndex(focusIndex)
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function selectItem(index: number) {
    const item = items[index]
    if (!item || item.disabled) return
    closeMenu(true)
    item.onSelect()
  }

  function handleTriggerClick() {
    if (open) closeMenu(false)
    else openMenu()
  }

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu(firstEnabled())
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu(lastEnabled())
    }
  }

  function handleItemKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(nextEnabled(index))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prevEnabled(index))
        break
      case 'Home':
        e.preventDefault()
        setFocusedIndex(firstEnabled())
        break
      case 'End':
        e.preventDefault()
        setFocusedIndex(lastEnabled())
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        closeMenu(true)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        selectItem(index)
        break
      default:
        break
    }
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Agent actions"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-2 transition hover:bg-canvas hover:text-ink"
      >
        <EllipsisVertical size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Agent actions"
          className="absolute right-0 top-full z-20 mt-1 min-w-[168px] rounded-[8px] border border-line bg-card py-1 shadow-pop"
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => { itemRefs.current[index] = el }}
              role="menuitem"
              type="button"
              tabIndex={index === focusedIndex ? 0 : -1}
              disabled={item.disabled}
              title={item.title}
              onClick={() => { selectItem(index) }}
              onKeyDown={(e) => { handleItemKeyDown(e, index) }}
              onMouseEnter={() => { if (!item.disabled) setFocusedIndex(index) }}
              className={`block w-full cursor-pointer whitespace-nowrap px-3 py-1.5 text-left text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${TONE_CLASSES[item.tone ?? 'default']}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
