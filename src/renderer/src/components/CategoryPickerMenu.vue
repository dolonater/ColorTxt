<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { FileCategoryDefinition } from "../constants/fileCategories";

export type CategoryPickerMenuCounts = {
  uncategorized: number;
  byName: Readonly<Record<string, number>>;
};

const props = withDefaults(
  defineProps<{
    open: boolean;
    x: number;
    y: number;
    catalog: readonly FileCategoryDefinition[];
    minWidth?: number;
    /** 为 true 时面板下缘对齐参考点（用于底栏按钮上方弹出） */
    alignAbove?: boolean;
    /** 与各筛选项后 (n) 一致；不传则不显示数量 */
    menuCounts?: CategoryPickerMenuCounts | null;
  }>(),
  { alignAbove: false, minWidth: 160, menuCounts: null },
);

const emit = defineEmits<{
  close: [];
  pick: [categoryName: string];
}>();

const menuRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const posX = ref(0);
const posY = ref(0);
/** 首次布局并 clamp 完成前隐藏，避免 alignAbove 时先以 props.y 顶对齐画一帧再跳变 */
const positionReady = ref(false);
const scrollHasScrollbar = ref(false);
let scrollResizeObserver: ResizeObserver | null = null;

function updateScrollHasScrollbar() {
  const el = scrollRef.value;
  if (!el) {
    scrollHasScrollbar.value = false;
    return;
  }
  scrollHasScrollbar.value = el.scrollHeight - el.clientHeight > 0.5;
}

function bindScrollResizeObserver() {
  unbindScrollResizeObserver();
  const el = scrollRef.value;
  if (!el) return;
  scrollResizeObserver = new ResizeObserver(() => {
    updateScrollHasScrollbar();
  });
  scrollResizeObserver.observe(el);
}

function unbindScrollResizeObserver() {
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
}

function clamp() {
  const el = menuRef.value;
  if (!el) return;
  const margin = 8;
  let y = props.y;
  if (props.alignAbove) {
    y = props.y - el.offsetHeight - 4;
  }
  const maxX = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
  posX.value = Math.min(Math.max(margin, props.x), maxX);
  posY.value = Math.min(Math.max(margin, y), maxY);
}

watch(
  () => props.open,
  async (o) => {
    if (!o) {
      positionReady.value = false;
      unbindScrollResizeObserver();
      scrollHasScrollbar.value = false;
      return;
    }
    positionReady.value = false;
    posX.value = props.x;
    posY.value = props.y;
    await nextTick();
    requestAnimationFrame(() => {
      clamp();
      positionReady.value = true;
      updateScrollHasScrollbar();
      bindScrollResizeObserver();
      requestAnimationFrame(() => {
        updateScrollHasScrollbar();
      });
    });
  },
);

watch(
  () => props.catalog.length,
  async () => {
    if (!props.open) return;
    await nextTick();
    updateScrollHasScrollbar();
  },
);

watch(
  () => [props.x, props.y] as const,
  () => {
    if (!props.open) return;
    posX.value = props.x;
    posY.value = props.y;
    void nextTick().then(clamp);
  },
);

function onDocPointerDown(ev: PointerEvent) {
  if (!props.open) return;
  const t = ev.target as Node | null;
  if (t && menuRef.value?.contains(t)) return;
  emit("close");
}

/** 窗口尺寸变化时关闭，避免固定坐标与锚点错位 */
function onWindowResize() {
  if (!props.open) return;
  emit("close");
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  window.addEventListener("resize", onWindowResize);
});
onBeforeUnmount(() => {
  unbindScrollResizeObserver();
  document.removeEventListener("pointerdown", onDocPointerDown);
  window.removeEventListener("resize", onWindowResize);
});

function pick(name: string) {
  emit("pick", name);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      class="catPickMenu appShellMenuPanel"
      role="menu"
      :style="{
        left: `${posX}px`,
        top: `${posY}px`,
        minWidth: `${props.minWidth}px`,
        visibility: positionReady ? 'visible' : 'hidden',
        pointerEvents: positionReady ? 'auto' : 'none',
      }"
      @click.stop
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="pick('')"
      >
        <span class="appShellMenuItemRowBody">
          <span class="appShellMenuItemLabelWithCount">
            <span class="appShellMenuItemLabelText">未分类</span>
            <span v-if="menuCounts" class="appShellMenuItemSuffix"
              >({{ menuCounts.uncategorized }})</span
            >
          </span>
        </span>
      </button>
      <div v-if="catalog.length > 0" class="appShellMenuDivider" />
      <div
        v-if="catalog.length > 0"
        ref="scrollRef"
        class="categoryPickerMenuScroll"
        :class="{
          'categoryPickerMenuScroll--scrollbarPad': scrollHasScrollbar,
        }"
      >
        <button
          v-for="(c, i) in catalog"
          :key="i"
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="pick(c.name)"
        >
          <span
            class="appShellMenuItemMark"
            aria-hidden="true"
            :style="{ backgroundColor: c.color }"
          />
          <span class="appShellMenuItemRowBody">
            <span class="appShellMenuItemLabelWithCount">
              <span class="appShellMenuItemLabelText">{{ c.name }}</span>
              <span v-if="menuCounts" class="appShellMenuItemSuffix"
                >({{ menuCounts.byName[c.name] ?? 0 }})</span
              >
            </span>
          </span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.catPickMenu {
  position: fixed;
  z-index: 7300;
}
.categoryPickerMenuScroll {
  max-height: 380px;
  overflow-y: auto;
}
.categoryPickerMenuScroll--scrollbarPad {
  padding-right: 8px;
}
</style>
