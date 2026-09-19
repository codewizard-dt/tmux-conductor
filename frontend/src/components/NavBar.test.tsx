import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// AddAgentForm (mounted by NavBar on demand) fetches the project list on mount; mock the
// API module so no real network runs, following AddAgentForm.test.tsx.
vi.mock('../lib/api', () => ({
  API_BASE: 'http://localhost:8788/api',
  listProjects: vi.fn(),
  spawnAgentInProject: vi.fn(),
  createProject: vi.fn(),
}))

import { listProjects } from '../lib/api'
import NavBar from './NavBar'

// NavBar reads/writes `document.documentElement.classList` and `localStorage`
// directly (TASK-122's dark-mode toggle), so each test must reset both —
// otherwise state leaks between tests the way vitest.setup.ts warns about
// for repeated-text renders in ConfirmDialog.test.tsx.
afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
  localStorage.clear()
  vi.clearAllMocks()
})

function renderNavBar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NavBar />
    </MemoryRouter>,
  )
}

describe('NavBar theme toggle', () => {
  it('defaults to light mode (moon icon, "Switch to dark mode" label) when <html> has no dark class', () => {
    renderNavBar()

    const button = screen.getByRole('button', { name: 'Switch to dark mode' })
    expect(button).toHaveTextContent('🌙')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('syncs initial state to a "dark" class already applied to <html> (simulates the pre-paint bootstrap script in index.html)', () => {
    document.documentElement.classList.add('dark')

    renderNavBar()

    const button = screen.getByRole('button', { name: 'Switch to light mode' })
    expect(button).toHaveTextContent('☀️')
  })

  it('clicking the toggle adds the dark class to <html> and flips the button label/icon — no reload required', () => {
    renderNavBar()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveTextContent('☀️')
  })

  it('clicking the toggle persists the choice to localStorage under the "theme" key', () => {
    renderNavBar()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(localStorage.getItem('theme')).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('clicking twice returns both the DOM class and localStorage to the original light state', () => {
    renderNavBar()

    const firstClick = screen.getByRole('button', { name: 'Switch to dark mode' })
    fireEvent.click(firstClick)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('does not throw and still toggles the DOM class when localStorage.setItem throws (private-browsing style failure)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('setItem disabled')
    })

    renderNavBar()

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    }).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    setItemSpy.mockRestore()
  })
})

describe('NavBar Add Agent trigger', () => {
  it.each(['/', '/projects', '/history'])('renders a "+ Add Agent" button in the header on %s', (path) => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar(path)

    expect(screen.getByRole('button', { name: '+ Add Agent' })).toBeInTheDocument()
    // The modal is conditionally mounted, so nothing is fetched until it is opened.
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('clicking the trigger opens the Add Agent dialog (and fetches the project list fresh)', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    expect(screen.queryByLabelText('Working Directory')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Agent' }))

    expect(screen.getByText('Add Agent')).toBeInTheDocument()
    expect(screen.getByLabelText('Working Directory')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spawn Agent' })).toBeInTheDocument()
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })
  })

  it('Escape closes the dialog and unmounts the form; reopening refetches projects', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Agent' }))
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Working Directory')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Agent' }))
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(2) })
  })

  it('renders the "+ Add Background Process" trigger right after "+ Add Agent" in the same cluster', () => {
    renderNavBar()

    const addAgent = screen.getByRole('button', { name: '+ Add Agent' })
    const addBg = screen.getByRole('button', { name: '+ Add Background Process' })
    expect(addBg.parentElement).toBe(addAgent.parentElement)
    expect(addAgent.nextElementSibling).toBe(addBg)
  })

  it('places the trigger and the theme toggle in a right-aligned cluster, and the toggle still works', () => {
    renderNavBar()

    const trigger = screen.getByRole('button', { name: '+ Add Agent' })
    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' })
    expect(trigger.parentElement).toBe(toggle.parentElement)
    expect(trigger.parentElement).toHaveClass('ml-auto')
    expect(toggle).not.toHaveClass('ml-auto')

    fireEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('NavBar Add Background Process trigger', () => {
  beforeEach(() => {
    // AddBgProcessForm fetches /status (agent list) on mount.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ agents: [] }), { status: 200 }))))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clicking the trigger opens the Add Background Process dialog (and fetches the project list fresh)', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    expect(screen.queryByRole('button', { name: 'Spawn Process' })).not.toBeInTheDocument()
    expect(listProjects).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Background Process' }))

    expect(screen.getByText('Add Background Process')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spawn Process' })).toBeInTheDocument()
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })
  })

  it('Escape closes the dialog and unmounts the form', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Background Process' }))
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Spawn Process' })).not.toBeInTheDocument()
  })

  it('a backdrop click closes and unmounts the dialog, but a click inside the card does not', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Background Process' }))
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByText('Add Background Process'))
    expect(screen.getByRole('button', { name: 'Spawn Process' })).toBeInTheDocument()

    const backdrop = screen.getByText('Add Background Process').closest('.fixed') as HTMLElement
    fireEvent.click(backdrop)

    expect(screen.queryByRole('button', { name: 'Spawn Process' })).not.toBeInTheDocument()
  })

  it('the ✕ Close button closes and unmounts the dialog', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Background Process' }))
    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('button', { name: 'Spawn Process' })).not.toBeInTheDocument()
  })

  it('both triggers open their own dialog independently', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    renderNavBar()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Agent' }))
    expect(screen.getByRole('button', { name: 'Spawn Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Spawn Process' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Spawn Agent' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Add Background Process' }))
    expect(screen.getByRole('button', { name: 'Spawn Process' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Spawn Agent' })).not.toBeInTheDocument()

    await waitFor(() => { expect(listProjects).toHaveBeenCalledTimes(2) })
  })
})
