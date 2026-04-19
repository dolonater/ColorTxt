import { ref, type Ref } from "vue";
export type FileListMenusEmit = {
  (e: "setFilesCategory", paths: string[], category: string): void;
  (e: "removeFileList", filePaths: string[]): void;
};

export function useFileListMenus(
  emit: FileListMenusEmit,
  selection: {
    isEditingFileList: Ref<boolean>;
    selectedFilePaths: Ref<string[]>;
    lastSelectedFilePath: Ref<string | null>;
    footerCategoryBtnRef: Ref<HTMLButtonElement | null>;
    clearEditSelectionState: () => void;
    onRemoveSelectedFileListItems: () => void;
    selectAllVisible: () => void;
    invertSelectionVisible: () => void;
    selectSinglePathForContextMenu: (filePath: string) => void;
  },
) {
  const fileContextMenuOpen = ref(false);
  const fileContextMenuX = ref(0);
  const fileContextMenuY = ref(0);
  const fileContextMenuFilePath = ref<string | null>(null);
  const fileContextMenuItems = [
    { id: "reveal", label: "在文件管理器中显示" },
  ];

  const editContextMenuOpen = ref(false);
  const editContextMenuX = ref(0);
  const editContextMenuY = ref(0);
  const editCategorySubOpen = ref(false);

  const categoryPickerOpen = ref(false);
  const categoryPickX = ref(0);
  const categoryPickY = ref(0);
  const categoryPickFromFooter = ref(false);

  function closeFileContextMenu() {
    fileContextMenuOpen.value = false;
    fileContextMenuFilePath.value = null;
  }

  function closeEditContextMenu() {
    editContextMenuOpen.value = false;
    editCategorySubOpen.value = false;
  }

  function closeCategoryPicker() {
    categoryPickerOpen.value = false;
  }

  /** 全屏浮动侧栏收起等场景：关掉所有挂到 `body` 的文件列表菜单 */
  function dismissAllTeleportMenus() {
    closeFileContextMenu();
    closeEditContextMenu();
    closeCategoryPicker();
  }

  function openCategoryPickerAt(x: number, y: number, fromFooter: boolean) {
    categoryPickX.value = x;
    categoryPickY.value = y;
    categoryPickFromFooter.value = fromFooter;
    categoryPickerOpen.value = true;
  }

  function onFooterCategoryClick(ev: MouseEvent) {
    ev.preventDefault();
    if (selection.selectedFilePaths.value.length === 0) return;
    const btn = selection.footerCategoryBtnRef.value;
    if (btn) {
      const r = btn.getBoundingClientRect();
      openCategoryPickerAt(r.left, r.top, true);
    }
  }

  function onEditMenuCategoryPicked(name: string) {
    emit("setFilesCategory", selection.selectedFilePaths.value.slice(), name);
    closeEditContextMenu();
  }

  function onCategoryPicked(name: string) {
    emit("setFilesCategory", selection.selectedFilePaths.value.slice(), name);
    closeCategoryPicker();
  }

  function onFileItemContextMenu(filePath: string, ev: MouseEvent) {
    ev.preventDefault();
    if (selection.isEditingFileList.value) {
      if (!selection.selectedFilePaths.value.includes(filePath)) {
        selection.selectSinglePathForContextMenu(filePath);
      }
      editContextMenuX.value = ev.clientX;
      editContextMenuY.value = ev.clientY;
      editContextMenuOpen.value = true;
      closeFileContextMenu();
      return;
    }
    fileContextMenuFilePath.value = filePath;
    fileContextMenuX.value = ev.clientX;
    fileContextMenuY.value = ev.clientY;
    fileContextMenuOpen.value = true;
    closeEditContextMenu();
  }

  function onFileContextMenuSelect(actionId: string) {
    const filePath = fileContextMenuFilePath.value;
    if (!filePath) return;
    if (actionId === "reveal") {
      void window.colorTxt.showItemInFolder(filePath).catch(() => {});
    }
    closeFileContextMenu();
  }

  function onEditMenuRemove() {
    selection.onRemoveSelectedFileListItems();
    closeEditContextMenu();
  }

  function onEditMenuSelectAll() {
    selection.selectAllVisible();
    closeEditContextMenu();
  }

  function onEditMenuInvert() {
    selection.invertSelectionVisible();
    closeEditContextMenu();
  }

  function exitEditFileListMode() {
    selection.clearEditSelectionState();
    closeEditContextMenu();
    closeCategoryPicker();
  }

  function setEditCategorySubOpen(open: boolean) {
    editCategorySubOpen.value = open;
  }

  return {
    fileContextMenuOpen,
    fileContextMenuX,
    fileContextMenuY,
    fileContextMenuFilePath,
    fileContextMenuItems,
    editContextMenuOpen,
    editContextMenuX,
    editContextMenuY,
    editCategorySubOpen,
    categoryPickerOpen,
    categoryPickX,
    categoryPickY,
    categoryPickFromFooter,
    closeFileContextMenu,
    closeEditContextMenu,
    closeCategoryPicker,
    dismissAllTeleportMenus,
    onFooterCategoryClick,
    onEditMenuCategoryPicked,
    onCategoryPicked,
    onFileItemContextMenu,
    onFileContextMenuSelect,
    onEditMenuRemove,
    onEditMenuSelectAll,
    onEditMenuInvert,
    exitEditFileListMode,
    setEditCategorySubOpen,
  };
}
