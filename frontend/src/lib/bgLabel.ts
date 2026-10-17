/**
 * Project-qualified label for a bg process, used in confirm dialogs.
 *
 * `name` is only unique within a project (TASK-0196), so two projects can each
 * have a `dev`. A bare name in a destructive-action prompt would be ambiguous;
 * the project is always shown alongside it.
 */
export function bgQualifiedLabel(bg: { name: string; projectName: string }): string {
  return `"${bg.name}" (project ${bg.projectName})`
}
