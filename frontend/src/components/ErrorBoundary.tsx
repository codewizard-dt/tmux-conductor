import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="rounded-[10px] bg-accent-red/10 px-4 py-3 text-[12px] text-accent-red">
          <p className="m-0 font-semibold">Something went wrong</p>
          <p className="m-0 mt-1 font-mono opacity-80">{this.state.error.message}</p>
          <p className="m-0 mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">tmux window/pane navigation</p>
          <p className="m-0 mt-1 font-mono opacity-80">tmux attach -t conductor</p>
          <p className="m-0 font-mono opacity-80">Ctrl-b n / Ctrl-b p  (next / previous window)</p>
          <p className="m-0 font-mono opacity-80">Ctrl-b 0-9  (jump to window N)</p>
          <p className="m-0 font-mono opacity-80">Ctrl-b w  (list windows, pick one)</p>
          <p className="m-0 font-mono opacity-80">Ctrl-b arrow-key  (switch panes)</p>
          <p className="m-0 font-mono opacity-80">Ctrl-b d  (detach)</p>
        </div>
      )
    }
    return this.props.children
  }
}
