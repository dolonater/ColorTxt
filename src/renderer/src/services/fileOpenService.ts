import { fileHistoryKey } from "../stores/recentHistoryStore";
import type { TxtFileItem } from "./fileListService";

type FileStat = {
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
};

export async function prepareOpenFile(params: {
  filePath: string;
  txtFiles: TxtFileItem[];
  statFile: (filePath: string) => Promise<FileStat>;
  /**
   * 列表行上点击打开时传入**当前行**（`path` 须与 `filePath` 同源），直接用行内 `size`
   */
  listRow?: TxtFileItem;
}): Promise<
  { ok: true; fileSize: number | null } | { ok: false; message: string }
> {
  const { filePath, txtFiles, statFile, listRow } = params;

  const rowMatchesPath =
    listRow != null &&
    fileHistoryKey(listRow.path) === fileHistoryKey(filePath);

  const hintedInList =
    rowMatchesPath &&
    typeof listRow.size === "number" &&
    Number.isFinite(listRow.size) &&
    listRow.size >= 0;

  const fromList = hintedInList
    ? undefined
    : txtFiles.find((f) => fileHistoryKey(f.path) === fileHistoryKey(filePath));
  let fallbackStat: FileStat | null = null;

  try {
    fallbackStat = fromList || hintedInList ? null : await statFile(filePath);
  } catch {
    return { ok: false, message: `文件不存在或不可访问：${filePath}` };
  }

  if (
    !fromList &&
    !hintedInList &&
    fallbackStat &&
    !fallbackStat.isFile &&
    !fallbackStat.isDirectory
  ) {
    return { ok: false, message: `文件不存在或不可访问：${filePath}` };
  }

  return {
    ok: true,
    fileSize: hintedInList
      ? listRow!.size
      : (fromList?.size ?? fallbackStat?.size ?? null),
  };
}
