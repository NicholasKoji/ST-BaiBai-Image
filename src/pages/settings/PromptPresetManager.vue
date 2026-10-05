<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BbiSelect from '@/components/BbiSelect.vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { settings } from '@/state/settings';
import { builtInPromptPreset, defaultPromptPreset } from '@/state/promptPresetDefaults';
import {
  activePromptPreset, BUILTIN_CLASSIC_PRESET_ID, BUILTIN_STORY_IMAGE_PRESET_ID,
  deletePromptPreset, emptyPromptPresetLibrary, exportPromptPreset, importPromptPreset,
  isBuiltInPromptPresetId, newPromptEntry, newPromptId, savePromptPreset,
  type PromptPreset, type PromptPresetBackend, type PromptRole,
} from '@/state/promptPresets';

const backend = ref<PromptPresetBackend>(settings.defaultBackend === 'comfyui' ? 'comfyui' : 'nai');
const BACKENDS = [{ value: 'nai', label: 'NovelAI' }, { value: 'comfyui', label: 'ComfyUI' }];
const ROLES = [{ value: 'system', label: 'System' }, { value: 'user', label: 'User' }, { value: 'assistant', label: 'Assistant' }];
const library = computed(() => settings.autoTag.presetLibrary ?? emptyPromptPresetLibrary());
const selected = computed(() => activePromptPreset(library.value, backend.value));
const builtIn = computed(() => builtInPromptPreset(library.value.active[backend.value], backend.value, settings.autoTag.prompts));
const displayed = computed(() => selected.value ?? builtIn.value);
const options = computed(() => [
  { value: BUILTIN_STORY_IMAGE_PRESET_ID, label: '内置 · 正文生图（推荐）' },
  { value: BUILTIN_CLASSIC_PRESET_ID, label: '内置 · 经典版（兼容旧设置）' },
  ...library.value.presets.filter(p => p.backend === backend.value).map(p => ({ value: p.id, label: p.name })),
]);
const activeId = computed({
  get: () => library.value.active[backend.value],
  set: id => { ensureLibrary().active[backend.value] = id; error.value = ''; status.value = ''; },
});
const backendModel = computed({ get: () => backend.value, set: value => { backend.value = value as PromptPresetBackend; error.value = ''; } });
const draft = ref<PromptPreset | null>(null);
const entryId = ref('');
const entry = computed(() => draft.value?.entries.find(e => e.id === entryId.value));
const roleModel = computed({ get: () => entry.value?.role ?? 'system', set: value => { if (entry.value) entry.value.role = value as PromptRole; } });
const error = ref('');
const status = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const reading = ref(false);
const importing = ref<PromptPreset | null>(null);
const importError = ref('');
const importBackend = computed({ get: () => importing.value?.backend ?? backend.value, set: value => { if (importing.value) importing.value.backend = value as PromptPresetBackend; } });
const deleting = ref<{ id: string; name: string } | null>(null);
const deleteOpen = computed({ get: () => !!deleting.value, set: open => { if (!open) deleting.value = null; } });
const macros = ['上下文', '正文', '历史正文', '角色设定', '玩家设定', '世界书', '角色参考', '状态参考', '角色外貌库', '任务备注', '破限', '后端规范', '生成前检查', '预填充', 'user', 'char', 'nl'];
const area = ref<InstanceType<typeof BbiTextarea> | null>(null);
function macroToken(name: string) { return '{{' + name + '}}'; }

watch(() => settings.defaultBackend, value => {
  if (!draft.value && !importing.value) backend.value = value === 'comfyui' ? 'comfyui' : 'nai';
});

function ensureLibrary() {
  return settings.autoTag.presetLibrary ??= emptyPromptPresetLibrary();
}
function current(): PromptPreset {
  return displayed.value ?? defaultPromptPreset(backend.value, settings.autoTag.prompts);
}
function uniqueName(name: string, targetBackend: PromptPresetBackend, exceptId = ''): string {
  const names = new Set(library.value.presets.filter(p => p.backend === targetBackend && p.id !== exceptId).map(p => p.name));
  if (!names.has(name)) return name;
  let i = 2;
  while (names.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}
function edit(copy = false) {
  const value = JSON.parse(JSON.stringify(current())) as PromptPreset;
  if (copy || isBuiltInPromptPresetId(activeId.value)) value.id = newPromptId();
  if (copy) value.name += ' 副本';
  value.name = uniqueName(value.name, value.backend, value.id);
  draft.value = value;
  entryId.value = value.entries[0]?.id ?? '';
  error.value = '';
  status.value = '';
}
function addPreset() {
  const first = newPromptEntry('生图规则');
  draft.value = { id: newPromptId(), name: uniqueName('新预设', backend.value), backend: backend.value, entries: [first] };
  entryId.value = first.id;
  error.value = '';
  status.value = '';
}
function cancelEdit() { draft.value = null; entryId.value = ''; error.value = ''; }
function save() {
  if (!draft.value) return;
  try {
    const saved = savePromptPreset(ensureLibrary(), draft.value);
    ensureLibrary().active[saved.backend] = saved.id;
    backend.value = saved.backend;
    cancelEdit();
    status.value = `已保存并使用「${saved.name}」`;
  } catch (e) { error.value = (e as Error).message; }
}
function addEntry() {
  const value = newPromptEntry();
  draft.value?.entries.push(value);
  entryId.value = value.id;
}
function removeEntry() {
  if (!draft.value || !entry.value) return;
  const index = draft.value.entries.indexOf(entry.value);
  draft.value.entries.splice(index, 1);
  entryId.value = draft.value.entries[Math.min(index, draft.value.entries.length - 1)]?.id ?? '';
}
function moveEntry(direction: number) {
  if (!draft.value || !entry.value) return;
  const entries = draft.value.entries;
  const index = entries.indexOf(entry.value), to = index + direction;
  if (to < 0 || to >= entries.length) return;
  [entries[index], entries[to]] = [entries[to], entries[index]];
}
function exportPreset() {
  try {
    const value = current();
    const url = URL.createObjectURL(new Blob([exportPromptPreset(value)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${value.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.value = `已导出「${value.name}」`;
  } catch (e) { error.value = (e as Error).message; }
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = '';
  if (!file || reading.value) return;
  reading.value = true;
  error.value = ''; status.value = '';
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('预设文件超过 5 MB，请精简后再导入');
    importing.value = importPromptPreset(await file.text(), backend.value);
    importError.value = '';
  } catch (e) { error.value = (e as Error).message; }
  finally { reading.value = false; }
}
function confirmImport() {
  if (!importing.value) return;
  try {
    const value = { ...importing.value, name: uniqueName(importing.value.name.trim(), importing.value.backend) };
    const saved = savePromptPreset(ensureLibrary(), value);
    ensureLibrary().active[saved.backend] = saved.id;
    backend.value = saved.backend;
    importing.value = null;
    status.value = `已导入并使用「${saved.name}」`;
  } catch (e) { importError.value = (e as Error).message; }
}
function confirmDelete() {
  if (!deleting.value) return;
  deletePromptPreset(ensureLibrary(), deleting.value.id);
  deleting.value = null;
  status.value = '预设已删除，已切回内置 · 正文生图';
}
</script>

<template>
  <div class="preset-manager">
    <p class="bbi-field-hint">选择内置预设，或管理自己准备的生图提示词预设。NovelAI 与 ComfyUI 分别记住当前选择，切换预设不会切换出图渠道。</p>
    <template v-if="!draft">
      <div class="preset-selectors">
        <label class="preset-field"><span>预设用途</span><BbiSelect v-model="backendModel" :options="BACKENDS" aria-label="预设用途" /></label>
        <label class="preset-field"><span>当前预设</span><BbiSelect v-model="activeId" :options="options" aria-label="当前提示词预设" /></label>
      </div>
      <div class="preset-actions">
        <button class="bbi-btn bbi-btn-primary" type="button" @click="edit()"><Icon name="edit" />编辑</button>
        <button class="bbi-btn" type="button" @click="addPreset"><Icon name="plus" />新建</button>
        <button class="bbi-btn" type="button" @click="edit(true)"><Icon name="copy" />复制</button>
        <button class="bbi-btn" type="button" :disabled="reading" @click="fileInput?.click()"><Icon name="download" />{{ reading ? '读取中…' : '导入' }}</button>
        <button class="bbi-btn" type="button" @click="exportPreset"><Icon name="upload" />导出</button>
        <button class="bbi-btn bbi-btn-danger" type="button" :disabled="!selected" @click="selected && (deleting = { id: selected.id, name: selected.name })"><Icon name="trash" />删除</button>
      </div>
      <p v-if="displayed" class="bbi-field-hint">{{ displayed.entries.length }} 个条目，{{ displayed.entries.filter(e => e.enabled).length }} 个已启用。编辑内置预设会另存为自定义副本，不会改写内置内容。</p>
    </template>
    <input ref="fileInput" hidden type="file" accept=".json,application/json" aria-label="导入提示词预设文件" @change="readFile" />

    <div v-if="draft" class="preset-editor">
      <label class="preset-field"><span>预设名称 · {{ draft.backend === 'nai' ? 'NovelAI' : 'ComfyUI' }}</span><input v-model="draft.name" class="bbi-input" maxlength="160" /></label>
      <p class="bbi-field-hint">逐条修改、开关和排序；保存前只修改草稿。插件仅补充正文上下文和 JSON 输出协议。</p>
      <div class="preset-editor-grid">
        <div>
          <div class="preset-entry-list" role="list" aria-label="预设条目">
            <button v-for="(item, index) in draft.entries" :key="item.id" class="preset-entry" :class="{ 'is-selected': item.id === entryId, 'is-off': !item.enabled }" type="button" :aria-pressed="item.id === entryId" @click="entryId = item.id">
              <span class="preset-entry-number">{{ index + 1 }}</span>
              <span class="preset-entry-name">{{ item.name || '未命名条目' }}<small>{{ item.role }} · {{ item.enabled ? '启用' : '关闭' }}</small></span>
            </button>
          </div>
          <button class="bbi-btn preset-add-entry" type="button" @click="addEntry"><Icon name="plus" />添加条目</button>
        </div>
        <div v-if="entry" class="preset-entry-editor">
          <label class="preset-field"><span>条目名称</span><input v-model="entry.name" class="bbi-input" /></label>
          <div class="preset-entry-controls">
            <label class="preset-field preset-role"><span>消息角色</span><BbiSelect v-model="roleModel" :options="ROLES" aria-label="条目消息角色" /></label>
            <label class="preset-enabled"><input v-model="entry.enabled" type="checkbox" class="bbi-checkbox" />启用条目</label>
          </div>
          <label class="preset-field"><span>提示词内容</span><BbiTextarea ref="area" v-model="entry.content" :rows="12" :max-rows="24" mono /></label>
          <details class="preset-macros"><summary>可用上下文宏</summary><p class="bbi-field-hint">点击插入。上下文宏只作文本替换；未引用的信息会由插件补充。</p><div class="preset-macro-buttons"><button v-for="macro in macros" :key="macro" class="bbi-btn" type="button" @click="area?.insertAtCursor(macroToken(macro))">{{ macroToken(macro) }}</button></div></details>
          <div class="preset-actions">
            <button class="bbi-btn" type="button" :disabled="draft.entries[0]?.id === entry.id" @click="moveEntry(-1)">上移</button>
            <button class="bbi-btn" type="button" :disabled="draft.entries.at(-1)?.id === entry.id" @click="moveEntry(1)">下移</button>
            <button class="bbi-btn bbi-btn-danger" type="button" @click="removeEntry">删除条目</button>
          </div>
        </div>
        <p v-else class="bbi-field-hint">添加一个条目开始编辑。</p>
      </div>
      <div class="preset-actions preset-footer"><button class="bbi-btn" type="button" @click="cancelEdit">取消</button><button class="bbi-btn bbi-btn-primary" type="button" @click="save"><Icon name="check" />保存并使用</button></div>
    </div>
    <p v-if="error" class="preset-error" role="alert">{{ error }}</p>
    <p v-if="status" class="bbi-field-hint" role="status">{{ status }}</p>

    <ModalMask :open="!!importing" @close="importing = null">
      <div v-if="importing" class="bbi-modal" role="dialog" aria-modal="true" aria-label="导入提示词预设">
        <header class="bbi-modal-head"><span class="bbi-modal-title">导入预设</span><button class="bbi-icon-mini" type="button" title="关闭" @click="importing = null"><Icon name="close" /></button></header>
        <label class="preset-field"><span>导入用途</span><BbiSelect v-model="importBackend" :options="BACKENDS" aria-label="导入预设用途" /></label>
        <label class="preset-field"><span>预设名称</span><input v-model="importing.name" class="bbi-input" /></label>
        <p class="bbi-field-hint">共 {{ importing.entries.length }} 个条目。导入后用于所选后端，同名预设会另存，出图渠道保持原样。</p>
        <p v-if="importError" class="preset-error" role="alert">{{ importError }}</p>
        <footer class="bbi-modal-foot"><button class="bbi-btn" type="button" @click="importing = null">取消</button><button class="bbi-btn bbi-btn-primary" type="button" @click="confirmImport">导入并使用</button></footer>
      </div>
    </ModalMask>
    <ConfirmDialog v-model:open="deleteOpen" title="删除预设" confirm-text="删除" tone="danger" @confirm="confirmDelete">确定删除「{{ deleting?.name }}」吗？该后端将切回内置默认。</ConfirmDialog>
  </div>
</template>

<style scoped>
.preset-manager { min-width: 0; }
.preset-selectors { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 12px; }
.preset-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin-bottom: 12px; font-size: 13px; }
.preset-field > span { color: var(--bbi-ink-muted); }
.preset-field :deep(.bbi-select-box) { width: 100%; }
.preset-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.preset-editor-grid { display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); gap: 16px; }
.preset-entry-list { max-height: 420px; overflow-y: auto; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); }
.preset-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px; border: 0; border-bottom: 1px solid var(--bbi-line); background: var(--bbi-surface); color: var(--bbi-ink); font: inherit; text-align: left; cursor: pointer; }
.preset-entry:last-child { border-bottom: 0; }
.preset-entry:hover, .preset-entry.is-selected { background: var(--bbi-surface-2); color: var(--bbi-accent); }
.preset-entry.is-selected { box-shadow: inset 0 0 0 1px var(--bbi-accent); }
.preset-entry:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: -2px; }
.preset-entry.is-off:not(.is-selected) { color: var(--bbi-ink-muted); }
.preset-entry-number { font-size: 11px; color: var(--bbi-ink-muted); }
.preset-entry-name { min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.preset-entry-name small { display: block; margin-top: 2px; color: var(--bbi-ink-muted); font-size: 11px; }
.preset-add-entry { margin-top: 8px; width: 100%; justify-content: center; }
.preset-entry-editor { min-width: 0; }
.preset-entry-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.preset-role { min-width: 140px; flex: 1; }
.preset-enabled { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.preset-footer { justify-content: flex-end; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--bbi-line); }
.preset-macros { margin: 8px 0 12px; font-size: 12px; }
.preset-macros summary { cursor: pointer; color: var(--bbi-ink-muted); }
.preset-macro-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.preset-macro-buttons .bbi-btn { padding: 4px 7px; font-size: 11px; }
.preset-error { color: var(--bbi-danger); font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .preset-selectors, .preset-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .preset-entry-list { max-height: 180px; }
  .preset-actions .bbi-btn { flex: 1 0 auto; justify-content: center; }
}
</style>
