import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const mocks = vi.hoisted(() => ({ context: null as Record<string, any> | null }));
vi.mock('@/st/context', () => ({ getContext: () => mocks.context }));

describe('prompt preset settings persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  });
  it('preserves legacy prompt fields and starts with no selected custom preset', async () => {
    mocks.context = { extensionSettings: { baibai_image: { autoTag: { prompts: { naiV5Spec: '旧内容' } } } }, saveSettingsDebounced: vi.fn() };
    const { hydrateSettings, settings } = await import('./settings');
    await hydrateSettings();
    expect(settings.autoTag.prompts.naiV5Spec).toBe('旧内容');
    expect(settings.autoTag.presetLibrary).toEqual({ presets: [], active: { nai: '', comfyui: '' } });
  });
  it('hydrates and persists a preset through the existing server settings store', async () => {
    const library = { presets: [{ id: 'saved', backend: 'nai', name: '已保存', entries: [{ id: 'e', name: '规则', role: 'system', content: '使用自然语言', enabled: true }] }], active: { nai: 'saved', comfyui: '' } };
    mocks.context = { extensionSettings: { baibai_image: { autoTag: { presetLibrary: library } } }, saveSettingsDebounced: vi.fn() };
    const { hydrateSettings, settings } = await import('./settings');
    await hydrateSettings();
    expect(settings.autoTag.presetLibrary).toEqual(library);
    settings.autoTag.presetLibrary!.presets[0].entries[0].content = '已编辑';
    await nextTick();
    expect(mocks.context!.extensionSettings.baibai_image.autoTag.presetLibrary.presets[0].entries[0].content).toBe('已编辑');
    expect(mocks.context!.saveSettingsDebounced).toHaveBeenCalled();
  });
});
