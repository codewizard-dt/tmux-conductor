# Dashboard Live-Update Performance Budgets

Source tasks: [[TASK-073]], [[TASK-074]]

The dashboard performance budget starts conservative because local tmux workload, terminal size, and active agent count materially affect capture cost. Use `scripts/measure-dashboard-performance.sh` to capture a representative baseline before tightening values.

## Budgets

| Budget | Value | Rationale |
|---|---:|---|
| Status tick max duration | 1500 ms | Must finish comfortably inside the 2000 ms status poll interval. |
| Unfocused terminal tick max duration | 1500 ms | Must finish comfortably inside the 2000 ms terminal poll interval. |
| Focused terminal tick max duration | 150 ms | Focused polling runs every 200 ms, so slow ticks need to back off before starving HTTP work. |
| Capture calls per agent per status interval | 1 | Status and mode detection should share the same plain capture snapshot. |
| Dashboard SSE connections | 1 | The frontend should share one EventSource across dashboard subscribers. |

Machine-readable values live in `host-server/perfBudgets.ts`.

## Measurement Command

```bash
HOST_URL=http://localhost:8788/api DURATION_SECONDS=30 bash scripts/measure-dashboard-performance.sh
```

Record agent count, focused terminal state, terminal dimensions, browser tabs, and whether the dashboard was open when comparing runs.

## Revising Budgets

1. Capture a clean baseline with the command above.
2. Repeat after the optimization under review.
3. Tighten a budget only when the lower value is stable across repeated local runs.
4. Keep the exported constants and this document in sync.
