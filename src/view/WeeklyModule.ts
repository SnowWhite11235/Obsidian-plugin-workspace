/**
 * 周打卡管理模块 - 表头周日期范围、分类行 × 日期列、勾选、复盘文本
 */

import { App, Notice } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import {
  toISODate,
  fromISODate,
  startOfWeek,
  addDays,
  weekKey,
  parseWeekKey,
  WEEK_DAYS_ZH,
} from "../core/DateUtils";

export class WeeklyModule extends BaseModule {
  private weekStartDate: Date;

  constructor(app: App, plugin: LifePanelPlugin, container: HTMLElement, currentDate: string) {
    super(app, plugin, container, currentDate);
    this.weekStartDate = startOfWeek(fromISODate(currentDate));
  }

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-weekly");

    // 周导航
    const nav = c.createDiv({ cls: "lp-weekly-nav" });
    const prevBtn = nav.createEl("button", { text: "‹", cls: "lp-weekly-nav-btn" });
    const titleEl = nav.createDiv({
      cls: "lp-weekly-title",
      text: `${weekKey(this.weekStartDate)}`,
    });
    const nextBtn = nav.createEl("button", { text: "›", cls: "lp-weekly-nav-btn" });

    prevBtn.addEventListener("click", () => {
      this.weekStartDate = addDays(this.weekStartDate, -7);
      this.render();
    });
    nextBtn.addEventListener("click", () => {
      this.weekStartDate = addDays(this.weekStartDate, 7);
      this.render();
    });

    // 表头：周一~周日
    const table = c.createEl("table", { cls: "lp-weekly-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "分类", cls: "lp-weekly-th" });
    for (let i = 0; i < 7; i++) {
      const day = addDays(this.weekStartDate, i);
      const th = headerRow.createEl("th", { cls: "lp-weekly-th" });
      th.createEl("div", { text: WEEK_DAYS_ZH[i], cls: "lp-weekly-day-name" });
      th.createEl("div", { text: `${day.getMonth() + 1}/${day.getDate()}`, cls: "lp-weekly-day-date" });
    }

    // 表体：分类 × 7天
    const tbody = table.createEl("tbody");
    const categories = this.plugin.settings.weeklyCategories;
    const weeklyData = await this.plugin.store.getWeeklyTasks(toISODate(this.weekStartDate));

    for (const cat of categories) {
      const row = tbody.createEl("tr");
      const catCell = row.createEl("td", { cls: "lp-weekly-cat-cell" });
      catCell.createEl("span", { text: cat.icon, cls: "lp-weekly-cat-icon" });
      catCell.createEl("span", { text: cat.name });

      const rowData = weeklyData[cat.name] || [null, null, null, null, null, null, null];
      for (let i = 0; i < 7; i++) {
        const cell = row.createEl("td", { cls: "lp-weekly-cell" });
        const state = rowData[i];
        const checkbox = cell.createEl("input", { type: "checkbox", cls: "lp-weekly-checkbox" });
        checkbox.checked = state === true;
        checkbox.addEventListener("change", async () => {
          const dayDate = addDays(this.weekStartDate, i);
          // 切换周打卡状态
          await this.plugin.store.toggleWeeklyTask(
            toISODate(this.weekStartDate),
            cat.name,
            i,
          );
          // 联动：同步到当日任务
          await this.plugin.store.syncWeeklyToDailyTask(
            toISODate(dayDate),
            cat.name,
            checkbox.checked,
          );
          this.render();
        });
      }
    }

    // 周复盘
    const reviewSection = c.createDiv({ cls: "lp-weekly-review" });
    reviewSection.createEl("h4", { text: "周复盘" });
    const reviewText = reviewSection.createEl("textarea", {
      cls: "lp-weekly-review-input",
      placeholder: "本周总结、反思、下周计划...",
    });
    reviewText.rows = 4;

    // 加载已有复盘
    const existingReview = await this.plugin.store.getWeeklyReview(toISODate(this.weekStartDate));
    reviewText.value = existingReview;

    const saveBtn = reviewSection.createEl("button", {
      text: "保存复盘",
      cls: "lp-weekly-save-btn",
    });
    saveBtn.addEventListener("click", async () => {
      await this.plugin.store.saveWeeklyReview(toISODate(this.weekStartDate), reviewText.value);
      new Notice("周复盘已保存");
    });
  }
}
