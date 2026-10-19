/**
 * 番茄钟模块 - 25/5 倒计时、关联当日任务、专注时长统计
 *
 * 布局：左半番茄钟，右半「昨天写的今天的重点」
 */

import { App, Notice } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import { ParsedTask } from "../core/types";
import { toISODate, fromISODate, addDays, today } from "../core/DateUtils";

type TimerState = "idle" | "focusing" | "break";

export class PomodoroModule extends BaseModule {
  private timerState: TimerState = "idle";
  private remaining: number = 0;
  private intervalId: number | null = null;
  private completedPomodoros: number = 0;
  private selectedTaskIndex: number = -1;
  private currentTasks: ParsedTask[] = [];

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-pomodoro");

    // 左右两栏布局
    const left = c.createDiv({ cls: "lp-pomo-left" });
    const right = c.createDiv({ cls: "lp-pomo-right" });

    // === 左栏：番茄钟 ===
    // 加载当天任务
    this.currentTasks = await this.plugin.store.getTasks(this.currentDate);

    // 任务选择器
    const taskSelector = left.createDiv({ cls: "lp-pomo-task-selector" });
    const select = taskSelector.createEl("select", { cls: "lp-pomo-task-select" });
    select.createEl("option", { value: "-1", text: "选择关联任务..." });
    for (let i = 0; i < this.currentTasks.length; i++) {
      const t = this.currentTasks[i];
      const suffix = t.focusMinutes > 0 ? ` 🍅${t.focusMinutes}m` : "";
      select.createEl("option", { value: String(i), text: t.description + suffix });
    }
    if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < this.currentTasks.length) {
      select.value = String(this.selectedTaskIndex);
    }

    select.addEventListener("change", () => {
      this.selectedTaskIndex = parseInt(select.value, 10);
      this.render();
    });

    // 显示倒计时
    const display = left.createDiv({ cls: "lp-pomo-display" });
    display.createEl("span", {
      text: this.formatTime(this.remaining || this.plugin.settings.pomodoroFocus * 60),
      cls: "lp-pomo-time",
    });
    display.createEl("span", {
      text: this.getStateLabel(),
      cls: "lp-pomo-state",
    });

    // 当前关联任务
    if (this.selectedTaskIndex >= 0 && this.currentTasks[this.selectedTaskIndex]) {
      display.createEl("div", {
        text: `🎯 ${this.currentTasks[this.selectedTaskIndex].description}`,
        cls: "lp-pomo-current-task",
      });
    }

    // 控制按钮
    const controls = left.createDiv({ cls: "lp-pomo-controls" });
    const startBtn = controls.createEl("button", {
      text: this.timerState === "idle" ? "开始" : "暂停",
      cls: "lp-pomo-btn lp-pomo-start",
    });
    const stopBtn = controls.createEl("button", {
      text: "停止",
      cls: "lp-pomo-btn lp-pomo-stop",
    });
    const resetBtn = controls.createEl("button", {
      text: "重置",
      cls: "lp-pomo-btn lp-pomo-reset",
    });

    startBtn.addEventListener("click", async () => {
      if (this.timerState === "idle") {
        this.startFocus();
      } else {
        await this.recordElapsed();
        this.pause();
      }
      this.render();
    });

    stopBtn.addEventListener("click", async () => {
      await this.recordElapsed();
      this.stop();
      this.render();
    });

    resetBtn.addEventListener("click", () => {
      this.reset();
      this.render();
    });

    // 统计
    const focusMinutes = await this.plugin.store.getFocusMinutes(this.currentDate);
    left.createDiv({
      cls: "lp-pomo-stats",
      text: `今日专注 ${focusMinutes}m · 完成 ${this.completedPomodoros} 个`,
    });

    // === 右栏：昨天写的今天的重点 ===
    right.createDiv({ cls: "lp-pomo-focus-title", text: "昨天的今天的重点" });
    const content = await this.getYesterdayFocus();
    if (content) {
      right.createDiv({ cls: "lp-pomo-focus-content", text: content });
    } else {
      right.createDiv({
        cls: "lp-pomo-focus-empty",
        text: "昨天没有记录重点",
      });
    }
  }

  /** 读取昨天 daily note 的复盘章节中「明天的重点」 */
  private async getYesterdayFocus(): Promise<string | null> {
    const todayStr = this.currentDate;
    const yesterdayStr = toISODate(addDays(fromISODate(todayStr), -1));
    try {
      const review = await this.plugin.store.getReview(yesterdayStr);
      // 找包含「明天」的 key
      for (const [q, a] of Object.entries(review)) {
        if (q.includes("明天") || q.includes("重点")) {
          if (a && a.trim()) return a.trim();
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 记录已专注的时间到关联任务和今日专注 */
  private async recordElapsed(): Promise<void> {
    if (this.timerState !== "focusing") return;

    const totalSec = this.plugin.settings.pomodoroFocus * 60;
    const elapsedSec = totalSec - this.remaining;
    const elapsedMin = Math.round(elapsedSec / 60);

    if (elapsedMin > 0) {
      await this.plugin.store.addFocusMinutes(this.currentDate, elapsedMin);

      if (this.selectedTaskIndex >= 0 && this.currentTasks[this.selectedTaskIndex]) {
        await this.plugin.store.addTaskFocusMinutes(
          this.currentDate,
          this.currentTasks[this.selectedTaskIndex].lineIndex,
          elapsedMin,
        );
        new Notice(`🍅 已专注 ${elapsedMin} 分钟，记录到任务`);
      } else {
        new Notice(`🍅 已专注 ${elapsedMin} 分钟`);
      }
    }
  }

  private startFocus() {
    this.timerState = "focusing";
    this.remaining = this.plugin.settings.pomodoroFocus * 60;
    this.startTicker();
  }

  private startBreak() {
    this.timerState = "break";
    this.remaining = this.plugin.settings.pomodoroBreak * 60;
    this.startTicker();
  }

  private startTicker() {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = window.setInterval(() => {
      this.remaining--;
      const timeEl = this.container.querySelector(".lp-pomo-time");
      if (timeEl) timeEl.textContent = this.formatTime(this.remaining);
      if (this.remaining <= 0) {
        this.completePhase();
      }
    }, 1000);
  }

  private pause() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.timerState = "idle";
  }

  private stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.timerState = "idle";
    this.remaining = 0;
  }

  private reset() {
    this.stop();
    this.remaining = this.plugin.settings.pomodoroFocus * 60;
  }

  private async completePhase() {
    if (this.timerState === "focusing") {
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.timerState = "idle";

      const focusMin = this.plugin.settings.pomodoroFocus;
      await this.plugin.store.addFocusMinutes(this.currentDate, focusMin);
      this.completedPomodoros++;

      if (this.selectedTaskIndex >= 0 && this.currentTasks[this.selectedTaskIndex]) {
        await this.plugin.store.addTaskFocusMinutes(
          this.currentDate,
          this.currentTasks[this.selectedTaskIndex].lineIndex,
          focusMin,
        );
      }

      new Notice(`🍅 专注完成！+${focusMin} 分钟。开始休息 ${this.plugin.settings.pomodoroBreak} 分钟`);
      this.startBreak();
    } else if (this.timerState === "break") {
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.timerState = "idle";
      new Notice("休息结束，开始下一个专注");
      this.startFocus();
    }
    this.render();
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(Math.max(0, seconds) / 60);
    const s = Math.max(0, seconds) % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  private getStateLabel(): string {
    switch (this.timerState) {
      case "focusing": return "专注中";
      case "break": return "休息中";
      default: return "待开始";
    }
  }
}
