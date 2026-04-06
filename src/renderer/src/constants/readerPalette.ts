/**
 * 阅读器表面色（背景、章节标题、Monaco txtr.* token）。
 * 默认值与历史 readerInlineDecorations / style.css 一致；日后用户自定义可在此类型上做 Partial 合并。
 */
export type ReaderSurfacePalette = {
  readerBg: string;
  chapterTitle: string;
  txtrQuoteInner: string;
  txtrBracketInner: string;
  txtrPunctuation: string;
  txtrSpecialMarker: string;
  txtrNumber: string;
  txtrEnglish: string;
};

export const defaultReaderPaletteLight: ReaderSurfacePalette = {
  readerBg: "#f4ead7",
  chapterTitle: "#b88230",
  txtrQuoteInner: "#a31515",
  txtrBracketInner: "#001080",
  txtrPunctuation: "#267f99",
  txtrSpecialMarker: "#f56c6c",
  txtrNumber: "#795e26",
  txtrEnglish: "#af00db",
};

export const defaultReaderPaletteDark: ReaderSurfacePalette = {
  readerBg: "#1e1e1e",
  chapterTitle: "#569cd6",
  txtrQuoteInner: "#ce9178",
  txtrBracketInner: "#9cdcfe",
  txtrPunctuation: "#4ec9b0",
  txtrSpecialMarker: "#f56c6c",
  txtrNumber: "#dcdcaa",
  txtrEnglish: "#c586c0",
};

/**
 * 将当前 App 主题对应的阅读器变量写入 `document.documentElement`，供 `var(--reader-bg)` 等使用。
 * 仅处理 `vs` / `vs-dark`。
 */
export function applyReaderSurfaceToDocument(theme: string): void {
  if (theme !== "vs" && theme !== "vs-dark") return;
  const p =
    theme === "vs" ? defaultReaderPaletteLight : defaultReaderPaletteDark;
  const root = document.documentElement;
  root.style.setProperty("--reader-bg", p.readerBg);
  root.style.setProperty("--reader-chapter-title", p.chapterTitle);
}
