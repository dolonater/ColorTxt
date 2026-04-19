import type { SidebarFileItem } from "../composables/useReaderSidebarLists";
import type { FileCategoryDefinition } from "../constants/fileCategories";
import {
  FILE_CATEGORY_FILTER_ALL,
  UNCATEGORIZED_LIST_BORDER_COLOR,
} from "../constants/fileCategories";
import { fileHistoryKey } from "../stores/recentHistoryStore";

export function fileRowProgressForPath(
  currentFilePath: string | null,
  liveReadingProgressPercent: number | undefined,
  metaProgressMap: Map<string, number>,
  filePath: string,
): number | undefined {
  if (
    currentFilePath === filePath &&
    typeof liveReadingProgressPercent === "number"
  ) {
    return liveReadingProgressPercent;
  }
  return metaProgressMap.get(fileHistoryKey(filePath));
}

export function isProgressComplete(progress: number | undefined): boolean {
  return typeof progress === "number" && progress >= 100;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, "")} GB`;
}

export function formatFileReadProgress(progress: number): string {
  return `${progress.toFixed(1).replace(/\.0$/, "")}%`;
}

export function borderColorForFile(
  f: SidebarFileItem,
  catalog: readonly FileCategoryDefinition[],
): string {
  const n = (f.category ?? "").trim();
  if (!n) return UNCATEGORIZED_LIST_BORDER_COLOR;
  const c = catalog.find((x) => x.name === n);
  return c?.color ?? UNCATEGORIZED_LIST_BORDER_COLOR;
}

export function fileItemShowCategoryMark(
  f: SidebarFileItem,
  fileCategory: string,
): boolean {
  if (fileCategory !== FILE_CATEGORY_FILTER_ALL) return false;
  return !!(f.category ?? "").trim();
}
