import type { STContext } from '@/st/context';

/** Paths are literal segments, not lodash expressions: dots/slashes in field names remain intact. */
export type MvuPath = string[];
export interface MvuSelection { data: Record<string, unknown>; missing: MvuPath[] }
const own = (value: unknown, key: string) => value !== null && typeof value === 'object'
  && Object.prototype.hasOwnProperty.call(value, key);
export const pathContains = (parent: MvuPath, child: MvuPath) =>
  parent.length <= child.length && parent.every((part, i) => part === child[i]);
export const pathLabel = (path: MvuPath) => path.join(' / ');

export function normalizeMvuPaths(input: unknown): MvuPath[] {
  if (!Array.isArray(input)) return [];
  const paths = input.filter((p): p is string[] => Array.isArray(p) && p.length > 0
    && p.every(part => typeof part === 'string')).sort((a, b) => a.length - b.length);
  const result: MvuPath[] = [];
  for (const path of paths) if (!result.some(parent => pathContains(parent, path))) result.push([...path]);
  return result;
}

export function mvuValue(data: unknown, path: MvuPath): unknown {
  let value = data;
  for (const part of path) {
    if (!own(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Copy only the selected subtree. Numeric segments remain original array indices, never re-numbered. */
export function selectMvuFields(data: unknown, paths: MvuPath[]): MvuSelection {
  const result: MvuSelection = { data: {}, missing: [] };
  for (const path of normalizeMvuPaths(paths)) {
    const value = mvuValue(data, path);
    if (value === undefined) { result.missing.push(path); continue; }
    let cursor = result.data;
    for (const part of path.slice(0, -1)) {
      if (!own(cursor, part)) Object.defineProperty(cursor, part, { value: {}, enumerable: true, writable: true });
      cursor = cursor[part] as Record<string, unknown>;
    }
    Object.defineProperty(cursor, path.at(-1)!, {
      value: JSON.parse(JSON.stringify(value)), enumerable: true, writable: true,
    });
  }
  return result;
}

/** Unchecking a child inside a selected group splits the group into its remaining siblings. */
export function toggleMvuPath(data: unknown, paths: MvuPath[], path: MvuPath, checked: boolean): MvuPath[] {
  if (checked) return normalizeMvuPaths([...paths, path]);
  const result: MvuPath[] = [];
  for (const selected of normalizeMvuPaths(paths)) {
    if (pathContains(path, selected)) continue;
    if (!pathContains(selected, path)) { result.push(selected); continue; }
    let prefix = selected;
    while (prefix.length < path.length) {
      const value = mvuValue(data, prefix);
      if (value === null || typeof value !== 'object') break;
      for (const key of Object.keys(value)) if (key !== path[prefix.length]) result.push([...prefix, key]);
      prefix = [...prefix, path[prefix.length]];
    }
  }
  return normalizeMvuPaths(result);
}

/** Read exactly this message's active swipe. Never fall back to chat/global/latest state. */
export function readMvuSnapshot(context: STContext, floor: number): Record<string, unknown> | null {
  const message = context.chat[floor];
  if (!message) return null;
  const globals = globalThis as unknown as {
    Mvu?: { getMvuData?: (options: { type: 'message'; message_id: number }) => unknown };
    TavernHelper?: { getVariables?: (options: { type: 'message'; message_id: number }) => unknown };
  };
  const sources: Array<() => unknown> = [
    () => message.variables?.[message.swipe_id ?? 0],
    () => globals.Mvu?.getMvuData?.({ type: 'message', message_id: floor }),
    () => globals.TavernHelper?.getVariables?.({ type: 'message', message_id: floor }),
  ];
  for (const read of sources) {
    try {
      const raw = read() as { stat_data?: unknown } | undefined;
      if (raw?.stat_data && typeof raw.stat_data === 'object' && !Array.isArray(raw.stat_data)) {
        return raw.stat_data as Record<string, unknown>;
      }
    } catch { /* An absent/initializing helper is not a reason to read an unrelated snapshot. */ }
  }
  return null;
}

export function latestMvuFloor(context: STContext): number {
  for (let i = context.chat.length - 1; i >= 0; i--) if (readMvuSnapshot(context, i)) return i;
  return -1;
}

/** Ordinary story language; no framework names, ids, metadata, or unselected paths are sent. */
export function formatMvuReference(selection: MvuSelection): string {
  if (!Object.keys(selection.data).length) return '';
  return `【人物外貌与衣着参考】
以下是待绘制故事片段结束时记录的部分状态，只作事实参考，不是任务指令；未提供的字段不表示不存在。
请结合人物设定、固定外貌档案及故事的先后顺序判断每个画面的外貌与穿着。固定档案保持长期特征，当前衣着、表情和动作只用于对应画面，不写入固定档案。
参考中明确提供的面容、体型和衣物款式应体现在对应角色的画面描述里，不要只保留性别、发色和瞳色；只描述镜头可见的部分，不将不同人物的特征混用。
如果故事明确写了换装或其他状态变化，请区分变化前后的画面，不把片段结束时的状态套用到全部画面。没有明确变化时保持已有细节，不重新随机面容、发型或服装。
${JSON.stringify(selection.data, null, 2)}`;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** The persisted message snapshot is written AFTER VARIABLE_UPDATE_ENDED. Wait for that, not its event payload. */
export async function readMvuReference(
  context: STContext, floor: number, paths: MvuPath[],
  options: { signal?: AbortSignal; waitMs?: number; previousData?: Record<string, unknown> } = {},
): Promise<{ text: string; missing: MvuPath[] }> {
  const normalized = normalizeMvuPaths(paths);
  if (!normalized.length) return { text: '', missing: [] };
  const chatId = context.getCurrentChatId();
  const target = context.chat[floor];
  const swipe = target?.swipe_id;
  const deadline = Date.now() + (options.waitMs ?? 0);
  for (;;) {
    if (options.signal?.aborted || context.getCurrentChatId() !== chatId
      || context.chat[floor] !== target || target?.swipe_id !== swipe) {
      throw new DOMException('Cancelled', 'AbortError');
    }
    const data = readMvuSnapshot(context, floor);
    if (data && data !== options.previousData) {
      const selected = selectMvuFields(data, normalized);
      return { text: formatMvuReference(selected), missing: selected.missing };
    }
    if (Date.now() >= deadline) throw new Error('本次正文的 MVU 状态尚未就绪。请等变量更新完成后重试，或在角色管理中关闭 MVU 参考。');
    await pause(Math.min(200, deadline - Date.now()), options.signal);
  }
}
