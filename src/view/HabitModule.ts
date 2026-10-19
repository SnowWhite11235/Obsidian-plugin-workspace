/**
 * 每日打卡模块 - 习惯列表 + 一键打卡 + streak 显示
 */

import { App } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import { toISODate } from "../core/DateUtils";

export class HabitModule extends BaseModule {
  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-habits");

    const habits = this.plugin.settings.habits;
    const habitStates = await this.plugin.store.getHabits(this.currentDate);

    const grid = c.createDiv({ cls: "lp-habit-grid" });

    for (const habit of habits) {
      const isChecked = !!habitStates[habit.name];
      const card = grid.createDiv({
        cls: `lp-habit-card ${isChecked ? "lp-habit-done" : ""}`,
      });

      const iconEl = card.createEl("span", {
        text: habit.icon,
        cls: "lp-habit-icon",
      });

      const nameEl = card.createEl("span", {
        text: habit.name,
        cls: "lp-habit-name",
      });

      // streak
      const streak = await this.plugin.store.getHabitStreak(habit.name);
      const streakEl = card.createEl("span", {
        text: streak > 0 ? `🔥${streak}` : "",
        cls: "lp-habit-streak",
      });

      card.addEventListener("click", async () => {
        await this.plugin.store.toggleHabit(this.currentDate, habit.name);
        this.render();
        bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
      });
    }
  }
}
