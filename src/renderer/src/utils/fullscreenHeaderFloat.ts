import { FULLSCREEN_HEADER_FLOAT_SELECTOR } from "../constants/appUi";

/**
 * 沿 DOM / ShadowRoot.host 向上，判断是否落在 {@link FULLSCREEN_HEADER_FLOAT_SELECTOR} 内
 *（如 `AppModal` 全屏蒙层）。
 */
export function nodeIsUnderFullscreenHeaderFloat(start: Node | null): boolean {
  let cur: Node | null = start;
  while (cur) {
    if (cur instanceof Element) {
      if (cur.closest(FULLSCREEN_HEADER_FLOAT_SELECTOR)) return true;
    }
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) cur = root.host;
    else cur = cur.parentNode;
  }
  return false;
}
