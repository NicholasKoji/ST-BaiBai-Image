import { describe, expect, it } from 'vitest';
import {
  activePromptPreset, deletePromptPreset, emptyPromptPresetLibrary, exportPromptPreset,
  importPromptPreset, normalizePromptPresetLibrary, renderPromptPreset, savePromptPreset,
  usedPromptMacros, validatePromptPreset, type PromptPreset,
} from './promptPresets';
import { defaultPromptPreset } from './promptPresetDefaults';
import { settings } from './settings';

function sample(): PromptPreset {
  return { id: 'sample', name: '我的预设', backend: 'nai', entries: [
    { id: 'rule', name: '规则', role: 'system', enabled: true, content: '  保留空格\n{{user}}  ' },
    { id: 'body', name: '正文', role: 'user', enabled: true, content: '{{正文}}' },
    { id: 'off', name: '关闭', role: 'assistant', enabled: false, content: '关闭内容' },
  ] };
}

describe('prompt preset management', () => {
  it('round-trips names, roles, order, switches and exact content', () => {
    const source = sample();
    const imported = importPromptPreset(exportPromptPreset(source), 'nai');
    expect(imported.entries).toEqual(source.entries);
    expect(imported.name).toBe(source.name);
    expect(imported.id).not.toBe(source.id);
  });
  it('uses the explicit import purpose instead of the file backend', () => {
    expect(importPromptPreset(exportPromptPreset(sample()), 'comfyui').backend).toBe('comfyui');
  });
  it('assigns independent identities to repeated imports', () => {
    const text = exportPromptPreset(sample());
    expect(importPromptPreset(text, 'nai').id).not.toBe(importPromptPreset(text, 'nai').id);
  });
  it('supports a UTF-8 BOM', () => {
    expect(importPromptPreset('\uFEFF' + exportPromptPreset(sample()), 'nai').name).toBe('我的预设');
  });
  it.each(['{', '[]', '{"prompts":[]}', '{"format":"bbi-prompt-preset","version":2}', '{"entries":[]}'])('rejects invalid or foreign formats, without conversion: %s', text => {
    expect(() => importPromptPreset(text, 'nai')).toThrow();
  });
  it.each([
    { name: '' }, { entries: [] },
    { entries: [{ name: 'bad', role: 'tool', enabled: true, content: 'x' }] },
    { entries: [{ name: 'bad', role: 'system', content: {} }] },
    { entries: [{ name: 'bad', role: 'system', content: 'x', enabled: 'false' }] },
    { entries: [{ name: 'off', role: 'system', content: 'x', enabled: false }] },
  ])('validates edits before changing the library: %j', patch => {
    const library = emptyPromptPresetLibrary();
    expect(() => savePromptPreset(library, { ...sample(), ...patch } as PromptPreset)).toThrow();
    expect(library.presets).toEqual([]);
  });
  it('fills missing entry ids and enabled flags, repairing duplicate ids', () => {
    const value = validatePromptPreset({ name: 'x', entries: [
      { name: 'a', role: 'user', content: 'x' },
      { id: 'same', name: 'b', role: 'system', content: 'x' },
      { id: 'same', name: 'c', role: 'assistant', content: 'x' },
    ] }, 'nai');
    expect(new Set(value.entries.map(e => e.id)).size).toBe(3);
    expect(value.entries.every(e => e.enabled)).toBe(true);
  });
  it('keeps draft and saved entries independent', () => {
    const library = emptyPromptPresetLibrary(), draft = sample();
    savePromptPreset(library, draft);
    draft.entries[0].content = '未保存的修改';
    expect(library.presets[0].entries[0].content).toBe('  保留空格\n{{user}}  ');
  });
  it('stores backend selections independently and clears only the deleted selection', () => {
    const library = emptyPromptPresetLibrary();
    savePromptPreset(library, sample());
    savePromptPreset(library, { ...sample(), id: 'comfy', backend: 'comfyui' });
    library.active = { nai: 'sample', comfyui: 'comfy' };
    expect(activePromptPreset(library, 'nai')?.id).toBe('sample');
    deletePromptPreset(library, 'sample');
    expect(library.active).toEqual({ nai: '', comfyui: 'comfy' });
    expect(activePromptPreset(library, 'nai')).toBeUndefined();
    expect(activePromptPreset(library, 'comfyui')?.id).toBe('comfy');
  });
  it('normalizes stored data, rejecting a cross-backend active id', () => {
    const value = normalizePromptPresetLibrary({ presets: [sample(), { bad: true }], active: { nai: 'sample', comfyui: 'sample' } });
    expect(value.presets).toHaveLength(1);
    expect(value.active).toEqual({ nai: 'sample', comfyui: '' });
    expect(normalizePromptPresetLibrary(null)).toEqual(emptyPromptPresetLibrary());
  });
  it('renders only enabled entries in order and keeps message roles', () => {
    expect(renderPromptPreset(sample(), { user: '玩家', 正文: '原文' })).toEqual([
      { role: 'system', content: '  保留空格\n玩家  ' }, { role: 'user', content: '原文' },
    ]);
    expect(usedPromptMacros(sample())).toEqual(new Set(['user', '正文']));
  });
  it('does not recursively expand context, execute script macros, or access inherited keys', () => {
    const preset = sample(); preset.entries[0].content = '{{正文}} {{setvar::x::y}} {{constructor}}';
    expect(renderPromptPreset(preset, { 正文: '{{user}}' })[0].content).toBe('{{user}} {{setvar::x::y}} {{constructor}}');
  });
  it('does not silently revert an empty enabled preset to old defaults', () => {
    const preset = sample(); preset.entries.forEach(e => e.enabled = false);
    expect(() => renderPromptPreset(preset, {})).toThrow('没有启用');
  });
  it('retains legacy user overrides when exporting the built-in fallback', () => {
    const preset = defaultPromptPreset('nai', { ...settings.autoTag.prompts, naiV5Spec: '旧自定义规范', prefill: '旧预填充' });
    expect(preset.entries.find(e => e.name === '生图规范')?.content).toBe('旧自定义规范');
    expect(preset.entries.at(-1)?.content).toBe('旧预填充');
    expect(importPromptPreset(exportPromptPreset(preset), 'nai').entries).toEqual(preset.entries);
  });
});
