<script setup lang="ts">
import type { Chapter } from "../chapter";
import { useReaderSidebarLists } from "../composables/useReaderSidebarLists";
import type {
  FileCategoryDefinition,
  FileSortMode,
} from "../constants/fileCategories";
import type { TxtFileItem } from "../services/fileListService";
import type { SidebarFileItem } from "../composables/useReaderSidebarLists";
import type { CategoryEditorRow } from "../constants/fileCategories";
import type { FileMetaRecord } from "../stores/fileMetaStore";
import SwitchToggle from "./SwitchToggle.vue";
import ChapterListPanel from "./ChapterListPanel.vue";
import FileListPanel from "./FileListPanel.vue";
import BookmarkListPanel from "./BookmarkListPanel.vue";

const props = withDefaults(
  defineProps<{
    activeTab: "files" | "chapters" | "bookmarks";
    chapters: Chapter[];
    files: TxtFileItem[];
    /** 来自 file.meta 的阅读进度映射（路径 key → 百分比） */
    metaProgressByPathKey?: Map<string, number>;
    /** 与 `files` 对应的 meta 行（分类、打开时间、排序用进度等） */
    fileMetaRecords?: readonly FileMetaRecord[];
    /** 当前打开文件的实时进度（%），滚动时更新 */
    liveReadingProgressPercent?: number;
    bookmarks: Array<{ line: number; note?: string; content: string }>;
    currentFilePath: string | null;
    activeChapterIdx: number;
    activeBookmarkLine?: number | null;
    showChapterCounts: boolean;
    formatCharCount: (n: number) => string;
    /** edge：滚入可见区；center：当前项在列表视口垂直居中（全屏浮动侧栏） */
    activeScrollMode?: "edge" | "center";
    /** 全屏浮动侧栏时章节列表不使用平滑滚动（避免与呼出动画叠加） */
    inFullscreen?: boolean;
    /** 章节列表当前项是否平滑滚入视口（由 App 在阅读滚动导致换章时置为 true） */
    chapterListScrollSmooth?: boolean;
    /** App 在需将当前章滚入视口/居中时置为 true（一拍后清除） */
    shouldCenterChapterList?: boolean;
    /** App 在需将文件列表滚到当前文件并居中时置为 true（一拍后清除） */
    shouldCenterFileList?: boolean;
    /** App 在需将书签列表滚到当前书签并居中时置为 true（一拍后清除） */
    shouldCenterBookmarkList?: boolean;
    fileCategory: string;
    fileSort: FileSortMode;
    fileCategoryCatalog: FileCategoryDefinition[];
  }>(),
  {
    inFullscreen: false,
    chapterListScrollSmooth: false,
    shouldCenterChapterList: false,
    shouldCenterFileList: false,
    shouldCenterBookmarkList: false,
    metaProgressByPathKey: () => new Map(),
    fileMetaRecords: () => [],
    liveReadingProgressPercent: undefined,
  },
);

const emit = defineEmits<{
  "update:activeTab": [value: "files" | "chapters" | "bookmarks"];
  "update:showChapterCounts": [value: boolean];
  "update:fileCategory": [value: string];
  "update:fileSort": [value: FileSortMode];
  pickDirectory: [];
  importDroppedPaths: [paths: string[]];
  openFile: [item: SidebarFileItem];
  jumpToChapter: [chapter: Chapter];
  jumpToBookmark: [line: number];
  clearFileList: [];
  removeFileList: [filePaths: string[]];
  closeCurrentFile: [];
  clearBookmarks: [];
  removeBookmarks: [lines: number[]];
  editBookmark: [line: number];
  removeBookmark: [line: number];
  persistUi: [];
  applyCategoryCatalog: [
    payload: {
      initial: CategoryEditorRow[];
      draft: CategoryEditorRow[];
      catalog: FileCategoryDefinition[];
    },
  ];
  setFilesCategory: [paths: string[], category: string];
}>();

const {
  chapterListRef,
  fileListRef,
  fileFilterQuery,
  fileRowsEnriched,
  filesFiltered,
  chaptersVisible,
  bookmarkListRef,
  bookmarksVisible,
  sidebarActiveLineNumber,
  onChapterItemClick,
  scrollFileListToIndex,
} = useReaderSidebarLists(props, (e, chapter) => emit(e, chapter));

function bindChapterListRef(value: any) {
  chapterListRef.value = value;
}
function bindFileListRef(value: any) {
  fileListRef.value = value;
}
function bindBookmarkListRef(value: any) {
  bookmarkListRef.value = value;
}

defineExpose({
  scrollFileListToIndex,
});
</script>

<template>
  <aside class="sidebar">
    <div class="sidebarHeader">
      <div class="tabs">
        <button
          class="tabBtn"
          :class="{ active: activeTab === 'files' }"
          @click="emit('update:activeTab', 'files')"
        >
          文件
        </button>
        <button
          class="tabBtn"
          :class="{ active: activeTab === 'chapters' }"
          @click="emit('update:activeTab', 'chapters')"
        >
          章节
        </button>
        <button
          class="tabBtn"
          :class="{ active: activeTab === 'bookmarks' }"
          @click="emit('update:activeTab', 'bookmarks')"
        >
          书签
        </button>
      </div>
      <button
        v-if="activeTab === 'files'"
        class="btn"
        @click="emit('pickDirectory')"
      >
        选择目录
      </button>
      <div v-else-if="activeTab === 'chapters'" class="sidebarCountToggle">
        <span class="sidebarCountToggleLabel">字数</span>
        <SwitchToggle
          size="sm"
          :model-value="showChapterCounts"
          aria-label="章节列表显示字数"
          @update:model-value="emit('update:showChapterCounts', $event)"
        />
      </div>
      <div v-else></div>
    </div>
    <ChapterListPanel
      v-show="activeTab === 'chapters'"
      :current-file-path="currentFilePath"
      :chapters-visible="chaptersVisible"
      :sidebar-active-line-number="sidebarActiveLineNumber"
      :show-chapter-counts="showChapterCounts"
      :format-char-count="formatCharCount"
      @jump-to-chapter="onChapterItemClick"
      @close-current-file="emit('closeCurrentFile')"
      @bind-list-ref="bindChapterListRef"
    />
    <FileListPanel
      v-show="activeTab === 'files'"
      :files="fileRowsEnriched"
      :files-filtered="filesFiltered"
      :file-filter-query="fileFilterQuery"
      :current-file-path="currentFilePath"
      :meta-progress-map="metaProgressByPathKey"
      :live-reading-progress-percent="liveReadingProgressPercent"
      :file-category="fileCategory"
      :file-sort="fileSort"
      :file-category-catalog="fileCategoryCatalog"
      @update-file-filter-query="fileFilterQuery = $event"
      @update:file-category="emit('update:fileCategory', $event)"
      @update:file-sort="emit('update:fileSort', $event)"
      @persist-ui="emit('persistUi')"
      @apply-category-catalog="emit('applyCategoryCatalog', $event)"
      @set-files-category="
        (paths, category) => emit('setFilesCategory', paths, category)
      "
      @open-file="(item: SidebarFileItem) => emit('openFile', item)"
      @clear-file-list="emit('clearFileList')"
      @remove-file-list="emit('removeFileList', $event)"
      @import-dropped-paths="emit('importDroppedPaths', $event)"
      @bind-list-ref="bindFileListRef"
    />
    <BookmarkListPanel
      v-show="activeTab === 'bookmarks'"
      :current-file-path="currentFilePath"
      :bookmarks="bookmarksVisible"
      :active-bookmark-line="activeBookmarkLine ?? null"
      @jump-to-bookmark="emit('jumpToBookmark', $event)"
      @clear-bookmarks="emit('clearBookmarks')"
      @edit-bookmark="emit('editBookmark', $event)"
      @remove-bookmark="emit('removeBookmark', $event)"
      @bind-list-ref="bindBookmarkListRef"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.sidebarHeader {
  background: var(--bg);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tabBtn {
  box-sizing: border-box;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--tab-fg);
  font-size: 12px;
  padding: 8px 10px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
}

.tabBtn:hover {
  color: var(--tab-fg-hover);
  background: transparent;
}

.tabBtn.active {
  color: var(--tab-fg-active);
  background: transparent;
  border-bottom: 2px solid var(--tab-underline);
  font-weight: 600;
}

.sidebarCountToggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sidebarCountToggleLabel {
  font-size: 12px;
  color: var(--tab-fg);
  white-space: nowrap;
}
</style>
