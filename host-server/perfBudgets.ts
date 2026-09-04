/**
 * Live-update performance budgets for dashboard regression checks.
 *
 * Calibrated from a real ~2h baseline capture (TASK-117: 708 samples,
 * 2026-09-02T05:10:04Z - 2026-09-02T07:09:57Z, 5-6 real registered agents with
 * genuine idle/busy/awaiting activity, a connected dashboard client throughout
 * - see the "Captured Baseline" section of wiki/work/tasks/archive/TASK-117-*
 * or wiki/work/tasks/TASK-117-capture-perf-baseline-data.md for the full
 * per-interval percentile breakdown). maxStatusTickMs/maxTerminalTickMs/
 * maxFocusedTerminalTickMs are each set at ceil(p95 * 1.5) rounded to a clean
 * number (TASK-118), comfortably clearing the captured p99 for each: p95/p99
 * were 69.5/74.1ms (status), 24.1/26.0ms (terminal), 5.7/5.9ms (focused
 * terminal). maxCaptureCallsPerAgentPerStatusInterval and
 * maxDashboardSseConnections are structural invariants that held throughout
 * the entire captured window (never exceeded 1), so they're left as the
 * documented invariant rather than recalibrated. Recalibrate by re-running
 * `scripts/capture-perf-baseline.sh` for a fresh baseline if the tmux/machine
 * workload profile changes materially.
 */
export const LIVE_UPDATE_PERF_BUDGETS = {
  maxStatusTickMs: 150,
  maxTerminalTickMs: 50,
  maxFocusedTerminalTickMs: 15,
  maxCaptureCallsPerAgentPerStatusInterval: 1,
  maxDashboardSseConnections: 1,
} as const;

export type LiveUpdatePerfBudgets = typeof LIVE_UPDATE_PERF_BUDGETS;
