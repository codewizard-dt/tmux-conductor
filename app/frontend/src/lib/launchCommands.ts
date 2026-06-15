export const LAUNCH_COMMAND_PRESETS = [
  {
    id: 'claude',
    label: 'Claude',
    command: 'claude --dangerously-skip-permissions',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex --dangerously-bypass-approvals-and-sandbox',
  },
] as const;

export type LaunchCommandPresetId = (typeof LAUNCH_COMMAND_PRESETS)[number]['id'];
export type LaunchCommandSelection = LaunchCommandPresetId | 'custom';

export const DEFAULT_LAUNCH_COMMAND = LAUNCH_COMMAND_PRESETS[0].command;

export function presetForCommand(command: string): LaunchCommandSelection {
  return LAUNCH_COMMAND_PRESETS.find((preset) => preset.command === command)?.id ?? 'custom';
}

export function commandForPreset(presetId: LaunchCommandPresetId): string {
  return LAUNCH_COMMAND_PRESETS.find((preset) => preset.id === presetId)?.command ?? DEFAULT_LAUNCH_COMMAND;
}
