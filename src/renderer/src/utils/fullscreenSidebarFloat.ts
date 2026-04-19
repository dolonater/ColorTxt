import { FULLSCREEN_SIDEBAR_FLOAT_SELECTOR } from "../constants/appUi";

/**
 * 沿 DOM / ShadowRoot.host 向上，判断是否落在带 {@link FULLSCREEN_SIDEBAR_FLOAT_SELECTOR} 的浮层内
 *（侧栏文件列表 Teleport 到 body 的下拉/菜单）。
 */
export function nodeIsUnderFullscreenSidebarFloat(start: Node | null): boolean {
  let cur: Node | null = start;
  while (cur) {
    if (cur instanceof Element) {
      if (cur.closest(FULLSCREEN_SIDEBAR_FLOAT_SELECTOR)) return true;
    }
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) cur = root.host;
    else cur = cur.parentNode;
  }
  return false;
}
