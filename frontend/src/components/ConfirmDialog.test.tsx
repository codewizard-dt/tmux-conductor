import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ConfirmDialog from './ConfirmDialog'

// This suite renders the dialog repeatedly with repeated text (e.g. "Are you
// sure?") across tests; without unmounting, later `screen` queries would
// match leftover nodes from earlier renders and throw "multiple elements
// found". vitest.setup.ts doesn't register RTL's auto-cleanup (it requires
// `test.globals: true`, which this repo doesn't set), so clean up explicitly.
afterEach(() => {
  cleanup()
})

describe('ConfirmDialog', () => {
  it('renders the message/title/labels when open', () => {
    render(
      <ConfirmDialog
        open
        title="Remove agent"
        message="Are you sure you want to remove this agent?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('Remove agent')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to remove this agent?')).toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('clicking the confirm button calls onConfirm exactly once and does not call onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('Remove'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(0)
  })

  it('clicking the cancel button calls onCancel exactly once and does not call onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('Cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(0)
  })

  it('pressing Escape calls onCancel and does not call onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(0)
  })

  it('does not attach the Escape listener when closed (no onCancel call on Escape)', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open={false}
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(0)
    expect(onConfirm).toHaveBeenCalledTimes(0)
  })

  it('clicking the overlay backdrop calls onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog
        open
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    const overlay = container.firstChild as HTMLElement
    fireEvent.click(overlay)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(0)
  })

  it('clicking inside the card does not call onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Remove agent"
        message="Are you sure?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('Are you sure?'))

    expect(onCancel).toHaveBeenCalledTimes(0)
    expect(onConfirm).toHaveBeenCalledTimes(0)
  })

describe('window.confirm elimination — UAT-123 regression guard', () => {
  it('no file under frontend/src still calls window.confirm', () => {
    // Repo-wide static check: TASK-123 migrated all 6 known call sites to ConfirmDialog.
    // This guards against a regression (a copy-pasted revert, a new call site that skips
    // the shared component) reintroducing the native dialog anywhere under src/.
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8')
          if (/window\.confirm/.test(content)) offenders.push(full)
        }
      }
    }
    walk(srcDir)

    expect(offenders).toEqual([])
  })
})
})
