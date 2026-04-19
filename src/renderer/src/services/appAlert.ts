import { nextTick, reactive } from "vue";

export const appAlertModel = reactive({
  open: false,
  title: "提示",
  message: "",
});

type Queued = { message: string; title: string; resolve: () => void };

const queue: Queued[] = [];

function pump() {
  const next = queue[0];
  if (!next) {
    appAlertModel.open = false;
    return;
  }
  appAlertModel.message = next.message;
  appAlertModel.title = next.title;
  appAlertModel.open = true;
}

/**
 * 应用内提示（蒙层 + 确定），全局单例由 `AppAlertHost` 渲染。
 * 可 `await appAlert('…')` 在用户点确定后继续；支持连续入队。
 */
export function appAlert(message: string, title = "提示"): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ message, title, resolve });
    if (!appAlertModel.open) {
      void nextTick(() => {
        if (appAlertModel.open) return;
        pump();
      });
    }
  });
}

/** 由 `AppAlertHost` 在用户关闭当前提示时调用 */
export function appAlertAcknowledged() {
  const done = queue.shift();
  done?.resolve();
  const next = queue[0];
  if (next) {
    appAlertModel.message = next.message;
    appAlertModel.title = next.title;
  } else {
    appAlertModel.open = false;
  }
}
