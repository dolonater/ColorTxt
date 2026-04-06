/**
 * 由 electron-vite 在构建时从 package.json `build.productName` 注入（缺省回退为顶层 `name`）。
 * 与 electron-builder 安装包/快捷方式展示名一致。
 */
declare const __APP_DISPLAY_NAME__: string;

export const APP_DISPLAY_NAME: string = __APP_DISPLAY_NAME__;
