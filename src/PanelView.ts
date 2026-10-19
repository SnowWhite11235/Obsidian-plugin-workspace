/**
 * 主面板视图 - 右侧栏常驻 + 可全屏标签页
 *
 * 模块支持拖拽排序，顺序持久化到 settings.moduleOrder
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type LifePanelPlugin from "./main";
import { CalendarModule } from "./view/CalendarModule";
import { WeekCalendarModule } from "./view/WeekCalendarModule";
import { InspirationModule } from "./view/InspirationModule";
import { ReviewModule } from "./view/ReviewModule";
import { PomodoroModule } from "./view/PomodoroModule";
import { StatsModule } from "./view/StatsModule";
import { RecentModule } from "./view/RecentModule";
import { bus } from "./core/EventBus";
import { today } from "./core/DateUtils";

export const PANEL_VIEW_TYPE = "life-panel-view";
export const PANEL_FULLSCREEN_VIEW_TYPE = "life-panel-fullscreen";

/** 模块元数据定义 */
interface ModuleMeta {
  id: string;
  name: string;
  icon: string;
}

/** 所有可用模块（id 固定，顺序由 settings.moduleOrder 决定） */
const ALL_MODULES: ModuleMeta[] = [
  { id: "calendar", name: "月日历", icon: "calendar" },
  { id: "week-calendar", name: "周日历", icon: "calendar-days" },
  { id: "inspiration", name: "每日灵感", icon: "lightbulb" },
  { id: "review", name: "每日复盘", icon: "note-pen" },
  { id: "pomodoro", name: "番茄钟", icon: "timer" },
  { id: "stats", name: "统计看板", icon: "bar-chart-3" },
  { id: "recent", name: "最近文件", icon: "clock" },
];

/** 模块折叠状态（运行时，不持久化） */
const collapsedState: Record<string, boolean> = {};

export class PanelView extends ItemView {
  private currentDate: string = today();
  /** 当前渲染顺序的模块 id 列表 */
  private order: string[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: LifePanelPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "生活面板";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen() {
    this.render();
    bus.on((e) => {
      if (e.type === "date-changed") {
        this.currentDate = e.date;
        this.refreshDayDependentModules();
      }
    });
  }

  async onClose() {}

  /** 获取当前模块顺序：优先用 settings.moduleOrder，否则用默认 */
  private getModuleOrder(): string[] {
    const saved = this.plugin.settings.moduleOrder;
    if (saved && saved.length > 0) {
      // 过滤掉不存在的 id，补上新增的 id
      const valid = saved.filter((id) => ALL_MODULES.some((m) => m.id === id));
      for (const m of ALL_MODULES) {
        if (!valid.includes(m.id)) valid.push(m.id);
      }
      return valid;
    }
    return ALL_MODULES.map((m) => m.id);
  }

  private render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("life-panel-container");

    // 顶部日期切换条
    const header = container.createDiv({ cls: "life-panel-header" });
    header.createEl("span", {
      cls: "life-panel-date-label",
      text: this.formatDateLabel(this.currentDate),
    });
    const headerActions = header.createDiv({ cls: "life-panel-header-actions" });
    const todayBtn = headerActions.createEl("button", {
      cls: "life-panel-today-btn",
      text: "今天",
    });
    todayBtn.addEventListener("click", () => {
      bus.emit({ type: "date-changed", date: today() });
    });
    const refreshBtn = headerActions.createEl("button", {
      cls: "life-panel-refresh-btn",
      text: "⟳",
      attr: { title: "刷新" },
    });
    refreshBtn.addEventListener("click", () => {
      this.render();
    });

    // 获取模块顺序
    this.order = this.getModuleOrder();

    // 创建模块容器
    const modulesContainer = container.createDiv({ cls: "life-panel-modules" });

    // 渲染每个模块
    for (const moduleId of this.order) {
      const meta = ALL_MODULES.find((m) => m.id === moduleId);
      if (!meta) continue;

      const section = modulesContainer.createDiv({ cls: "life-panel-section" });
      section.dataset.moduleId = moduleId;

      // 拖拽手柄
      const headerEl = section.createDiv({ cls: "life-panel-section-header" });
      headerEl.createEl("span", {
        cls: "life-panel-drag-handle",
        text: "⠿",
        attr: { title: "拖拽排序" },
      });
      headerEl.createEl("span", {
        cls: "life-panel-section-title",
        text: meta.name,
      });

      const isCollapsed = collapsedState[moduleId] || false;
      const collapseIcon = headerEl.createEl("span", {
        cls: "life-panel-collapse-icon",
        text: isCollapsed ? "▶" : "▼",
      });
      const body = section.createDiv({ cls: "life-panel-section-body" });
      if (isCollapsed) body.style.display = "none";

      // 折叠/展开（点击 header 区域，但避开拖拽手柄）
      headerEl.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("life-panel-drag-handle")) return;
        collapsedState[moduleId] = !collapsedState[moduleId];
        body.style.display = collapsedState[moduleId] ? "none" : "";
        collapseIcon.textContent = collapsedState[moduleId] ? "▶" : "▼";
      });

      // 拖拽排序
      this.setupDragAndDrop(section, headerEl);

      // 渲染模块内容
      this.renderModuleById(moduleId, body);
    }
  }

  /** 根据 moduleId 渲染对应模块 */
  private renderModuleById(moduleId: string, body: HTMLElement) {
    body.empty();
    switch (moduleId) {
      case "calendar":
        new CalendarModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "week-calendar":
        new WeekCalendarModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "inspiration":
        new InspirationModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "review":
        new ReviewModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "pomodoro":
        new PomodoroModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "stats":
        new StatsModule(this.app, this.plugin, body, this.currentDate).render();
        break;
      case "recent":
        new RecentModule(this.app, this.plugin, body, this.currentDate).render();
        break;
    }
  }

  /** 设置拖拽排序 */
  private setupDragAndDrop(section: HTMLElement, headerEl: HTMLElement) {
    // 让 header 可拖拽
    headerEl.draggable = true;

    let dragSrcId: string | null = null;

    headerEl.addEventListener("dragstart", (e) => {
      dragSrcId = section.dataset.moduleId || null;
      section.addClass("life-panel-section-dragging");
      e.dataTransfer?.setData("text/plain", dragSrcId || "");
      e.dataTransfer!.effectAllowed = "move";
    });

    headerEl.addEventListener("dragend", () => {
      section.removeClass("life-panel-section-dragging");
      // 清理所有 drag-over 样式
      this.contentEl.querySelectorAll(".life-panel-section-drag-over").forEach((el) => {
        el.removeClass("life-panel-section-drag-over");
      });
    });

    section.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      if (section.dataset.moduleId !== dragSrcId) {
        section.addClass("life-panel-section-drag-over");
      }
    });

    section.addEventListener("dragleave", () => {
      section.removeClass("life-panel-section-drag-over");
    });

    section.addEventListener("drop", (e) => {
      e.preventDefault();
      section.removeClass("life-panel-section-drag-over");
      const srcId = e.dataTransfer?.getData("text/plain") || dragSrcId;
      const dstId = section.dataset.moduleId;
      if (!srcId || !dstId || srcId === dstId) return;

      // 重新排序
      const newOrder = [...this.order];
      const srcIdx = newOrder.indexOf(srcId);
      const dstIdx = newOrder.indexOf(dstId);
      if (srcIdx < 0 || dstIdx < 0) return;

      newOrder.splice(srcIdx, 1);
      newOrder.splice(dstIdx, 0, srcId);

      // 更新顺序并持久化
      this.order = newOrder;
      this.plugin.settings.moduleOrder = newOrder;
      this.plugin.saveSettings();

      // 重新渲染
      this.render();
    });
  }

  private refreshDayDependentModules() {
    // 重新渲染所有模块
    const modulesContainer = this.contentEl.querySelector(".life-panel-modules");
    if (!modulesContainer) return;

    const sections = modulesContainer.querySelectorAll(".life-panel-section");
    sections.forEach((section) => {
      const moduleId = (section as HTMLElement).dataset.moduleId;
      const body = section.querySelector(".life-panel-section-body") as HTMLElement;
      if (moduleId && body) {
        this.renderModuleById(moduleId, body);
      }
    });

    // 更新顶部日期标签
    const label = this.contentEl.querySelector(".life-panel-date-label");
    if (label) label.textContent = this.formatDateLabel(this.currentDate);
  }

  private formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${d.getFullYear()}年${monthNames[d.getMonth()]}${d.getDate()}日 ${dayNames[d.getDay()]}`;
  }

  refresh() {
    this.render();
  }
}
