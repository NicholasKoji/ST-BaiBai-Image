/** One portable format. Preset preparation/conversion happens outside this plugin. */
export type PromptPresetBackend = 'nai' | 'comfyui';
export type PromptRole = 'system' | 'user' | 'assistant';

export interface PromptPresetEntry {
  id: string;
  name: string;
  role: PromptRole;
  enabled: boolean;
  content: string;
}

export interface PromptPreset {
  id: string;
  name: string;
  backend: PromptPresetBackend;
  entries: PromptPresetEntry[];
}

export interface PromptPresetLibrary {
  presets: PromptPreset[];
  active: Record<PromptPresetBackend, string>;
}

export const PRESET_FORMAT = 'bbi-prompt-preset';
export const PRESET_VERSION = 1;

let sequence = 0;
export function newPromptId(): string {
  return `pp_${Date.now()}_${++sequence}`;
}

export function emptyPromptPresetLibrary(): PromptPresetLibrary {
  return { presets: [], active: { nai: '', comfyui: '' } };
}

export function newPromptEntry(name = '新条目'): PromptPresetEntry {
  return { id: newPromptId(), name, role: 'system', enabled: true, content: '' };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('预设必须是 JSON 对象');
  return value as Record<string, unknown>;
}

export function validatePromptPreset(value: unknown, backend: PromptPresetBackend): PromptPreset {
  const data = object(value);
  if (typeof data.name !== 'string' || !data.name.trim()) throw new Error('请填写预设名称');
  if (!Array.isArray(data.entries) || !data.entries.length) throw new Error('预设至少需要一个条目');
  const ids = new Set<string>();
  const entries = data.entries.map((value, index): PromptPresetEntry => {
    const entry = object(value);
    const label = `第 ${index + 1} 个条目`;
    if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`${label}缺少名称`);
    if (typeof entry.content !== 'string') throw new Error(`${label}的 content 必须是文本`);
    if (!['system', 'user', 'assistant'].includes(String(entry.role))) throw new Error(`${label}的 role 应为 system、user 或 assistant`);
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new Error(`${label}的 enabled 必须是 true 或 false`);
    let id = typeof entry.id === 'string' && entry.id ? entry.id : newPromptId();
    if (ids.has(id)) id = newPromptId();
    ids.add(id);
    return { id, name: entry.name.trim(), content: entry.content, role: entry.role as PromptRole, enabled: entry.enabled !== false };
  });
  if (!entries.some(entry => entry.enabled && entry.content.trim())) throw new Error('请至少启用一个有内容的条目');
  return { id: typeof data.id === 'string' && data.id ? data.id : newPromptId(), name: data.name.trim(), backend, entries };
}

/** The chosen backend wins; importing never reuses another preset's identity. */
export function importPromptPreset(text: string, backend: PromptPresetBackend): PromptPreset {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON 格式有误，请检查文件'); }
  const data = object(value);
  if (data.format !== PRESET_FORMAT || data.version !== PRESET_VERSION) {
    throw new Error('请使用柏宝绘预设格式（format: bbi-prompt-preset，version: 1），可先导出内置预设作为模板');
  }
  const preset = validatePromptPreset(data, backend);
  preset.id = newPromptId();
  return preset;
}

export function exportPromptPreset(preset: PromptPreset): string {
  const valid = validatePromptPreset(preset, preset.backend);
  return JSON.stringify({ format: PRESET_FORMAT, version: PRESET_VERSION, name: valid.name, backend: valid.backend, entries: valid.entries }, null, 2);
}

/** Persisted settings only; this is not an importer for other plugins' formats. */
export function normalizePromptPresetLibrary(value: unknown): PromptPresetLibrary {
  const result = emptyPromptPresetLibrary();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const data = value as Partial<PromptPresetLibrary>;
  for (const raw of Array.isArray(data.presets) ? data.presets : []) {
    if (raw?.backend !== 'nai' && raw?.backend !== 'comfyui') continue;
    try {
      const preset = validatePromptPreset(raw, raw.backend);
      if (result.presets.some(p => p.id === preset.id)) preset.id = newPromptId();
      result.presets.push(preset);
    } catch { /* A corrupt record should not block unrelated settings. */ }
  }
  for (const backend of ['nai', 'comfyui'] as const) {
    const id = data.active?.[backend];
    if (result.presets.some(p => p.id === id && p.backend === backend)) result.active[backend] = id!;
  }
  return result;
}

export function activePromptPreset(library: PromptPresetLibrary | undefined, backend: PromptPresetBackend): PromptPreset | undefined {
  return library?.presets.find(p => p.id === library.active[backend] && p.backend === backend);
}

export function savePromptPreset(library: PromptPresetLibrary, draft: PromptPreset): PromptPreset {
  const saved = validatePromptPreset(draft, draft.backend);
  const index = library.presets.findIndex(p => p.id === saved.id);
  if (index >= 0) library.presets[index] = saved;
  else library.presets.push(saved);
  return saved;
}

export function deletePromptPreset(library: PromptPresetLibrary, id: string): void {
  library.presets = library.presets.filter(p => p.id !== id);
  for (const backend of ['nai', 'comfyui'] as const) if (library.active[backend] === id) library.active[backend] = '';
}

/** Single-pass substitutions: story text and imported content are never evaluated as code. */
export function renderPromptPreset(preset: PromptPreset, macros: Record<string, string>): { role: PromptRole; content: string }[] {
  const messages = preset.entries.filter(entry => entry.enabled).map(entry => ({
    role: entry.role,
    content: entry.content.replace(/\{\{([^{}]+)\}\}/g, (token, key: string) =>
      Object.prototype.hasOwnProperty.call(macros, key) ? macros[key] : token),
  })).filter(message => message.content.trim());
  if (!messages.length) throw new Error(`预设「${preset.name}」没有启用且有内容的条目`);
  return messages;
}

export function usedPromptMacros(preset: PromptPreset): Set<string> {
  return new Set(preset.entries.filter(e => e.enabled).flatMap(e => [...e.content.matchAll(/\{\{([^{}]+)\}\}/g)].map(m => m[1])));
}
