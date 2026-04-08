<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  nextTick,
} from "vue";
import * as monaco from "monaco-editor";
import kingHwaFontUrl from "../assets/KingHwa_OldSong1.0.ttf?url";
import { icons } from "../icons";
import {
  type ChapterStickyLine,
  ensureStickyChapterBarClickDisabled,
  registerChapterStickyScrollProviders,
} from "../monaco/chapterStickyScroll";
import {
  buildChapterTitleDecorations,
  setReaderSyntaxHighlightEnabled,
} from "../monaco/readerInlineDecorations";
import {
  READER_EDITOR_DEFAULT_FONT_FAMILY,
  READER_EDITOR_DEFAULT_FONT_SIZE,
  buildReaderEditorCreateOptions,
  buildReaderEditorFontSizeUpdate,
  buildReaderEditorLineHeightUpdate,
} from "../monaco/readerEditorOptions";
import {
  createTxtrTextMonarchLanguage,
  type TxtrMonarchHighlightOptions,
} from "../monaco/txtrTextMonarch";
import { installReaderScrollKeyHandler } from "../monaco/readerKeyScroll";
import {
  applyLeadIndentFullWidth,
  chapterTitleForDisplay,
  leadingWhitespaceColumnCount,
} from "../chapter";
import AppContextMenu from "./AppContextMenu.vue";
import {
  defaultCompressBlankLines,
  defaultMonacoAdvancedWrapping,
  defaultMonacoCustomHighlight,
  defaultTxtrDelimitedMatchCrossLine,
  defaultReaderLineHeightMultiple,
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  type ReaderSurfacePalette,
} from "../constants/appUi";
import { DEFAULT_HIGHLIGHT_COLORS_LIGHT } from "../constants/highlightColors";
import type { HighlightWordsByIndex } from "../stores/fileMetaStore";
import { floorReadingPercentFromScrollRatio } from "../utils/format";
import {
  hasModalOnStack,
  MODAL_STACK_BASE_Z_INDEX,
  subscribeModalStackChange,
} from "../utils/modalStack";

/** 低于 `AppModal` 蒙层（BASE 6000），避免盖住弹框 */
const HL_FLOAT_Z_INDEX = MODAL_STACK_BASE_Z_INDEX - 20;

const editorEl = ref<HTMLDivElement | null>(null);
const editorContextMenuOpen = ref(false);
const editorContextMenuX = ref(0);
const editorContextMenuY = ref(0);
/** 打开自定义复制菜单时固化的选区（右键在选区外时 Monaco 会先清选区，不能再依赖 getSelection） */
const editorContextMenuCopyRange = shallowRef<monaco.Range | null>(null);

const EDITOR_CONTEXT_MENU_ITEMS = [{ id: "copy", label: "复制" }] as const;
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);
const model = shallowRef<monaco.editor.ITextModel | null>(null);
/** 章节标题行内装饰（`buildChapterTitleDecorations` / `inlineClassName` 着色）；与 View Zone 留白无关 */
const chapterTitleDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
const hlTipVisible = ref(false);
const hlPickerVisible = ref(false);
const hlFloatTop = ref(0);
const hlFloatLeft = ref(0);
const hlPickerTop = ref(0);
const hlPickerLeft = ref(0);
const hlDraftText = ref("");
const hlFloatRootRef = ref<HTMLElement | null>(null);
/** 选区靠近阅读区上缘时为 true：笔尖与色盘改为在选区下方展开 */
const hlFloatOpenDownward = ref(false);

let removeHlGlobalListeners: (() => void) | null = null;
let unsubModalStack: (() => void) | null = null;
const builtInThemes = new Set(["vs", "vs-dark"]);
/** 行高 = round(fontSize * multiple)，由 App 持久化并同步 */
let lineHeightMultiple = defaultReaderLineHeightMultiple;
let currentFontFamily = READER_EDITOR_DEFAULT_FONT_FAMILY;

let chaptersSnapshot: ChapterStickyLine[] = [];

/** 上次已写入的章节标题行内装饰对应的「章节行号序列」键；相同时可跳过 `collection.set`（仅着色，不含留白） */
let lastChapterTitleDecorationsLineKey = "";

function chapterLineNumbersKey(lineNumbers: readonly number[]): string {
  return lineNumbers.join("\0");
}

const languageId = "txtr-text";
const globalKey = "__TXTR_MONACO_LANG_REGISTERED__";
let providersDisposables: monaco.IDisposable[] = [];

export type ReaderClearOptions = {
  /** 为 true 时表示即将流式加载新正文：换模后保持关闭 sticky，直到 `streamLoading` 变 false */
  keepStickyHiddenForStream?: boolean;
};

const props = withDefaults(
  defineProps<{
    monacoCustomHighlight?: boolean;
    /** 与「内容上色」同时生效：成对引号/括号是否允许跨行 */
    txtrDelimitedMatchCrossLine?: boolean;
    /** 为 true 时由数据层压缩空行并标准化章节留白（标题下 1 行；标题上 1 或 2 行取决于「保留一个空行」） */
    compressBlankLines?: boolean;
    /** Monaco 高级换行策略（wrappingStrategy: advanced） */
    monacoAdvancedWrapping?: boolean;
    /** 主进程流式读盘期间为 true；关闭 sticky 避免旧文件黏性标题在加载全程残留 */
    streamLoading?: boolean;
    /** 合并用户覆盖后的阅读器表面色（亮色 / 暗色） */
    readerSurfaceLight?: ReaderSurfacePalette;
    readerSurfaceDark?: ReaderSurfacePalette;
    /** 当前主题下的高亮色列表（与设置中亮/暗数组之一对应） */
    highlightColors?: string[];
    /** 当前打开文件的自定义高亮词（来自 file.meta） */
    highlightWordsByIndex?: HighlightWordsByIndex;
    /** 已打开文件路径；为空时不显示选区高亮入口 */
    readerFilePath?: string | null;
  }>(),
  {
    monacoCustomHighlight: defaultMonacoCustomHighlight,
    txtrDelimitedMatchCrossLine: defaultTxtrDelimitedMatchCrossLine,
    compressBlankLines: defaultCompressBlankLines,
    monacoAdvancedWrapping: defaultMonacoAdvancedWrapping,
    streamLoading: false,
    readerSurfaceLight: () => ({ ...defaultReaderPaletteLight }),
    readerSurfaceDark: () => ({ ...defaultReaderPaletteDark }),
    highlightColors: () => [...DEFAULT_HIGHLIGHT_COLORS_LIGHT],
    highlightWordsByIndex: undefined,
    readerFilePath: null,
  },
);

const emit = defineEmits<{
  probeLineChange: [probeLine: number, fromScroll?: boolean];
  viewportTopLineChange: [lineNumber: number];
  viewportEndLineChange: [lineNumber: number];
  viewportVisualProgressChange: [percent: number, atBottom: boolean];
  addHighlightTerm: [payload: { text: string; colorIndex: number }];
  removeHighlightTerm: [payload: { text: string }];
}>();

/** 用于行尾列 `col+1` 映射到下一折行时 `getOffsetForColumn` 返回异常（offHi ≤ offLo）的宽度回退 */
function charPixelWidthForHighlightAnchor(
  fi: monaco.editor.FontInfo,
  char: string,
): number {
  if (!char) return fi.typicalHalfwidthCharacterWidth;
  const cp = char.codePointAt(0)!;
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xac00 && cp <= 0xd7af)
  ) {
    return fi.typicalFullwidthCharacterWidth;
  }
  return fi.typicalHalfwidthCharacterWidth;
}

/**
 * 选区在视口中的锚点（几何最右侧一列字符的右缘）。
 * 不用 `getScrolledVisiblePosition(选区 end)`：终点常在行尾 maxColumn，换行时 Monaco 会映射到错误的视觉行。
 * 取 Range 几何末端前一列；水平位置用 `contentLeft + getOffsetForColumn - scrollLeft`（与 Monaco 内容坐标一致）。
 * 行尾时 `getOffsetForColumn(line, col+1)` 常落在下一折行行首（offHi≈0），导致 offHi&lt;offLo，须用字符估算宽度。
 */
function getSelectionEndViewportAnchor(): {
  selectionRightX: number;
  anchorTop: number;
  lineBottom: number;
} | null {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return null;
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return null;
  const dom = e.getDomNode();
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();

  const end = sel.getEndPosition();
  let line = end.lineNumber;
  let colBefore = end.column - 1;
  if (colBefore < 1) {
    if (line <= 1) return null;
    line -= 1;
    const maxCol = m.getLineMaxColumn(line);
    colBefore = Math.max(1, maxCol - 1);
  }

  const vp = e.getScrolledVisiblePosition({
    lineNumber: line,
    column: colBefore,
  });
  if (vp == null) return null;

  const layout = e.getLayoutInfo();
  const scrollLeft = e.getScrollLeft();
  const baseX = rect.left + layout.contentLeft - scrollLeft;

  const offLo = e.getOffsetForColumn(line, colBefore);
  const offHi = e.getOffsetForColumn(line, colBefore + 1);
  const fi = e.getOption(monaco.editor.EditorOption.fontInfo);
  const lastChar = m.getValueInRange(
    new monaco.Range(line, colBefore, line, colBefore + 1),
  );

  let rightInContent: number;
  if (offLo >= 0 && offHi > offLo) {
    rightInContent = offHi;
  } else if (offLo >= 0) {
    rightInContent = offLo + charPixelWidthForHighlightAnchor(fi, lastChar);
  } else {
    return null;
  }

  const selectionRightX = baseX + rightInContent;

  const top = rect.top + vp.top;
  const h = Math.max(1, vp.height);
  return {
    selectionRightX,
    anchorTop: top,
    lineBottom: top + h,
  };
}

const HL_TIP_H = 36;
const HL_FLOAT_GAP = 4;
const HL_READER_EDGE = 10;

/**
 * 根据阅读区上缘空间决定向上或向下展开，并写入 `hlFloatTop` / `hlPickerTop`。
 * `reserveSpaceForPicker`：仅展示笔尖时为 false，避免为色盘预留高度而把笔尖误摆到下方；打开色盘时为 true。
 */
function applyHighlightVerticalPlacement(
  anchor: {
    anchorTop: number;
    lineBottom: number;
  },
  opts?: { reserveSpaceForPicker?: boolean },
): void {
  const reservePicker = opts?.reserveSpaceForPicker ?? true;
  const dom = editor.value?.getDomNode();
  if (!dom) return;
  const er = dom.getBoundingClientRect();

  // 总共有多少行色块
  const totalRows = Math.ceil(props.highlightColors.length / 5);
  /** 色盘在「向上」模式时占用高度（用于判断是否顶到阅读区上缘） */
  const hlPanelEstHeightUp =
    /* padding */ 20 +
    /* color swatch width */ totalRows * 26 +
    /* color swatch gap */ (totalRows - 1) * 8 +
    /* remove row + gap */ (hlPickerShowRemoveRow.value ? 26 + 10 : 0);
  const tipTopIfUp = anchor.anchorTop - HL_TIP_H - HL_FLOAT_GAP;
  const cantFitTipUp = tipTopIfUp < er.top + HL_READER_EDGE;
  const cantFitPanelUp =
    anchor.anchorTop - hlPanelEstHeightUp < er.top + HL_READER_EDGE;
  hlFloatOpenDownward.value = cantFitTipUp || (reservePicker && cantFitPanelUp);

  if (hlFloatOpenDownward.value) {
    const below = anchor.lineBottom + HL_FLOAT_GAP;
    hlFloatTop.value = Math.min(
      Math.max(below, er.top + HL_READER_EDGE),
      window.innerHeight - HL_TIP_H - 6,
    );
    hlPickerTop.value = Math.max(below, er.top + HL_READER_EDGE);
  } else {
    hlFloatTop.value = Math.max(
      er.top + HL_READER_EDGE,
      anchor.anchorTop - HL_TIP_H - HL_FLOAT_GAP,
    );
    hlPickerTop.value = Math.max(6, anchor.anchorTop - 6);
  }
}

function findStoredHighlightColorIndex(term: string): number | null {
  const map = props.highlightWordsByIndex;
  if (!map || !term) return null;
  for (const [k, words] of Object.entries(map)) {
    if (words.some((w) => w === term)) {
      const idx = Number.parseInt(k, 10);
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
  }
  return null;
}

const hlPickerExistingColorIndex = computed(() => {
  if (!hlPickerVisible.value) return null;
  return findStoredHighlightColorIndex(hlDraftText.value.trim());
});

const hlPickerShowRemoveRow = computed(
  () => hlPickerExistingColorIndex.value !== null,
);

function getTxtrMonarchHighlightOptions(): TxtrMonarchHighlightOptions {
  return {
    enabled: props.monacoCustomHighlight,
    highlightColorsLength: props.highlightColors.length,
    highlightWordsByIndex: props.highlightWordsByIndex,
  };
}

/** 关键词或开关变化时更新 Monarch；会触发 TokenizationRegistry 失效并重算 token */
function applyTxtrMonarchTokenizer() {
  monaco.languages.setMonarchTokensProvider(
    languageId,
    createTxtrTextMonarchLanguage(
      getTxtrMonarchHighlightOptions(),
      props.txtrDelimitedMatchCrossLine,
    ),
  );
}

function closeHighlightFloatUi() {
  hlTipVisible.value = false;
  hlPickerVisible.value = false;
  hlDraftText.value = "";
}

/** 设为/取消关键词后：取消选区，光标落在原选区几何末端 */
function collapseMonacoSelectionToHighlightEnd() {
  const e = editor.value;
  if (!e) return;
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return;
  const end = sel.getEndPosition();
  e.setSelection(monaco.Selection.fromPositions(end, end));
  e.focus();
}

/** 笔尖右缘与选区右缘对齐；仅按笔尖宽度夹紧视口，不因色盘宽度左移笔尖 */
function placeHighlightFloatHorizontal(anchor: {
  selectionRightX: number;
}): void {
  const tipW = 36;
  // 每行最多显示 5 个色块
  const colorsPerRow = Math.min(5, props.highlightColors.length);
  const panelReserve =
    /* padding */ 24 +
    /* color swatch width */ colorsPerRow * 26 +
    /* color swatch gap */ (colorsPerRow - 1) * 8;
  const leftRaw = anchor.selectionRightX - tipW;
  hlFloatLeft.value = Math.max(
    6,
    Math.min(leftRaw, window.innerWidth - tipW - 6),
  );
  hlPickerLeft.value = Math.max(
    6,
    Math.min(leftRaw, window.innerWidth - panelReserve - 6),
  );
}

function updateHighlightTipFromSelection() {
  if (!props.monacoCustomHighlight) {
    closeHighlightFloatUi();
    return;
  }
  const e = editor.value;
  if (!e || !props.readerFilePath) {
    closeHighlightFloatUi();
    return;
  }
  const m = model.value;
  if (!m) {
    closeHighlightFloatUi();
    return;
  }
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) {
    closeHighlightFloatUi();
    return;
  }
  const raw = m.getValueInRange(sel);
  const trimmed = raw.trim();
  if (!trimmed) {
    closeHighlightFloatUi();
    return;
  }
  if (hlPickerVisible.value && trimmed !== hlDraftText.value.trim()) {
    closeHighlightFloatUi();
    return;
  }
  const anchor = getSelectionEndViewportAnchor();
  if (!anchor) {
    closeHighlightFloatUi();
    return;
  }
  placeHighlightFloatHorizontal(anchor);
  if (hlPickerVisible.value) {
    applyHighlightVerticalPlacement(anchor, { reserveSpaceForPicker: true });
    return;
  }
  applyHighlightVerticalPlacement(anchor, { reserveSpaceForPicker: false });
  hlTipVisible.value = true;
}

function openHighlightPicker(ev: PointerEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  if (!props.monacoCustomHighlight) return;
  const e = editor.value;
  const m = model.value;
  if (!e || !m || !props.readerFilePath) return;
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return;
  const text = m.getValueInRange(sel).trim();
  if (!text) return;
  hlDraftText.value = text;
  hlTipVisible.value = false;
  hlPickerVisible.value = true;
  const anchor = getSelectionEndViewportAnchor();
  if (!anchor) return;
  placeHighlightFloatHorizontal(anchor);
  applyHighlightVerticalPlacement(anchor, { reserveSpaceForPicker: true });
}

function removeHighlightKeywordFromPicker() {
  const t = hlDraftText.value.trim();
  if (!t) {
    closeHighlightFloatUi();
    return;
  }
  emit("removeHighlightTerm", { text: t });
  collapseMonacoSelectionToHighlightEnd();
  closeHighlightFloatUi();
}

function confirmHighlightColor(colorIndex: number) {
  if (
    colorIndex < 0 ||
    colorIndex >= props.highlightColors.length ||
    !Number.isFinite(colorIndex)
  ) {
    closeHighlightFloatUi();
    return;
  }
  const t = hlDraftText.value.trim();
  if (!t) {
    closeHighlightFloatUi();
    return;
  }
  emit("addHighlightTerm", { text: t, colorIndex });
  collapseMonacoSelectionToHighlightEnd();
  closeHighlightFloatUi();
}

watch(
  () => props.highlightColors,
  () => {
    applyReaderSyntaxFromProps();
  },
  { deep: true },
);

watch(
  () => props.highlightWordsByIndex,
  () => {
    applyTxtrMonarchTokenizer();
  },
  { deep: true },
);

watch([hlTipVisible, hlPickerVisible], () => {
  removeHlGlobalListeners?.();
  removeHlGlobalListeners = null;
  if (!hlTipVisible.value && !hlPickerVisible.value) return;
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closeHighlightFloatUi();
  };
  const onPtr = (ev: PointerEvent) => {
    const t = ev.target as Node | null;
    if (!t) return;
    const root = hlFloatRootRef.value;
    const ed = editor.value?.getDomNode();
    if (root?.contains(t)) return;
    // 点在编辑器内不关；点顶栏/侧栏/底栏等外面关
    if (ed?.contains(t)) return;
    closeHighlightFloatUi();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPtr, true);
  removeHlGlobalListeners = () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPtr, true);
  };
});

watch(
  () => props.monacoAdvancedWrapping,
  (advanced) => {
    setWrappingStrategyAdvanced(advanced);
  },
);

function syncStickyScrollToStreamState() {
  const ed = editor.value;
  if (!ed) return;
  ed.updateOptions({
    stickyScroll: { enabled: !props.streamLoading },
  });
}

watch(
  () => props.streamLoading,
  () => {
    syncStickyScrollToStreamState();
  },
);

/** 程序性滚动（跳转、复位等）期间，onDidScrollChange 仍触发，但不视为用户阅读滚动 */
let programmaticScrollDepth = 0;

function beginProgrammaticScroll() {
  programmaticScrollDepth++;
  window.setTimeout(() => {
    programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1);
  }, 500);
}

/** App 传入的主题名（vs / vs-dark），用于切换语法着色后重设 Monaco 主题 */
let lastAppThemeName = "vs";

/**
 * 读盘按固定字节分块时，CRLF 常被拆成上一块以 \\r 结尾、下一块以 \\n 开头。
 * 若分两次 applyEdits，Monaco 会对 \\r 与 \\n 各计一行，中间多出一行空行。
 * 故将末尾孤立的 \\r 暂存，与下一段拼接后再写入；流结束再刷出孤立的 \\r（经典 Mac 换行）。
 */
let streamCarriageReturnPending = false;

function appendText(text: string) {
  const m = model.value;
  if (!m) return;
  let t = text;
  if (streamCarriageReturnPending) {
    streamCarriageReturnPending = false;
    t = `\r${t}`;
  }
  if (t.endsWith("\r\n")) {
    // 完整 CRLF，直接写入
  } else if (t.endsWith("\r")) {
    streamCarriageReturnPending = true;
    t = t.slice(0, -1);
  }
  if (!t) return;
  const endPos = m.getPositionAt(m.getValueLength());
  m.applyEdits([
    {
      range: new monaco.Range(
        endPos.lineNumber,
        endPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: t,
    },
  ]);
}

/** 流式读盘结束后一次性写入正文（分块时不再逐块 append，避免重复着色与换行拼接问题） */
function setFullText(text: string) {
  streamCarriageReturnPending = false;
  model.value?.setValue(text);
}

function flushStreamCarriageReturn() {
  if (!streamCarriageReturnPending) return;
  streamCarriageReturnPending = false;
  const m = model.value;
  if (!m) return;
  const endPos = m.getPositionAt(m.getValueLength());
  m.applyEdits([
    {
      range: new monaco.Range(
        endPos.lineNumber,
        endPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: "\r",
    },
  ]);
}

/** 流结束时修正最后一行：无结尾换行时该行此前按原文缓冲，此处统一行首缩进 */
function normalizeLastLineLeadIndent() {
  const m = model.value;
  if (!m) return;
  const ln = m.getLineCount();
  if (ln < 1) return;
  const line = m.getLineContent(ln);
  const next = applyLeadIndentFullWidth(line);
  if (next === line) return;
  m.applyEdits([
    {
      range: new monaco.Range(ln, 1, ln, line.length + 1),
      text: next,
    },
  ]);
}

function clear(opts?: ReaderClearOptions) {
  streamCarriageReturnPending = false;
  lastChapterTitleDecorationsLineKey = "";
  chaptersSnapshot = [];

  const e = editor.value;
  const prevModel = model.value;
  chapterTitleDecorationsCollection.value?.clear();

  e?.updateOptions({ stickyScroll: { enabled: false } });

  if (e && prevModel) {
    const next = monaco.editor.createModel("", languageId);
    e.setModel(next);
    prevModel.dispose();
    model.value = next;
    chapterTitleDecorationsCollection.value = e.createDecorationsCollection();
    e.setPosition({ lineNumber: 1, column: 1 });
    e.setScrollTop(0);
    e.layout();
  } else {
    prevModel?.setValue("");
  }

  if (!opts?.keepStickyHiddenForStream) {
    syncStickyScrollToStreamState();
  }
}

function setChapters(chapters: ChapterStickyLine[]) {
  const m = model.value;
  const collection = chapterTitleDecorationsCollection.value;
  if (!m || !collection) return;

  chaptersSnapshot = chapters
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((c) => ({
      lineNumber: c.lineNumber,
      title: chapterTitleForDisplay(c.title),
    }));

  const maxLine = m.getLineCount();
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (const ch of chaptersSnapshot) {
    const ln = ch.lineNumber;
    if (ln < 1 || ln > maxLine) continue;
    const line = m.getLineContent(ln);
    const n = leadingWhitespaceColumnCount(line);
    if (n > 0) {
      edits.push({
        range: new monaco.Range(ln, 1, ln, n + 1),
        text: "",
      });
    }
  }
  if (edits.length > 0) {
    m.applyEdits(edits);
  }

  const maxAfter = m.getLineCount();
  for (const ch of chaptersSnapshot) {
    if (ch.title) continue;
    const ln = ch.lineNumber;
    if (ln < 1 || ln > maxAfter) continue;
    ch.title = chapterTitleForDisplay(m.getLineContent(ln));
  }
  for (const ch of chaptersSnapshot) {
    if (!ch.title) {
      ch.title = `第 ${ch.lineNumber} 行`;
    }
  }

  const sortedChapters = chaptersSnapshot
    .filter((c) => c.lineNumber >= 1 && c.lineNumber <= maxAfter)
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber);

  const lineKey = chapterLineNumbersKey(
    sortedChapters.map((c) => c.lineNumber),
  );
  if (lineKey !== lastChapterTitleDecorationsLineKey) {
    collection.set(buildChapterTitleDecorations(monaco, m, chaptersSnapshot));
    lastChapterTitleDecorationsLineKey = lineKey;
  }
}

function setTheme(themeName: string) {
  lastAppThemeName = themeName;
  if (themeName === "vs") {
    monaco.editor.setTheme("vs");
  } else if (builtInThemes.has(themeName)) {
    monaco.editor.setTheme(themeName);
  } else {
    monaco.editor.setTheme("vs-dark");
  }
}

function setFontSize(fontSize: number) {
  const e = editor.value;
  if (!e) return;
  e.updateOptions(
    buildReaderEditorFontSizeUpdate({
      fontSize,
      lineHeightMultiple,
    }),
  );
}

function setLineHeightMultiple(multiple: number) {
  lineHeightMultiple = multiple;
  const e = editor.value;
  if (!e) return;
  const fontSize = e.getOption(monaco.editor.EditorOption.fontSize);
  e.updateOptions(
    buildReaderEditorLineHeightUpdate({
      fontSize,
      lineHeightMultiple,
    }),
  );
}

function setWrappingStrategyAdvanced(advanced: boolean) {
  editor.value?.updateOptions({
    wrappingStrategy: advanced ? "advanced" : "simple",
  });
}

function setFontFamily(fontFamily: string) {
  const e = editor.value;
  if (!e) return;

  currentFontFamily = fontFamily;
  e.updateOptions({ fontFamily: currentFontFamily });

  // Ensure KingHwa webfont is loaded before applying to avoid fallback flashes.
  if (currentFontFamily.includes("KingHwa OldSong")) {
    const fontSize = e.getOption(monaco.editor.EditorOption.fontSize);
    void document.fonts?.load(`${fontSize}px "KingHwa OldSong"`).then(() => {
      e.updateOptions({ fontFamily: currentFontFamily });
    });
  }
}

function resetToTop() {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  e.setPosition({ lineNumber: 1, column: 1 });
  e.revealLineInCenter(1, monaco.editor.ScrollType.Smooth);
  e.setScrollTop(0, monaco.editor.ScrollType.Smooth);
  queueMicrotask(() => {
    try {
      e.setPosition({ lineNumber: 1, column: 1 });
      e.setScrollTop(0, monaco.editor.ScrollType.Smooth);
    } catch {
      // ignore
    }
  });
}

function jumpToLine(lineNumber: number, smooth = true) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = smooth
    ? monaco.editor.ScrollType.Smooth
    : monaco.editor.ScrollType.Immediate;
  e.layout();
  e.revealLineNearTop(line, scrollType);
  const top = e.getTopForLineNumber(line);
  // 勿再减 lineHeight：否则视口顶行会变成 line-1，恢复阅读位置/章节跳转都会「回退一行」
  e.setScrollTop(Math.max(0, top), scrollType);
  e.setPosition({ lineNumber: line, column: 1 });
  e.focus();
}

/**
 * 书签列表跳转：将目标行顶对齐视口顶后再向上偏移「一行高」像素，为黏性章节条留白；
 * 与物理行号 −1 不同，上一行若自动折行占多段高度时仍只减一行字高。
 * 不并入 {@link jumpToLine}，避免会话恢复/章节导航产生额外偏移。
 */
function jumpToBookmarkLine(lineNumber: number, smooth = true) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = smooth
    ? monaco.editor.ScrollType.Smooth
    : monaco.editor.ScrollType.Immediate;
  const lineHeightPx = e.getOption(monaco.editor.EditorOption.lineHeight);
  e.layout();
  e.revealLineNearTop(line, scrollType);
  const top = e.getTopForLineNumber(line);
  e.setScrollTop(Math.max(0, top - lineHeightPx), scrollType);
  e.setPosition({ lineNumber: line, column: 1 });
  e.focus();
}

/**
 * 视口内首行（Monaco 显示行号，1-based）。
 * 用于 `viewportDisplayLineToPhysicalLine`：滤空时必须为真实显示行，不得 +1，否则物理行号会错位。
 */
function getViewportTopLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  return r?.startLineNumber ?? 1;
}

/** 当前视口可见行跨度（end-start，最小为 0） */
function getViewportLineSpan(): number {
  const e = editor.value;
  if (!e) return 0;
  const r = e.getVisibleRanges()[0];
  if (!r) return 0;
  return Math.max(0, r.endLineNumber - r.startLineNumber);
}

function getAllText(): string {
  return model.value?.getValue() ?? "";
}

function getSelectedText(): string {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return "";
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return "";
  return m.getValueInRange(sel);
}

/** 仅在右键落点落在当前选区内（或命中隐藏 textarea）时提供复制菜单，避免在选区外右键仍出现「复制」 */
function contextMenuTargetInSelection(
  mouseEv: monaco.editor.IEditorMouseEvent,
  sel: monaco.Selection,
): boolean {
  const t = mouseEv.target;
  if (t.type === monaco.editor.MouseTargetType.TEXTAREA) {
    return true;
  }
  if (
    t.type === monaco.editor.MouseTargetType.CONTENT_TEXT ||
    t.type === monaco.editor.MouseTargetType.CONTENT_EMPTY
  ) {
    const pos = t.position;
    return pos != null && sel.containsPosition(pos);
  }
  return false;
}

function closeEditorContextMenu() {
  editorContextMenuOpen.value = false;
  editorContextMenuCopyRange.value = null;
}

function onEditorContextMenuSelect(id: string) {
  const range = editorContextMenuCopyRange.value;
  closeEditorContextMenu();
  if (id !== "copy") return;
  const m = model.value;
  if (!m || !range || range.isEmpty()) return;
  const text = m.getValueInRange(range);
  if (!text) return;
  void navigator.clipboard.writeText(text);
}

const FIND_CONTROLLER_ID = "editor.contrib.findController";

function toggleFindWidget() {
  const e = editor.value;
  if (!e) return;
  const findCtrl = e.getContribution(FIND_CONTROLLER_ID) as {
    getState?: () => { isRevealed: boolean };
    closeFindWidget?: () => void;
  } | null;
  const revealed = findCtrl?.getState?.().isRevealed === true;
  e.focus();
  if (revealed) {
    if (findCtrl?.closeFindWidget) {
      findCtrl.closeFindWidget();
      return;
    }
    e.getAction("closeFindWidget")?.run();
  } else {
    e.getAction("actions.find")?.run();
  }
}

function isFindWidgetRevealed(): boolean {
  const e = editor.value;
  if (!e) return false;
  const findCtrl = e.getContribution(FIND_CONTROLLER_ID) as {
    getState?: () => { isRevealed: boolean };
  } | null;
  return findCtrl?.getState?.().isRevealed === true;
}

function focusEditor() {
  editor.value?.focus();
}

function scrollByDeltaY(deltaY: number) {
  const e = editor.value;
  if (!e || !Number.isFinite(deltaY) || deltaY === 0) return;
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const nextTop = Math.max(0, Math.min(maxTop, e.getScrollTop() + deltaY));
  e.setScrollTop(nextTop, monaco.editor.ScrollType.Smooth);
}

/**
 * 将原生 wheel 交给 Monaco 内部滚动（与编辑区内触控板/滚轮一致）。
 * `delegateScrollFromMouseWheelEvent` 在运行时的 CodeEditorWidget 上存在，但未写入 monaco d.ts。
 */
function delegateEditorWheelFromBrowserEvent(ev: WheelEvent) {
  const e = editor.value;
  if (!e) return;
  const ed = e as monaco.editor.IStandaloneCodeEditor & {
    delegateScrollFromMouseWheelEvent?(browserEvent: WheelEvent): void;
  };
  ed.delegateScrollFromMouseWheelEvent?.(ev);
}

function scrollByLineStep(direction: -1 | 1) {
  const e = editor.value;
  if (!e) return;
  const lineHeight = Math.max(
    1,
    e.getOption(monaco.editor.EditorOption.lineHeight),
  );
  scrollByDeltaY(direction * lineHeight);
}

function scrollByPageStep(direction: -1 | 1) {
  const e = editor.value;
  if (!e) return;
  const lineHeight = Math.max(
    1,
    e.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const viewportHeight = Math.max(1, e.getLayoutInfo().height);
  // 预留两行，避免翻屏后阅读点跳得过猛。
  const step = Math.max(lineHeight, viewportHeight - lineHeight * 2);
  scrollByDeltaY(direction * step);
}

function scrollToBottom(smooth = false) {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  e.setScrollTop(
    maxTop,
    smooth
      ? monaco.editor.ScrollType.Smooth
      : monaco.editor.ScrollType.Immediate,
  );
}

function getScrollTop(): number {
  const e = editor.value;
  if (!e) return 0;
  return Math.max(0, e.getScrollTop());
}

/** 滚动到指定 scrollTop（可选平滑）；会钳制到当前可滚动范围 */
function scrollToScrollTop(scrollTop: number, smooth = true) {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const target = Math.max(0, Math.min(maxTop, scrollTop));
  e.setScrollTop(
    target,
    smooth
      ? monaco.editor.ScrollType.Smooth
      : monaco.editor.ScrollType.Immediate,
  );
  e.focus();
}

/**
 * 将指定行尽量贴到底部（近似 revealLineNearBottom）。
 * 通过行底像素 - 视口高度计算 scrollTop，避免“先按顶部跳转再减跨度”带来的累计漂移。
 */
function scrollLineToBottom(lineNumber: number, smooth = false) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = Math.max(1, m.getLineCount());
  const line = Math.max(1, Math.min(Math.floor(lineNumber), lineCount));
  const layoutH = Math.max(1, e.getLayoutInfo().height);
  const lineBottomPx =
    line >= lineCount ? e.getScrollHeight() : e.getTopForLineNumber(line + 1);
  const maxTop = Math.max(0, e.getScrollHeight() - layoutH);
  const targetTop = Math.max(0, Math.min(maxTop, lineBottomPx - layoutH));
  e.setScrollTop(
    targetTop,
    smooth
      ? monaco.editor.ScrollType.Smooth
      : monaco.editor.ScrollType.Immediate,
  );
  e.setPosition({ lineNumber: line, column: 1 });
}

/** 供 `colorTxt.file.meta` 持久化；深拷贝为可 JSON 序列化的纯对象 */
function getSerializedEditorViewState(): Record<string, unknown> | null {
  const e = editor.value;
  if (!e) return null;
  const vs = e.saveViewState();
  if (!vs) return null;
  try {
    return JSON.parse(JSON.stringify(vs)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function restoreEditorViewState(state: unknown): boolean {
  const e = editor.value;
  if (!e || state == null || typeof state !== "object") return false;
  beginProgrammaticScroll();
  try {
    e.restoreViewState(state as monaco.editor.ICodeEditorViewState);
    return true;
  } catch {
    return false;
  }
}

/** 与 `emitProbeLine` 相同的阅读探针行号（视口内约 3/4 处），1-based */
function getProbeLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  const fallbackLine = e.getPosition()?.lineNumber ?? 1;
  if (!r) return fallbackLine;
  const span = Math.max(0, r.endLineNumber - r.startLineNumber);
  return r.startLineNumber + Math.floor(span * 0.75);
}

/**
 * @param fromScroll 来自视口滚动（onDidScrollChange）；为 false 时表示光标/程序性同步等
 */
function emitProbeLine(fromScroll = false) {
  const e = editor.value;
  if (!e) return;
  const fromReadingScroll = fromScroll && programmaticScrollDepth === 0;
  const probeLine = getProbeLine();
  const r = e.getVisibleRanges()[0];
  const startLine = r ? Math.max(1, r.startLineNumber) : 1;
  const endLine = r ? Math.max(1, r.endLineNumber) : probeLine;
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const scrollTop = Math.max(0, e.getScrollTop());
  const atBottom = maxTop <= 0 ? true : scrollTop >= maxTop - 1;
  const percent =
    maxTop <= 0 ? 100 : floorReadingPercentFromScrollRatio(scrollTop / maxTop);
  emit("probeLineChange", probeLine, fromReadingScroll);
  emit("viewportTopLineChange", startLine);
  emit("viewportEndLineChange", endLine);
  emit("viewportVisualProgressChange", percent, atBottom);
}

defineExpose({
  appendText,
  setFullText,
  flushStreamCarriageReturn,
  normalizeLastLineLeadIndent,
  clear,
  setChapters,
  setTheme,
  setFontSize,
  setLineHeightMultiple,
  setFontFamily,
  setWrappingStrategyAdvanced,
  resetToTop,
  jumpToLine,
  jumpToBookmarkLine,
  emitProbeLine,
  getProbeLine,
  getViewportTopLine,
  getViewportLineSpan,
  getAllText,
  getSelectedText,
  toggleFindWidget,
  isFindWidgetRevealed,
  focusEditor,
  scrollByDeltaY,
  delegateEditorWheelFromBrowserEvent,
  scrollByLineStep,
  scrollByPageStep,
  scrollToBottom,
  scrollLineToBottom,
  getScrollTop,
  scrollToScrollTop,
  getSerializedEditorViewState,
  restoreEditorViewState,
});

function applyReaderSyntaxFromProps() {
  setReaderSyntaxHighlightEnabled(
    monaco,
    props.monacoCustomHighlight,
    props.readerSurfaceLight,
    props.readerSurfaceDark,
    props.highlightColors,
  );
  setTheme(lastAppThemeName);
}

watch(
  () => [props.monacoCustomHighlight, props.txtrDelimitedMatchCrossLine] as const,
  () => {
    applyReaderSyntaxFromProps();
    applyTxtrMonarchTokenizer();
    if (!props.monacoCustomHighlight) {
      closeHighlightFloatUi();
    }
  },
);

watch(
  () => [props.readerSurfaceLight, props.readerSurfaceDark] as const,
  () => {
    applyReaderSyntaxFromProps();
  },
  { deep: true },
);

onMounted(() => {
  // Register language + providers once (across HMR)。
  const g = globalThis as any;
  if (!g[globalKey]) {
    monaco.languages.register({ id: languageId });

    providersDisposables.push(
      registerChapterStickyScrollProviders(
        monaco,
        languageId,
        () => chaptersSnapshot,
      ),
    );

    g[globalKey] = true;
  }

  applyTxtrMonarchTokenizer();
  applyReaderSyntaxFromProps();

  const fontStyleId = "txtr-reader-kinghwa-font";
  if (!document.getElementById(fontStyleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = fontStyleId;
    styleEl.textContent = `
@font-face {
  font-family: "KingHwa OldSong";
  src: url("${kingHwaFontUrl}") format("truetype");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;
    document.head.appendChild(styleEl);
  }

  const m = monaco.editor.createModel("", languageId);
  model.value = m;

  ensureStickyChapterBarClickDisabled();

  editor.value = monaco.editor.create(editorEl.value!, {
    model: m,
    ...buildReaderEditorCreateOptions({
      fontSize: READER_EDITOR_DEFAULT_FONT_SIZE,
      lineHeightMultiple,
      fontFamily: currentFontFamily,
      wrappingStrategyAdvanced: props.monacoAdvancedWrapping,
    }),
  });
  chapterTitleDecorationsCollection.value =
    editor.value.createDecorationsCollection();

  const e = editor.value;
  if (e) {
    if (currentFontFamily.includes("KingHwa OldSong")) {
      void document.fonts
        ?.load(`${READER_EDITOR_DEFAULT_FONT_SIZE}px "KingHwa OldSong"`)
        .then(() => {
          e.updateOptions({ fontFamily: currentFontFamily });
        });
    }
    const d1 = e.onDidScrollChange(() => {
      closeHighlightFloatUi();
      emitProbeLine(true);
    });
    const d2 = e.onDidChangeCursorPosition(() => emitProbeLine(false));
    const dSel = e.onDidChangeCursorSelection(() => {
      void nextTick(() => updateHighlightTipFromSelection());
    });
    const d3 = installReaderScrollKeyHandler(monaco, e, {
      onSpacePageDown: () => scrollByPageStep(1),
    });
    const d4 = e.onContextMenu((mouseEv) => {
      const m = model.value;
      if (!m) return;
      const sel = e.getSelection();
      if (!sel || sel.isEmpty()) return;
      if (!contextMenuTargetInSelection(mouseEv, sel)) return;
      mouseEv.event.preventDefault();
      mouseEv.event.stopPropagation();
      editorContextMenuCopyRange.value = monaco.Range.lift(sel);
      editorContextMenuX.value = mouseEv.event.browserEvent.clientX;
      editorContextMenuY.value = mouseEv.event.browserEvent.clientY;
      editorContextMenuOpen.value = true;
    });
    onBeforeUnmount(() => {
      d1.dispose();
      d2.dispose();
      dSel.dispose();
      d3.dispose();
      d4.dispose();
    });

    syncStickyScrollToStreamState();
  }
});

onBeforeUnmount(() => {
  removeHlGlobalListeners?.();
  removeHlGlobalListeners = null;
  unsubModalStack?.();
  unsubModalStack = null;
  editor.value?.dispose();
  model.value?.dispose();
  for (const d of providersDisposables) d.dispose();
  providersDisposables = [];
});

watch(
  () => props.readerFilePath,
  () => {
    closeHighlightFloatUi();
  },
);

onMounted(() => {
  unsubModalStack = subscribeModalStackChange(() => {
    if (!hlTipVisible.value && !hlPickerVisible.value) return;
    if (hasModalOnStack()) closeHighlightFloatUi();
  });
});
</script>

<template>
  <main class="content">
    <div ref="editorEl" class="editorHost"></div>
    <div
      v-if="hlTipVisible || hlPickerVisible"
      ref="hlFloatRootRef"
      class="hlFloatRoot"
      :style="{ zIndex: HL_FLOAT_Z_INDEX }"
      aria-live="polite"
    >
      <div
        v-show="hlTipVisible"
        class="hlTip"
        :style="{ top: `${hlFloatTop}px`, left: `${hlFloatLeft}px` }"
      >
        <button
          type="button"
          class="hlTipBtn"
          aria-label="设置高亮词"
          title="设置高亮词"
          @pointerdown="openHighlightPicker"
        >
          <span
            class="hlTipIcon"
            aria-hidden="true"
            v-html="icons.highlightMark"
          ></span>
        </button>
      </div>
      <div
        v-show="hlPickerVisible"
        class="hlPicker"
        :class="{ hlPickerFlipDown: hlFloatOpenDownward }"
        :style="{ top: `${hlPickerTop}px`, left: `${hlPickerLeft}px` }"
      >
        <div v-if="hlPickerShowRemoveRow" class="hlSwatchRow hlPickerRemoveRow">
          <button
            type="button"
            class="hlSwatch hlRemoveKeyword"
            aria-label="移除该高亮词"
            title="移除该高亮词"
            @click="removeHighlightKeywordFromPicker"
          >
            <span
              class="hlRemoveKeywordInner"
              aria-hidden="true"
              v-html="icons.clear"
            ></span>
          </button>
        </div>
        <div class="hlSwatchRow">
          <button
            v-for="(c, i) in highlightColors"
            :key="i"
            type="button"
            class="hlSwatch"
            :class="{
              hlSwatchSelected:
                hlPickerExistingColorIndex === i &&
                hlPickerExistingColorIndex < highlightColors.length,
            }"
            :style="{ backgroundColor: c }"
            :aria-label="`使用高亮色 ${i + 1}`"
            :title="`高亮色 ${i + 1}`"
            :aria-pressed="
              hlPickerExistingColorIndex === i &&
              hlPickerExistingColorIndex < highlightColors.length
                ? 'true'
                : 'false'
            "
            @click="confirmHighlightColor(i)"
          ></button>
        </div>
      </div>
    </div>
    <AppContextMenu
      :open="editorContextMenuOpen"
      :x="editorContextMenuX"
      :y="editorContextMenuY"
      :items="EDITOR_CONTEXT_MENU_ITEMS"
      :min-width="120"
      @close="closeEditorContextMenu"
      @select="onEditorContextMenuSelect"
    />
  </main>
</template>

<style scoped>
.content {
  height: 100%;
  background: var(--reader-bg);
  overflow: hidden;
  min-height: 0;
  user-select: text;
}

.editorHost {
  height: 100%;
  width: 100%;
  overflow: hidden;
  user-select: text;
}

.hlFloatRoot {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.hlTip,
.hlPicker {
  position: fixed;
  pointer-events: auto;
}

.hlTipBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 2px 8px color-mix(in srgb, #000 12%, transparent);
  cursor: pointer;
}

.hlTipBtn:hover {
  filter: brightness(1.05);
}

.hlTipIcon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.hlTipIcon :deep(svg) {
  width: 22px;
  height: 22px;
  display: block;
}

.hlPicker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 200px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 4px 16px color-mix(in srgb, #000 18%, transparent);
  transform: translateY(calc(-100%));
}

.hlPicker.hlPickerFlipDown {
  transform: translateY(0);
}

.hlSwatchRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hlSwatch {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 2px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
}

.hlSwatch:hover {
  transform: scale(1.08);
}

.hlSwatch.hlSwatchSelected {
  border-color: var(--bg);
  box-shadow: 0 0 0 2px var(--accent);
}

.hlSwatch.hlRemoveKeyword {
  border: none;
  padding: 0;
  overflow: hidden;
  background: var(--bg);
}

.hlSwatch.hlRemoveKeyword .hlRemoveKeywordInner {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  pointer-events: none;
}

.hlSwatch.hlRemoveKeyword .hlRemoveKeywordInner :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.hlSwatch.hlRemoveKeyword .hlRemoveKeywordInner :deep(svg path) {
  fill: var(--danger);
}

:deep(.monaco-editor),
:deep(.monaco-editor *) {
  user-select: text;
}

:deep(.monaco-editor .cursor) {
  display: none !important;
}

:deep(.monaco-editor .wordHighlight),
:deep(.monaco-editor .wordHighlightStrong) {
  background: transparent !important;
}

/* 打开右键菜单时编辑器会失去 .focused，Monaco 会用 inactive 选区色变浅；统一为活动选区背景 */
:deep(.monaco-editor .selected-text) {
  background-color: var(--vscode-editor-selectionBackground) !important;
}

:deep(.monaco-editor .scroll-decoration) {
  box-shadow: none !important;
  display: none !important;
}

/* 与 chapterStickyScroll.CHAPTER_TITLE_LINE_CLASS（chapterTitleLine）一致 */
:deep(.monaco-editor .chapterTitleLine) {
  color: var(--reader-chapter-title) !important;
  font-size: 2em !important;
}
:deep(.monaco-editor span:has(> .chapterTitleLine)) {
  display: inline-block;
  transform-origin: left;
  transform: scale(0.6);
}
</style>
