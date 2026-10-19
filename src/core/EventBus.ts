/**
 * 简易事件总线 - 模块间通信（如日历切换日期通知任务模块）
 */

export type LifeEvent =
  | { type: "date-changed"; date: string }
  | { type: "week-changed"; weekKey: string }
  | { type: "data-updated"; scope: "day" | "week" | "habits" | "all"; date?: string }
  | { type: "task-toggled"; date: string; lineIndex: number }
  | { type: "focus-tick"; remaining: number };

type Listener = (e: LifeEvent) => void;

class EventBusImpl {
  private listeners: Listener[] = [];

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  emit(e: LifeEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error("[LifePanel EventBus] listener error:", err);
      }
    }
  }
}

export const bus = new EventBusImpl();
