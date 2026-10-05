import { reactive } from 'vue';
import { getContext, type STContext } from '@/st/context';
import { normalizeMvuPaths, type MvuPath } from '@/autoTag/mvu';

export const MVU_REFERENCE_KEY = 'baibai_image_mvu_reference';
export interface MvuReferenceConfig { enabled: boolean; paths: MvuPath[] }
export const mvuReference = reactive<MvuReferenceConfig & { chatId: string }>({ enabled: false, paths: [], chatId: '' });

export function getMvuReferenceConfig(context: STContext): MvuReferenceConfig {
  const raw = context.chatMetadata?.[MVU_REFERENCE_KEY] as Partial<MvuReferenceConfig> | undefined;
  return { enabled: raw?.enabled === true, paths: normalizeMvuPaths(raw?.paths) };
}

export function hydrateMvuReference(): void {
  const context = getContext();
  Object.assign(mvuReference, context ? getMvuReferenceConfig(context) : { enabled: false, paths: [] },
    { chatId: context?.getCurrentChatId() ?? '' });
}

export function saveMvuReference(config: MvuReferenceConfig, expectedChatId: string): boolean {
  const context = getContext();
  if (!context || !expectedChatId || context.getCurrentChatId() !== expectedChatId) return false;
  context.chatMetadata[MVU_REFERENCE_KEY] = { version: 1, enabled: config.enabled === true, paths: normalizeMvuPaths(config.paths) };
  context.saveMetadataDebounced();
  hydrateMvuReference();
  return true;
}

let bound = false;
export function bindMvuReferenceSync(): void {
  const context = getContext();
  if (bound || !context?.eventTypes?.CHAT_CHANGED) return;
  bound = true;
  context.eventSource.on(context.eventTypes.CHAT_CHANGED, hydrateMvuReference);
  hydrateMvuReference();
}
