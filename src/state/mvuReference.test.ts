import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindMvuReferenceSync, getMvuReferenceConfig, hydrateMvuReference, MVU_REFERENCE_KEY, mvuReference, saveMvuReference } from './mvuReference';
import type { STContext } from '@/st/context';

const context = (id = 'a'): STContext => ({ chatMetadata: {}, getCurrentChatId: () => id, saveMetadataDebounced: vi.fn() } as unknown as STContext);
afterEach(() => vi.unstubAllGlobals());
describe('per-chat MVU reference config', () => {
  it('defaults off and normalizes stored paths', () => {
    const ctx = context(); expect(getMvuReferenceConfig(ctx)).toEqual({ enabled: false, paths: [] });
    ctx.chatMetadata[MVU_REFERENCE_KEY] = { enabled: true, paths: [['a', 'b'], ['a'], 'bad'] };
    expect(getMvuReferenceConfig(ctx)).toEqual({ enabled: true, paths: [['a']] });
  });
  it('saves only explicit configuration in chat metadata, never variables', () => {
    const ctx = context(); ctx.chatMetadata.variables = { stat_data: { keep: true } };
    vi.stubGlobal('window', { SillyTavern: { getContext: () => ctx } });
    expect(saveMvuReference({ enabled: true, paths: [['a']] }, 'a')).toBe(true);
    expect(ctx.chatMetadata.variables).toEqual({ stat_data: { keep: true } });
    expect(ctx.saveMetadataDebounced).toHaveBeenCalledOnce();
    expect(mvuReference.paths).toEqual([['a']]);
  });
  it('rejects stale draft saves after a chat switch', () => {
    const ctx = context('b'); vi.stubGlobal('window', { SillyTavern: { getContext: () => ctx } });
    expect(saveMvuReference({ enabled: true, paths: [['a']] }, 'a')).toBe(false);
    expect(ctx.chatMetadata).toEqual({}); expect(ctx.saveMetadataDebounced).not.toHaveBeenCalled();
  });
  it('hydrates independent selections on chat changes and resets without a chat', () => {
    let ctx: STContext | null = context(); ctx.chatMetadata[MVU_REFERENCE_KEY] = { enabled: true, paths: [['a']] };
    vi.stubGlobal('window', { SillyTavern: { getContext: () => ctx } }); hydrateMvuReference();
    expect(mvuReference.enabled).toBe(true); ctx = context('b'); hydrateMvuReference();
    expect(mvuReference).toMatchObject({ enabled: false, paths: [], chatId: 'b' }); ctx = null; hydrateMvuReference();
    expect(mvuReference.chatId).toBe('');
  });
  it('binds hydration to the host chat-change event', () => {
    const ctx = context(); const on = vi.fn(); ctx.eventSource = { on }; ctx.eventTypes = { CHAT_CHANGED: 'changed' } as any;
    vi.stubGlobal('window', { SillyTavern: { getContext: () => ctx } }); bindMvuReferenceSync();
    expect(on).toHaveBeenCalledWith('changed', hydrateMvuReference);
    ctx.chatMetadata[MVU_REFERENCE_KEY] = { enabled: true, paths: [['b']] }; on.mock.calls[0][1]();
    expect(mvuReference.paths).toEqual([['b']]);
  });
});
