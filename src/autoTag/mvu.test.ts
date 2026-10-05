import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMvuReference, latestMvuFloor, normalizeMvuPaths, readMvuReference, readMvuSnapshot, selectMvuFields, toggleMvuPath } from './mvu';
import type { STContext } from '@/st/context';

const fixture = () => ({ 角色: { 苏晴雅: { 外貌: { 头发: '棕色中长发', 面容: '柔和鹅蛋脸' }, 穿着: { 上装: '蓝色衬衫', 下装: '深色长裤' }, 想法: 'DO_NOT_SEND' } }, 金钱: 999, falseValue: false, zero: 0, empty: '' });
const context = (): STContext => ({ chat: [{ mes: '苏晴雅走进房间。', name: 'Narrator', is_user: false, is_system: false, swipe_id: 0 }], getCurrentChatId: () => 'a' } as STContext);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local MVU selection', () => {
  it('whitelists selected fields, retains names/hierarchy, never includes other variables', () => {
    const selected = selectMvuFields(fixture(), [['角色', '苏晴雅', '外貌'], ['角色', '苏晴雅', '穿着', '上装']]);
    expect(selected.data).toEqual({ 角色: { 苏晴雅: { 外貌: { 头发: '棕色中长发', 面容: '柔和鹅蛋脸' }, 穿着: { 上装: '蓝色衬衫' } } } });
    expect(JSON.stringify(selected)).not.toMatch(/DO_NOT_SEND|金钱|下装/);
  });
  it('copies selected objects rather than writing through to MVU', () => {
    const data = fixture(); const selected = selectMvuFields(data, [['角色']]);
    (selected.data.角色 as any).苏晴雅.外貌.头发 = 'changed';
    expect(data.角色.苏晴雅.外貌.头发).toBe('棕色中长发');
  });
  it('handles dots, slashes, empty field names, unicode and literal prototype-looking keys', () => {
    const data = JSON.parse('{"a.b":{"x/y":{"":"ok"}},"__proto__":{"polluted":"local"}}');
    const selected = selectMvuFields(data, [['a.b', 'x/y', ''], ['__proto__', 'polluted']]);
    expect(JSON.parse(JSON.stringify(selected.data))).toEqual(data);
    expect(({} as any).polluted).toBeUndefined();
  });
  it('keeps falsy values and reports missing fields without inheriting object properties', () => {
    const selected = selectMvuFields(fixture(), [['falseValue'], ['zero'], ['empty'], ['missing'], ['toString']]);
    expect(selected.data).toEqual({ falseValue: false, zero: 0, empty: '' });
    expect(selected.missing).toEqual([['missing'], ['toString']]);
  });
  it('preserves full arrays and original indices of selected elements', () => {
    const data = { a: ['first', { x: 'second', hidden: 'never' }] };
    expect(selectMvuFields(data, [['a']]).data).toEqual(data);
    expect(selectMvuFields(data, [['a', '1', 'x']]).data).toEqual({ a: { '1': { x: 'second' } } });
  });
  it('normalizes duplicate/overlapping paths and rejects malformed/root selections', () => {
    expect(normalizeMvuPaths([[], 'a', ['角色', 4], ['角色', '苏晴雅'], ['角色'], ['角色']])).toEqual([['角色']]);
  });
  it('unchecking a leaf inside a selected group retains siblings but not unrelated data', () => {
    const next = toggleMvuPath(fixture(), [['角色', '苏晴雅']], ['角色', '苏晴雅', '穿着', '下装'], false);
    expect(selectMvuFields(fixture(), next).data).toEqual({ 角色: { 苏晴雅: { 外貌: fixture().角色.苏晴雅.外貌, 想法: 'DO_NOT_SEND', 穿着: { 上装: '蓝色衬衫' } } } });
  });
  it('checking a group covers future children; unchecking it removes all child selections', () => {
    const path = ['角色', '苏晴雅', '穿着'];
    const next = toggleMvuPath(fixture(), [path.concat('上装')], path, true);
    expect(next).toEqual([path]);
    const data = fixture(); (data.角色.苏晴雅.穿着 as any).袜子 = '白袜';
    expect(JSON.stringify(selectMvuFields(data, next).data)).toContain('白袜');
    expect(toggleMvuPath(data, [path.concat('上装')], path, false)).toEqual([]);
  });
  it('wraps facts in self-contained story language without internal framework metadata', () => {
    const text = formatMvuReference(selectMvuFields(fixture(), [['角色', '苏晴雅', '穿着']]));
    expect(text).toContain('故事片段结束时'); expect(text).toContain('不把片段结束时的状态套用到全部画面');
    expect(text).not.toMatch(/MVU|酒馆|楼层|柏宝|swipe|stat_data|DO_NOT_SEND/);
    expect(formatMvuReference({ data: {}, missing: [['missing']] })).toBe('');
  });
});

describe('target-bound MVU snapshots', () => {
  it('reads the requested message and active swipe, not the latest or previous swipe', () => {
    const ctx = context(); ctx.chat[0].variables = [{ stat_data: { outfit: 'old' } }, { stat_data: { outfit: 'new' } }];
    ctx.chat[0].swipe_id = 1; ctx.chat.push({ ...ctx.chat[0], variables: [{ stat_data: { outfit: 'future' } }], swipe_id: 0 });
    expect(readMvuSnapshot(ctx, 0)).toEqual({ outfit: 'new' });
  });
  it('supports the MVU read API and always passes a concrete target id', () => {
    const getMvuData = vi.fn(() => ({ stat_data: { outfit: 'blue' }, schema: 'not sent' }));
    vi.stubGlobal('Mvu', { getMvuData });
    expect(readMvuSnapshot(context(), 0)).toEqual({ outfit: 'blue' });
    expect(getMvuData).toHaveBeenCalledWith({ type: 'message', message_id: 0 });
  });
  it('supports TavernHelper read API and tolerates unavailable helper exceptions', () => {
    vi.stubGlobal('Mvu', { getMvuData() { throw Error('initializing'); } });
    vi.stubGlobal('TavernHelper', { getVariables: () => ({ stat_data: { outfit: 'blue' } }) });
    expect(readMvuSnapshot(context(), 0)).toEqual({ outfit: 'blue' });
  });
  it('UI may find the last available snapshot, while requests never substitute it', async () => {
    const ctx = context(); ctx.chat[0].variables = [{ stat_data: fixture() }]; ctx.chat.push({ ...ctx.chat[0], variables: [] });
    expect(latestMvuFloor(ctx)).toBe(0);
    await expect(readMvuReference(ctx, 1, [['角色']])).rejects.toThrow('尚未就绪');
  });
  it('waits for persisted target data before extracting a fresh value', async () => {
    vi.useFakeTimers(); const ctx = context(); const result = readMvuReference(ctx, 0, [['角色', '苏晴雅', '穿着']], { waitMs: 1000 });
    await vi.advanceTimersByTimeAsync(400); ctx.chat[0].variables = [{ stat_data: fixture() }];
    await vi.advanceTimersByTimeAsync(200);
    expect((await result).text).toContain('蓝色衬衫'); expect(vi.getTimerCount()).toBe(0);
  });
  it('a continuation waits for the old persisted snapshot to be replaced, even when values are unchanged', async () => {
    vi.useFakeTimers(); const ctx = context(); const before = fixture(); ctx.chat[0].variables = [{ stat_data: before }];
    let resolved = false;
    const result = readMvuReference(ctx, 0, [['角色']], { waitMs: 1000, previousData: before }).then(value => { resolved = true; return value; });
    await vi.advanceTimersByTimeAsync(400); expect(resolved).toBe(false);
    ctx.chat[0].variables = [{ stat_data: fixture() }]; await vi.advanceTimersByTimeAsync(200);
    expect((await result).text).toContain('苏晴雅');
  });
  it('times out rather than sending a made-up empty reference', async () => {
    vi.useFakeTimers(); const result = readMvuReference(context(), 0, [['角色']], { waitMs: 500 });
    const assertion = expect(result).rejects.toThrow('尚未就绪'); await vi.advanceTimersByTimeAsync(500); await assertion;
  });
  it('cancels on abort and clears timers/listeners', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const result = readMvuReference(context(), 0, [['角色']], { waitMs: 1000, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['chat', 'swipe', 'target'])('cancels when %s changes during snapshot wait', async kind => {
    vi.useFakeTimers(); const ctx = context(); const result = readMvuReference(ctx, 0, [['角色']], { waitMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    if (kind === 'chat') ctx.getCurrentChatId = () => 'b';
    if (kind === 'swipe') ctx.chat[0].swipe_id = 1;
    if (kind === 'target') ctx.chat[0] = { ...ctx.chat[0], mes: 'another story' };
    await vi.advanceTimersByTimeAsync(200); await assertion;
  });
  it('skips missing paths and re-reads values on each request', async () => {
    const ctx = context(); const data = fixture(); ctx.chat[0].variables = [{ stat_data: data }];
    const paths = [['角色', '苏晴雅', '穿着', '上装'], ['nope']];
    expect((await readMvuReference(ctx, 0, paths)).missing).toEqual([['nope']]);
    data.角色.苏晴雅.穿着.上装 = '白色夹克';
    expect((await readMvuReference(ctx, 0, paths)).text).toContain('白色夹克');
  });
  it('makes no reads when no paths are selected', async () => {
    const api = vi.fn(); vi.stubGlobal('Mvu', { getMvuData: api });
    expect(await readMvuReference(context(), 0, [])).toEqual({ text: '', missing: [] }); expect(api).not.toHaveBeenCalled();
  });
});
