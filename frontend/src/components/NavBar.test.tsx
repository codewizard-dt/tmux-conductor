import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from './NavBar'

// NavBar reads/writes `document.documentElement.classList` and `localStorage`
// directly (TASK-122's dark-mode toggle), so each test must reset both —
// otherwise state leaks between tests the way vitest.setup.ts warns about
// for repeated-text renders in ConfirmDialog.test.tsx.
afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
  localStorage.clear()
})

function renderNavBar() {
  return render(
    <MemoryRouter>
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
