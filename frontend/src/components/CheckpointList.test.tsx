import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mocks the API module so no real network/fetch is involved — CheckpointList
// fetches on mount, and this test needs full control over that response to
// reach the Rollback button deterministically.
vi.mock('../lib/api', () => ({
  fetchAgentCheckpoints: vi.fn(),
  rollbackAgent: vi.fn(),
}))

import { fetchAgentCheckpoints } from '../lib/api'
import CheckpointList from './CheckpointList'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CheckpointList rollback confirmation — UAT-123 highest-stakes call site', () => {
  it('warns that uncommitted work will be overwritten when the Rollback confirmation dialog opens', async () => {
    // TASK-123 migrated this call site from window.confirm to ConfirmDialog, preserving the
    // exact original warning text (CheckpointList.tsx:126). This pins that substance at the
    // rendered-DOM level — not just as a source-text grep — so a future refactor that softens
    // or drops the "will overwrite uncommitted work" warning fails a real test, not just review.
    vi.mocked(fetchAgentCheckpoints).mockResolvedValue({
      checkpoints: [{ id: 1, agentId: 42, ts: Date.now(), stashRef: 'abc123', createdAt: Date.now() }],
    })

    render(<CheckpointList agentId={42} />)

    const rollbackButton = await screen.findByRole('button', { name: 'Rollback' })
    fireEvent.click(rollbackButton)

    await waitFor(() => {
      expect(screen.getByText(/will overwrite uncommitted work in the worktree/i)).toBeInTheDocument()
    })
  })
})

describe('CheckpointList relative timestamp — BUG-0003 regression', () => {
  it('renders the checkpoint age from a millisecond `ts`, not a thousand-fold-inflated one', async () => {
    // agent_checkpoints.ts is stored and returned in milliseconds (see host-server/db.ts
    // insertCheckpoint/Date.now()). formatRelativeTimestamp previously multiplied `ts` by
    // 1000 as if it were seconds, inflating the computed delta so every checkpoint's age
    // clamped back down to "just now" regardless of real elapsed time.
    const twoMinutesAgoMs = Date.now() - 2 * 60 * 1000
    vi.mocked(fetchAgentCheckpoints).mockResolvedValue({
      checkpoints: [{ id: 1, agentId: 42, ts: twoMinutesAgoMs, stashRef: 'abc123', createdAt: twoMinutesAgoMs }],
    })

    render(<CheckpointList agentId={42} />)

    await waitFor(() => {
      expect(screen.getByText('2m ago')).toBeInTheDocument()
    })
  })
})
