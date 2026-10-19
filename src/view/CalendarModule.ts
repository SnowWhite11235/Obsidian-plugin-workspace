/**
 * 月日历模块 - 本月 + 下月 并排显示，带活力三环
 *
 * 活力三环（类似 Apple Watch）：
 * - 外环（红色）：任务完成度
 * - 中环（绿色）：打卡完成度
 * - 内环（蓝色）：复盘完成度
 */

import { App } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import {
  toISODate,
  fromISODate,
  addMonths,
  getMonthGrid,
  today,
  WEEK_DAYS_ZH,
  MONTH_NAMES_ZH,
} from "../core/DateUtils";

interface DayStats {
  taskDone: number;
  taskTotal: number;
  habitDone: number;
  habitTotal: number;
  hasReview: boolean;
}

export class CalendarModule extends BaseModule {
  private viewDate: Date;

  constructor(app: App, plugin: LifePanelPlugin, container: HTMLElement, currentDate: string) {
    super(app, plugin, container, currentDate);
    this.viewDate = fromISODate(currentDate);
  }

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-calendar");

    // 月份导航
    const nav = c.createDiv({ cls: "lp-cal-nav" });
    const prevBtn = nav.createEl("button", { text: "‹", cls: "lp-cal-nav-btn" });
    nav.createDiv({
      cls: "lp-cal-title",
      text: `${this.viewDate.getFullYear()}年`,
    });
    const nextBtn = nav.createEl("button", { text: "›", cls: "lp-cal-nav-btn" });

    prevBtn.addEventListener("click", () => {
      this.viewDate = addMonths(this.viewDate, -2);
      this.render();
    });
    nextBtn.addEventListener("click", () => {
      this.viewDate = addMonths(this.viewDate, 2);
      this.render();
    });

    // 两个月份并排
    const wrapper = c.createDiv({ cls: "lp-cal-months" });
    this.renderMonth(wrapper, 0);
    this.renderMonth(wrapper, 1);
  }

  private renderMonth(parent: HTMLElement, offset: number) {
    const monthDate = addMonths(this.viewDate, offset);
    const monthBox = parent.createDiv({ cls: "lp-cal-month" });
    monthBox.createDiv({
      cls: "lp-cal-month-title",
      text: MONTH_NAMES_ZH[monthDate.getMonth()],
    });

    const table = monthBox.createEl("table", { cls: "lp-cal-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    for (const wd of WEEK_DAYS_ZH) {
      headerRow.createEl("th", { text: wd, cls: "lp-cal-th" });
    }

    const tbody = table.createEl("tbody");
    const days = getMonthGrid(monthDate.getFullYear(), monthDate.getMonth());
    const todayStr = today();
    const selectedStr = this.currentDate;

    for (let row = 0; row < 6; row++) {
      const tr = tbody.createEl("tr");
      for (let col = 0; col < 7; col++) {
        const day = days[row * 7 + col];
        const td = tr.createEl("td", { cls: "lp-cal-td" });
        const iso = toISODate(day);
        const inMonth = day.getMonth() === monthDate.getMonth();
        const isToday = iso === todayStr;
        const isSelected = iso === selectedStr;

        td.createEl("span", {
          text: String(day.getDate()),
          cls: "lp-cal-day-num",
        });

        // 活力三环
        if (inMonth) {
          this.renderActivityRings(td, iso);
        }

        if (!inMonth) td.addClass("lp-cal-day-out");
        if (isToday) td.addClass("lp-cal-day-today");
        if (isSelected) td.addClass("lp-cal-day-selected");

        td.addEventListener("click", () => {
          bus.emit({ type: "date-changed", date: iso });
        });
      }
    }
  }

  /** 渲染活力三环 SVG */
  private renderActivityRings(container: HTMLElement, dateStr: string) {
    const size = 28;
    const center = size / 2;
    const ringsContainer = container.createDiv({ cls: "lp-cal-rings" });

    this.loadDayStats(dateStr).then((stats) => {
      if (stats.taskTotal === 0 && stats.habitTotal === 0 && !stats.hasReview) {
        return; // 没有数据，不显示环
      }

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

      // 三环半径
      const r1 = 11; // 外环 - 任务
      const r2 = 7.5;  // 中环 - 打卡
      const r3 = 4;  // 内环 - 复盘

      // 背景环（灰色）
      svg.appendChild(this.createRing(center, r1, 2.5, "rgba(136, 136, 136, 0.2)"));
      svg.appendChild(this.createRing(center, r2, 2.5, "rgba(136, 136, 136, 0.2)"));
      svg.appendChild(this.createRing(center, r3, 2.5, "rgba(136, 136, 136, 0.2)"));

      // 任务完成度环（红色 #bf616a）
      const taskRatio = stats.taskTotal > 0 ? stats.taskDone / stats.taskTotal : 0;
      if (taskRatio > 0) {
        svg.appendChild(this.createArcRing(center, r1, 2.5, taskRatio, "#bf616a"));
      }

      // 打卡完成度环（绿色 #a3be8c）
      const habitRatio = stats.habitTotal > 0 ? stats.habitDone / stats.habitTotal : 0;
      if (habitRatio > 0) {
        svg.appendChild(this.createArcRing(center, r2, 2.5, habitRatio, "#a3be8c"));
      }

      // 复盘完成度环（蓝色 #5e81ac）
      const reviewRatio = stats.hasReview ? 1 : 0;
      if (reviewRatio > 0) {
        svg.appendChild(this.createArcRing(center, r3, 2.5, reviewRatio, "#5e81ac"));
      }

      ringsContainer.appendChild(svg);
    });
  }

  /** 创建完整的背景环 */
  private createRing(cx: number, r: number, strokeWidth: number, color: string): SVGElement {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cx));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width", String(strokeWidth));
    return circle;
  }

  /** 创建弧形进度环 */
  private createArcRing(
    cx: number,
    r: number,
    strokeWidth: number,
    ratio: number,
    color: string,
  ): SVGElement {
    const circumference = 2 * Math.PI * r;
    const dashLength = circumference * ratio;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cx));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width", String(strokeWidth));
    circle.setAttribute("stroke-dasharray", `${dashLength} ${circumference}`);
    circle.setAttribute("stroke-linecap", "round");
    // 从顶部开始
    circle.setAttribute("transform", `rotate(-90 ${cx} ${cx})`);
    return circle;
  }

  /** 加载某天的统计数据 */
  private async loadDayStats(dateStr: string): Promise<DayStats> {
    try {
      const { content } = await this.plugin.store.getDailyNote(dateStr);
      const tasksSection = this.extractSection(content, "## 今日任务");
      const inspSection = this.extractSection(content, "## 灵感");
      const reviewSection = this.extractSection(content, "## 每日复盘");

      const fm = this.plugin.store["parseFrontmatter"]
        ? this.plugin.store["parseFrontmatter"](content)
        : {};
      const habits = fm.habits || {};
      const activeHabits = this.plugin.settings.habits.filter((h) => {
        if (h.archived) return false;
        if (h.startDate && dateStr < h.startDate) return false;
        if (h.endDate && dateStr > h.endDate) return false;
        return true;
      });
      const habitDone = activeHabits.filter((h) => habits[h.name] === true).length;

      const taskLines = tasksSection ? tasksSection.split("\n").filter((l) => l.trim().startsWith("- [")) : [];
      const taskDone = taskLines.filter((l) => l.includes("[x]")).length;

      const hasReview = reviewSection ? reviewSection.trim().length > 0 : false;

      return {
        taskDone,
        taskTotal: taskLines.length,
        habitDone,
        habitTotal: activeHabits.length,
        hasReview,
      };
    } catch {
      return { taskDone: 0, taskTotal: 0, habitDone: 0, habitTotal: 0, hasReview: false };
    }
  }

  private extractSection(content: string, sectionHeader: string): string | null {
    const lines = content.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionHeader) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return null;
    const sectionLines: string[] = [];
    for (let i = start; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break;
      sectionLines.push(lines[i]);
    }
    return sectionLines.join("\n");
  }
}
