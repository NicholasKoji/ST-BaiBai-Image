<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import Collapsible from '@/components/Collapsible.vue';
import MvuFieldNode from './MvuFieldNode.vue';
import { formatMvuReference, latestMvuFloor, normalizeMvuPaths, pathLabel, readMvuSnapshot, selectMvuFields, toggleMvuPath, type MvuPath } from '@/autoTag/mvu';
import { getContext } from '@/st/context';
import { hydrateMvuReference, mvuReference, saveMvuReference } from '@/state/mvuReference';

const editing = ref(false);
const enabled = ref(false);
const paths = ref<MvuPath[]>([]);
const data = shallowRef<Record<string, unknown> | null>(null);
const floor = ref(-1);
const search = ref('');
const notice = ref('');
const error = ref('');
const draftChat = ref('');
const selected = computed(() => selectMvuFields(data.value, paths.value));
const preview = computed(() => formatMvuReference(selected.value));
const roots = computed(() => Object.entries(data.value ?? {}));
const matchesSearch = computed(() => !search.value || roots.value.some(([key, value]) => `${key} ${JSON.stringify(value)}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));

function refresh() {
  const context = getContext();
  floor.value = context ? latestMvuFloor(context) : -1;
  const snapshot = context && floor.value >= 0 ? readMvuSnapshot(context, floor.value) : null;
  // A helper may update fields in place. A fresh local copy invalidates preview computations on refresh.
  data.value = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
  notice.value = !context?.getCurrentChatId() ? '请先打开一个聊天。'
    : !data.value ? '本聊天还没有可读取的 MVU 消息快照。请确认变量框架已启用，并等变量初始化或更新完成后刷新。'
    : floor.value < context.chat.length - 1 ? `最新消息尚未记录 MVU 状态，正在预览第 ${floor.value} 楼已有快照。生成请求仍只读取待绘制正文自身的快照。`
    : `预览来源：第 ${floor.value} 楼的当前 swipe。此楼号只在界面显示，不发送给 AI。`;
}
function resetDraft() {
  enabled.value = mvuReference.enabled;
  paths.value = normalizeMvuPaths(mvuReference.paths);
  draftChat.value = mvuReference.chatId;
  search.value = ''; error.value = '';
  refresh();
}
function edit() { resetDraft(); editing.value = true; }
function cancel() { editing.value = false; resetDraft(); }
function toggle(path: MvuPath, checked: boolean) { paths.value = toggleMvuPath(data.value, paths.value, path, checked); }
function save() {
  error.value = '';
  if (enabled.value && !paths.value.length) { error.value = '启用参考前，请至少选择一个字段。'; return; }
  if (!saveMvuReference({ enabled: enabled.value, paths: paths.value }, draftChat.value)) {
    error.value = '聊天已切换，当前草稿未保存。请重新选择。'; return;
  }
  editing.value = false;
  toastr.success('已保存本聊天的 MVU 参考选择', '柏宝绘');
}
watch(() => mvuReference.chatId, () => { editing.value = false; resetDraft(); });
onMounted(() => { hydrateMvuReference(); resetDraft(); });
</script>

<template>
  <Collapsible title="MVU 人物状态参考" :open="false" class="mvu-panel">
    <p class="bbi-field-hint">固定角色档案记录长期外貌；这里补充当前面容细节、穿着等参考。仅发送勾选的内容，不修改任何变量。</p>
    <div v-if="!editing" class="mvu-toolbar">
      <span class="mvu-status">{{ mvuReference.enabled ? `已启用 · ${mvuReference.paths.length} 项选择` : '未启用' }} · 仅本聊天</span>
      <button class="bbi-btn" type="button" :disabled="!mvuReference.chatId" @click="edit">选择参考字段</button>
    </div>
    <template v-else>
      <div class="mvu-toolbar">
        <label class="mvu-enable"><input v-model="enabled" type="checkbox" />生成提示词时附带选中状态</label>
        <button class="bbi-btn" type="button" @click="refresh">刷新变量</button>
      </div>
      <p class="bbi-field-hint" role="status">{{ notice }}</p>
      <p class="bbi-field-hint">勾选字段组会包含全部子字段及后续新增字段。若只需要其中几项，请展开后逐项勾选。保存的是路径，每次请求读取新值。</p>
      <label v-if="roots.length" class="mvu-search"><span class="bbi-field-label">查找字段或值</span><input v-model="search" class="bbi-input" type="search" placeholder="例如：苏晴雅、外貌、穿着" /></label>
      <ul v-if="roots.length" class="mvu-tree" aria-label="MVU 参考字段">
        <MvuFieldNode v-for="[key, value] in roots" :key="`${draftChat}:${key}`" :path="[key]" :value="value" :selected="paths" :search="search" :depth="0" @toggle="toggle" />
      </ul>
      <p v-if="search && !matchesSearch" class="bbi-field-hint">没有匹配字段，换个关键词或清空搜索。</p>
      <p v-if="paths.length" class="bbi-field-hint">{{ paths.length }} 项选择；当前匹配 {{ paths.length - selected.missing.length }} 项 <button class="mvu-link" type="button" @click="paths = []">清空选择</button></p>
      <div v-if="selected.missing.length" class="mvu-missing">
        <p>以下已选路径在当前快照中不存在，发送时会跳过，不会猜测或补入其他字段。</p>
        <ul><li v-for="path in selected.missing" :key="JSON.stringify(path)"><span>{{ pathLabel(path) }}</span><button class="mvu-link" type="button" :aria-label="`移除 ${pathLabel(path)}`" @click="toggle(path, false)">移除</button></li></ul>
      </div>
      <details class="mvu-preview" open><summary>将发送给 AI 的状态参考预览</summary><p v-if="!enabled" class="bbi-field-hint">当前未启用。下方仅预览选中内容，启用并保存后才会随请求发送。</p><pre v-if="preview">{{ preview }}</pre><p v-else class="bbi-field-hint">尚未选中可用字段，不会发送状态参考。</p></details>
      <p v-if="error" class="mvu-error" role="alert">{{ error }}</p>
      <div class="mvu-toolbar mvu-footer"><button class="bbi-btn" type="button" @click="cancel">取消</button><button class="bbi-btn bbi-btn-primary" type="button" @click="save">保存选择</button></div>
    </template>
  </Collapsible>
</template>

<style scoped>
.mvu-panel { margin: 20px 0; }
.mvu-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.mvu-status { font-size: 12px; color: var(--bbi-ink-soft); }
.mvu-enable { display: flex; gap: 8px; align-items: center; font-size: 13px; }
input[type=checkbox] { accent-color: var(--bbi-accent); }
.mvu-search { display: grid; gap: 6px; margin: 12px 0; }
.mvu-tree { padding: 0; margin: 12px 0; max-height: 420px; overflow: auto; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); }
.mvu-link { border: 0; background: transparent; color: var(--bbi-accent); cursor: pointer; padding: 4px 8px; font: inherit; }
.mvu-missing { font-size: 12px; color: var(--bbi-ink-muted); }
.mvu-missing ul { padding-left: 20px; }
.mvu-missing li { overflow-wrap: anywhere; }
.mvu-preview { margin-top: 16px; font-size: 12px; }
.mvu-preview summary { cursor: pointer; color: var(--bbi-ink-soft); }
.mvu-preview pre { max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--bbi-font-mono); padding: 12px; background: var(--bbi-surface-2); border-radius: var(--bbi-radius-sm); line-height: 1.6; }
.mvu-error { color: var(--bbi-danger); font-size: 13px; }
.mvu-footer { justify-content: flex-end; border-top: 1px solid var(--bbi-line); margin-top: 16px; padding-top: 12px; }
@media (max-width: 640px) { .mvu-toolbar > .mvu-enable { flex-basis: 100%; } }
</style>
