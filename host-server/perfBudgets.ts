/**
 * Live-update performance budgets for dashboard regression checks.
 *
 * These are intentionally conservative until a representative local baseline is
 * captured with `scripts/measure-dashboard-performance.sh`. They protect against
 * obvious regressions without depending on an exact machine or tmux workload.
 */
export const LIVE_UPDATE_PERF_BUDGETS = {
  maxStatusTickMs: 1500,
  maxTerminalTickMs: 1500,
  maxFocusedTerminalTickMs: 150,
  maxCaptureCallsPerAgentPerStatusInterval: 1,
  maxDashboardSseConnections: 1,
} as const;

export type LiveUpdatePerfBudgets = typeof LIVE_UPDATE_PERF_BUDGETS;
