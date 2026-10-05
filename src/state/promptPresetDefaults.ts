import { newPromptId, type PromptPreset, type PromptPresetBackend } from './promptPresets';
import {
  DEFAULT_JAILBREAK_PROMPT, DEFAULT_COMFY_SPEC, DEFAULT_COMFY_THINKING,
  DEFAULT_NAI_V5_SPEC, DEFAULT_NAI_V5_THINKING, DEFAULT_PREFILL_PROMPT,
  type AutoTagPrompts,
} from './settings';

/** Legacy overrides remain available when editing/exporting the built-in fallback. */
export function defaultPromptPreset(backend: PromptPresetBackend, legacy: AutoTagPrompts): PromptPreset {
  const text = (value: string, fallback: string) => value.trim() ? value : fallback;
  const definitions = [
    ['系统提示', 'system', text(legacy.jailbreak, DEFAULT_JAILBREAK_PROMPT)],
    ['角色设定', 'system', '{{角色设定}}'],
    ['玩家设定', 'system', '{{玩家设定}}'],
    ['世界书', 'system', '{{世界书}}'],
    ['生图规范', 'system', backend === 'nai' ? text(legacy.naiV5Spec, DEFAULT_NAI_V5_SPEC) : text(legacy.comfySpec, DEFAULT_COMFY_SPEC)],
    ['内置任务规则', 'system', '{{内置任务规则}}'],
    ['生成前检查', 'system', backend === 'nai' ? text(legacy.naiV5Thinking, DEFAULT_NAI_V5_THINKING) : text(legacy.comfyThinking, DEFAULT_COMFY_THINKING)],
    ['正文与参考', 'user', '{{上下文}}'],
    ['预填充', 'assistant', text(legacy.prefill, DEFAULT_PREFILL_PROMPT)],
  ] as const;
  return {
    id: newPromptId(), name: `${backend === 'nai' ? 'NAI' : 'ComfyUI'} 自定义`, backend,
    entries: definitions.map(([name, role, content]) => ({ id: newPromptId(), name, role, content, enabled: true })),
  };
}
