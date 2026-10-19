/**
 * 统计看板模块 - 简约风格
 */

import { App } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import {
  toISODate,
  fromISODate,
  addDays,
  today,
  startOfMonth,
} from "../core/DateUtils";

export class StatsModule extends BaseModule {
  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-stats");

    const weekStats = await this.calcWeekStats();
    const monthStats = await this.calcMonthStats();

    // 一行四个简约数字
    const items = [
      { label: "本周打卡", value: `${weekStats.habitDone}/${weekStats.habitTotal}` },
      { label: "本周任务", value: `${weekStats.taskDone}/${weekStats.taskTotal}` },
      { label: "本周专注", value: `${weekStats.focusMinutes}m` },
      { label: "本月打卡", value: `${monthStats.habitDone}/${monthStats.habitTotal}` },
    ];

    for (const item of items) {
      const card = c.createDiv({ cls: "lp-stat-card" });
      card.createEl("div", { text: item.label, cls: "lp-stat-title" });
      card.createEl("div", { text: item.value, cls: "lp-stat-value" });
    }
  }

  private async calcWeekStats() {
    const todayDate = fromISODate(today());
    const day = todayDate.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = addDays(todayDate, diffToMonday);
    const daysCount = Math.floor((todayDate.getTime() - monday.getTime()) / (24 * 3600 * 1000)) + 1;

    let habitDone = 0;
    let habitTotal = 0;
    let taskDone = 0;
    let taskTotal = 0;
    let focusMinutes = 0;

    for (let i = 0; i < daysCount; i++) {
      const d = addDays(monday, i);
      const dateStr = toISODate(d);
      try {
        const habits = await this.plugin.store.getHabits(dateStr);
        const tasks = await this.plugin.store.getTasks(dateStr);
        const focus = await this.plugin.store.getFocusMinutes(dateStr);
        const habitCount = Object.keys(habits).length;
        const habitChecked = Object.values(habits).filter(Boolean).length;
        habitDone += habitChecked;
        habitTotal += habitCount;
        taskDone += tasks.filter((t) => t.checked).length;
        taskTotal += tasks.length;
        focusMinutes += focus;
      } catch {
        // skip
      }
    }

    return { habitDone, habitTotal, taskDone, taskTotal, focusMinutes };
  }

  private async calcMonthStats() {
    const todayDate = fromISODate(today());
    const monthStart = startOfMonth(todayDate);
    const daysCount = todayDate.getDate();

    let habitDone = 0;
    let habitTotal = 0;

    for (let i = 0; i < daysCount; i++) {
      const d = addDays(monthStart, i);
      const dateStr = toISODate(d);
      try {
        const habits = await this.plugin.store.getHabits(dateStr);
        const habitCount = Object.keys(habits).length;
        const habitChecked = Object.values(habits).filter(Boolean).length;
        habitDone += habitChecked;
        habitTotal += habitCount;
      } catch {
        // skip
      }
    }

    return { habitDone, habitTotal };
  }
}
