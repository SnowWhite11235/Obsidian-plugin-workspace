/**
 * obsidian-life-panel 主入口
 *
 * 生活管理面板：月日历、任务、打卡、灵感、复盘、番茄钟、统计
 */

import { Plugin, WorkspaceLeaf, Notice, Modal } from "obsidian";
import { LifePanelSettings, DEFAULT_SETTINGS, Priority, normalizeHabitType } from "./core/types";
import { DataStore } from "./core/DataStore";
import { ConfigManager } from "./core/ConfigManager";
import { LifePanelSettingTab } from "./settings";
import { PanelView, PANEL_VIEW_TYPE, PANEL_FULLSCREEN_VIEW_TYPE } from "./PanelView";
import { today, nowHM } from "./core/DateUtils";

export default class LifePanelPlugin extends Plugin {
  settings!: LifePanelSettings;
  store!: DataStore;
  configManager!: ConfigManager;

  async onload() {
    await this.loadSettings();
    this.store = new DataStore(this.app, this.settings);
    this.configManager = new ConfigManager(this.app, this.settings);

    this.registerView(PANEL_VIEW_TYPE, (leaf) => new PanelView(leaf, this));
    this.registerView(PANEL_FULLSCREEN_VIEW_TYPE, (leaf) => new PanelView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "生活面板", () => {
      this.activatePanel();
    });

    this.addCommand({
      id: "open-life-panel",
      name: "打开/关闭面板",
      callback: () => this.togglePanel(),
    });

    this.addCommand({
      id: "open-life-panel-fullscreen",
      name: "全屏打开",
      callback: () => this.activateFullscreen(),
    });

    this.addCommand({
      id: "add-task",
      name: "添加今日任务",
      callback: () => this.quickAddTask(),
    });

    this.addCommand({
      id: "add-inspiration",
      name: "快速记录灵感",
      callback: () => this.quickAddInspiration(),
    });

    this.addCommand({
      id: "toggle-habit",
      name: "打卡",
      callback: () => this.quickToggleHabit(),
    });

    this.addCommand({
      id: "reload-config",
      name: "重新加载配置文件",
      callback: () => this.reloadConfig(),
    });

    this.addCommand({
      id: "open-config",
      name: "打开配置文件",
      callback: () => this.openConfigFile(),
    });

    this.addSettingTab(new LifePanelSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.activatePanel();
      this.applyTheme();
      // 从配置文件加载
      this.loadFromConfig();
    });
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      loaded,
      {
        habits: loaded?.habits ?? DEFAULT_SETTINGS.habits,
        archivedHabits: loaded?.archivedHabits ?? [],
        weeklyCategories: loaded?.weeklyCategories ?? DEFAULT_SETTINGS.weeklyCategories,
        reviewQuestions: loaded?.reviewQuestions ?? DEFAULT_SETTINGS.reviewQuestions,
        taskTemplates: loaded?.taskTemplates ?? DEFAULT_SETTINGS.taskTemplates,
        moduleOrder: loaded?.moduleOrder ?? DEFAULT_SETTINGS.moduleOrder,
      },
    );
    // 迁移：给旧习惯补上 daysOfWeek 字段，并归一化 habitType
    for (const h of this.settings.habits) {
      if (!h.daysOfWeek || h.daysOfWeek.length === 0) {
        h.daysOfWeek = [1, 2, 3, 4, 5, 6, 7];
      }
      h.habitType = normalizeHabitType(h.habitType as string);
    }
    for (const h of this.settings.archivedHabits) {
      if (!h.daysOfWeek || h.daysOfWeek.length === 0) {
        h.daysOfWeek = [1, 2, 3, 4, 5, 6, 7];
      }
      h.habitType = normalizeHabitType(h.habitType as string);
    }
    // 立即保存归一化后的设置
    await this.saveData(this.settings);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.store.updateSettings(this.settings);
    this.configManager.settings = this.settings;
    this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof PanelView) view.refresh();
    });
    this.app.workspace.getLeavesOfType(PANEL_FULLSCREEN_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof PanelView) view.refresh();
    });
  }

  /** 从配置文件加载设置 */
  async loadFromConfig() {
    try {
      new Notice("正在加载配置文件...");
      const config = await this.configManager.loadConfig();
      new Notice(`配置已加载：${config.habits.length} 个习惯`);
      if (config.habits.length > 0) {
        this.settings.habits = config.habits;
      }
      if (config.reviewQuestions.length > 0) {
        this.settings.reviewQuestions = config.reviewQuestions;
      }
      this.settings.pomodoroFocus = config.pomodoroFocus;
      this.settings.pomodoroBreak = config.pomodoroBreak;
      await this.saveSettings();
    } catch (e) {
      console.warn("[LifePanel] 配置文件加载失败:", e);
      new Notice("配置文件加载失败：" + (e as Error).message);
    }
  }

  /** 重新加载配置文件 */
  async reloadConfig() {
    await this.loadFromConfig();
    new Notice("配置文件已重新加载");
  }

  /** 打开配置文件 */
  async openConfigFile() {
    const file = await this.configManager.ensureConfigFile();
    await this.app.workspace.openLinkText(file.path, "", false);
  }

  async activatePanel() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0] || null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async togglePanel() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(PANEL_VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
    } else {
      await this.activatePanel();
    }
  }

  async activateFullscreen() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(PANEL_FULLSCREEN_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.setActiveLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    if (leaf) await leaf.setViewState({ type: PANEL_FULLSCREEN_VIEW_TYPE, active: true });
  }

  private quickAddTask() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("添加今日任务");

    const input = modal.contentEl.createEl("input", {
      type: "text",
      placeholder: "任务内容，可带 #标签",
      cls: "lp-modal-input",
    });
    input.style.width = "100%";
    input.style.marginBottom = "10px";

    const prioritySelect = modal.contentEl.createEl("select", { cls: "lp-modal-input" });
    prioritySelect.createEl("option", { value: "none", text: "无优先级" });
    prioritySelect.createEl("option", { value: "highest", text: "P1 最高" });
    prioritySelect.createEl("option", { value: "high", text: "P2 高" });
    prioritySelect.createEl("option", { value: "medium", text: "P3 中" });
    prioritySelect.createEl("option", { value: "low", text: "P4 低" });

    const addBtn = modal.contentEl.createEl("button", {
      text: "添加",
      cls: "lp-modal-save-btn",
    });

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const tags: string[] = [];
      const tagRe = /(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(text)) !== null) tags.push(`#${m[1]}`);
      const cleanDesc = text.replace(/(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g, "").trim();
      await this.store.addTask(today(), {
        description: cleanDesc,
        priority: prioritySelect.value as Priority,
        tags,
        checked: false,
      });
      new Notice("任务已添加");
      modal.close();
    };

    addBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    modal.open();
    setTimeout(() => input.focus(), 50);
  }

  private quickAddInspiration() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("快速记录灵感");

    const textarea = modal.contentEl.createEl("textarea", {
      placeholder: "💡 写下你的灵感...",
      cls: "lp-modal-input",
    });
    textarea.rows = 4;
    textarea.style.width = "100%";
    textarea.style.marginBottom = "10px";

    const addBtn = modal.contentEl.createEl("button", {
      text: "记录",
      cls: "lp-modal-save-btn",
    });

    const submit = async () => {
      const text = textarea.value.trim();
      if (!text) return;
      await this.store.addInspiration(today(), text, nowHM());
      new Notice("灵感已记录 💡");
      modal.close();
    };

    addBtn.addEventListener("click", submit);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    });

    modal.open();
    setTimeout(() => textarea.focus(), 50);
  }

  private quickToggleHabit() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("打卡");

    const list = modal.contentEl.createDiv({ cls: "lp-habit-quick-list" });
    for (const habit of this.settings.habits) {
      const item = list.createDiv({ cls: "lp-habit-quick-item" });
      item.createEl("span", { text: habit.icon });
      item.createEl("span", { text: habit.name });
      item.addEventListener("click", async () => {
        await this.store.toggleHabit(today(), habit.name);
        new Notice(`${habit.icon} ${habit.name} 已打卡`);
        modal.close();
      });
    }

    modal.open();
  }

  applyTheme() {
    const body = document.body;
    body.classList.remove("lp-theme-light", "lp-theme-dark");
    if (this.settings.theme === "light") body.classList.add("lp-theme-light");
    else if (this.settings.theme === "dark") body.classList.add("lp-theme-dark");
  }
}
