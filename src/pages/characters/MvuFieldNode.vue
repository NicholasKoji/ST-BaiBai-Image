<script setup lang="ts">
import { computed, ref } from 'vue';
import { pathContains, pathLabel, type MvuPath } from '@/autoTag/mvu';

const props = defineProps<{ path: MvuPath; value: unknown; selected: MvuPath[]; search: string; depth: number }>();
const emit = defineEmits<{ toggle: [path: MvuPath, checked: boolean] }>();
const open = ref(props.depth < 1);
const children = computed(() => props.value !== null && typeof props.value === 'object' ? Object.entries(props.value) : []);
const branch = computed(() => children.value.length > 0);
const checked = computed(() => props.selected.some(p => pathContains(p, props.path)));
const mixed = computed(() => !checked.value && props.selected.some(p => pathContains(props.path, p)));
const visible = computed(() => !props.search || `${pathLabel(props.path)} ${JSON.stringify(props.value)}`.toLocaleLowerCase().includes(props.search.toLocaleLowerCase()));
const preview = computed(() => {
  if (branch.value) return `${Array.isArray(props.value) ? '列表' : '字段组'} · ${children.value.length} 项`;
  const text = typeof props.value === 'string' ? props.value : JSON.stringify(props.value);
  return text?.length > 160 ? text.slice(0, 160) + '…' : text;
});
</script>

<template>
  <li v-if="visible" class="mvu-node">
    <div class="mvu-node-row">
      <button v-if="branch" type="button" class="mvu-expand" :aria-label="`${open ? '收起' : '展开'} ${pathLabel(path)}`" :aria-expanded="open || !!search" @click="open = !open">{{ open || search ? '▾' : '▸' }}</button>
      <span v-else class="mvu-expand-spacer" />
      <label class="mvu-node-label">
        <input type="checkbox" :checked="checked" :indeterminate="mixed" :aria-label="`选择 ${pathLabel(path)}`" @change="emit('toggle', path, ($event.target as HTMLInputElement).checked)" />
        <span class="mvu-key">{{ path.at(-1) }}</span>
        <span class="mvu-value" :title="branch ? '选中字段组会包含其全部子字段，后续新增子字段也会包含' : String(value)">{{ preview }}</span>
      </label>
    </div>
    <ul v-if="branch && (open || search)" class="mvu-children">
      <MvuFieldNode v-for="[key, child] in children" :key="key" :path="[...path, key]" :value="child" :selected="selected" :search="search" :depth="depth + 1" @toggle="(p, checked) => emit('toggle', p, checked)" />
    </ul>
  </li>
</template>

<style scoped>
.mvu-node, .mvu-children { list-style: none; margin: 0; padding: 0; min-width: 0; }
.mvu-node-row { display: flex; align-items: flex-start; min-height: 36px; border-bottom: 1px solid var(--bbi-line); }
.mvu-node-row:hover { background: var(--bbi-surface-2); }
.mvu-expand, .mvu-expand-spacer { flex: 0 0 28px; width: 28px; height: 36px; }
.mvu-expand { border: 0; background: transparent; color: var(--bbi-ink-soft); cursor: pointer; }
.mvu-node-label { display: grid; grid-template-columns: 16px minmax(80px, 1fr) minmax(0, 2fr); gap: 8px; align-items: start; flex: 1; min-width: 0; padding: 8px 8px 8px 0; cursor: pointer; font-size: 12px; }
.mvu-node-label input { margin: 2px 0 0; accent-color: var(--bbi-accent); }
.mvu-key { font-weight: 600; overflow-wrap: anywhere; }
.mvu-value { color: var(--bbi-ink-muted); overflow-wrap: anywhere; white-space: pre-wrap; }
.mvu-children { padding-left: 16px; }
.mvu-expand:focus-visible, input:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: 2px; }
@media (max-width: 640px) {
  .mvu-node-label { grid-template-columns: 16px minmax(0, 1fr); }
  .mvu-value { grid-column: 2; }
  .mvu-children { padding-left: 8px; }
}
</style>
