/**
 * 当日任务模块 - 优先级排序、标签筛选、拖拽排序、任务模板
 *
 * 任务语法兼容 obsidian-tasks-plugin：
 *   - [ ] 任务内容 🔺 #work 📅 2026-10-18
 *   优先级：🔺最高 ⏫高 🔼中 🔽低
 */

import { App, Modal, Notice } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import { ParsedTask, Priority } from "../core/types";
import {
  parseTasksFromText,
  serializeTask,
  PRIORITY_ORDER,
  PRIORITY_LABEL,
} from "../core/TaskParser";

export class DailyTaskModule extends BaseModule {
  private tasks: ParsedTask[] = [];
  private allTags: string[] = [];
  private selectedTag: string | null = null;
  private sortByPriority = true;

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-tasks");

    await this.loadTasks();

    // 输入框
    const inputContainer = c.createDiv({ cls: "lp-task-input-container" });
    const input = inputContainer.createEl("input", {
      type: "text",
      placeholder: "添加任务，回车确认...",
      cls: "lp-task-input",
    });
    const prioritySelect = inputContainer.createEl("select", { cls: "lp-task-priority-select" });
    prioritySelect.createEl("option", { value: "none", text: "无优先级" });
    prioritySelect.createEl("option", { value: "highest", text: "P1 最高" });
    prioritySelect.createEl("option", { value: "high", text: "P2 高" });
    prioritySelect.createEl("option", { value: "medium", text: "P3 中" });
    prioritySelect.createEl("option", { value: "low", text: "P4 低" });

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        await this.addTask(input.value.trim(), prioritySelect.value as Priority);
        input.value = "";
      }
    });

    // 任务模板快捷按钮
    const templates = this.plugin.settings.taskTemplates;
    if (templates.length > 0) {
      const tmplContainer = c.createDiv({ cls: "lp-task-templates" });
      tmplContainer.createEl("span", {
        text: "快捷添加：",
        cls: "lp-task-templates-label",
      });
      for (const tmpl of templates) {
        const btn = tmplContainer.createEl("button", {
          text: tmpl,
          cls: "lp-task-template-btn",
        });
        btn.addEventListener("click", async () => {
          await this.addTaskFromTemplate(tmpl);
        });
      }
    }

    // 工具栏：标签筛选 + 排序
    const toolbar = c.createDiv({ cls: "lp-task-toolbar" });
    const tagsContainer = toolbar.createDiv({ cls: "lp-task-tags" });
    const allTagsBtn = tagsContainer.createEl("button", {
      text: "全部",
      cls: `lp-task-tag-btn ${!this.selectedTag ? "active" : ""}`,
    });
    allTagsBtn.addEventListener("click", () => {
      this.selectedTag = null;
      this.render();
    });

    for (const tag of this.allTags) {
      const btn = tagsContainer.createEl("button", {
        text: tag,
        cls: `lp-task-tag-btn ${this.selectedTag === tag ? "active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.selectedTag = tag;
        this.render();
      });
    }

    const sortBtn = toolbar.createEl("button", {
      text: this.sortByPriority ? "↑ 按优先级" : "↕ 原顺序",
      cls: "lp-task-sort-btn",
    });
    sortBtn.addEventListener("click", () => {
      this.sortByPriority = !this.sortByPriority;
      this.render();
    });

    // 任务列表
    const list = c.createDiv({ cls: "lp-task-list" });
    let displayTasks = [...this.tasks];
    if (this.selectedTag) {
      displayTasks = displayTasks.filter((t) => t.tags.includes(this.selectedTag!));
    }
    if (this.sortByPriority) {
      displayTasks.sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? 1 : -1;
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
    }

    if (displayTasks.length === 0) {
      list.createDiv({
        cls: "lp-empty-state",
        text: "暂无任务，添加一个开始吧 🎯",
      });
    }

    for (const task of displayTasks) {
      const taskEl = this.renderTaskItem(task, list);
      list.appendChild(taskEl);
    }
  }

  private renderTaskItem(task: ParsedTask, list: HTMLElement): HTMLElement {
    const item = document.createElement("div");
    item.addClass("lp-task-item");
    item.draggable = true;
    if (task.checked) item.addClass("lp-task-done");

    const checkbox = item.createEl("input", { type: "checkbox", cls: "lp-task-checkbox" });
    checkbox.checked = task.checked;
    checkbox.addEventListener("change", async () => {
      await this.plugin.store.toggleTask(this.currentDate, task.lineIndex);
      // 联动：同步到周打卡管理
      const updatedTasks = await this.plugin.store.getTasks(this.currentDate);
      const updatedTask = updatedTasks.find((t) => t.lineIndex === task.lineIndex);
      if (updatedTask) {
        await this.plugin.store.syncDailyTaskToWeekly(this.currentDate, updatedTask);
      }
      await this.loadTasks();
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
    });

    if (task.priority !== "none") {
      const prioEl = item.createEl("span", {
        text: PRIORITY_LABEL[task.priority],
        cls: `lp-task-priority lp-prio-${task.priority}`,
      });
    }

    const desc = item.createDiv({ cls: "lp-task-desc", text: task.description });
    if (task.checked) {
      desc.style.textDecoration = "line-through";
      desc.style.opacity = "0.6";
    }

    const tagsEl = item.createDiv({ cls: "lp-task-tags-inline" });
    for (const tag of task.tags) {
      tagsEl.createEl("span", { text: tag, cls: "lp-task-tag-inline" });
    }

    if (task.dueDate) {
      item.createEl("span", {
        text: `📅 ${task.dueDate}`,
        cls: "lp-task-due",
      });
    }

    const actions = item.createDiv({ cls: "lp-task-actions" });
    const editBtn = actions.createEl("button", { text: "✏️", cls: "lp-task-action-btn" });
    editBtn.addEventListener("click", () => {
      this.openEditModal(task);
    });

    const deleteBtn = actions.createEl("button", { text: "🗑️", cls: "lp-task-action-btn" });
    deleteBtn.addEventListener("click", async () => {
      await this.plugin.store.deleteTask(this.currentDate, task.lineIndex);
      await this.loadTasks();
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
    });

    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", String(task.lineIndex));
      item.addClass("lp-task-dragging");
    });
    item.addEventListener("dragend", () => {
      item.removeClass("lp-task-dragging");
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.addClass("lp-task-drag-over");
    });
    item.addEventListener("dragleave", () => {
      item.removeClass("lp-task-drag-over");
    });
    item.addEventListener("drop", async (e) => {
      e.preventDefault();
      item.removeClass("lp-task-drag-over");
      const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "-1", 10);
      if (fromIdx < 0) return;
      const toIdx = task.lineIndex;
      if (fromIdx === toIdx) return;
      await this.plugin.store.reorderTasks(this.currentDate, fromIdx, toIdx);
      await this.loadTasks();
      this.render();
    });

    return item;
  }

  private async loadTasks() {
    this.tasks = await this.plugin.store.getTasks(this.currentDate);
    const tagSet = new Set<string>();
    for (const t of this.tasks) {
      for (const tag of t.tags) tagSet.add(tag);
    }
    this.allTags = Array.from(tagSet).sort();
  }

  private async addTask(description: string, priority: Priority) {
    const tags: string[] = [];
    const tagRe = /(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(description)) !== null) {
      tags.push(`#${m[1]}`);
    }
    const cleanDesc = description.replace(/(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g, "").trim();

    await this.plugin.store.addTask(this.currentDate, {
      description: cleanDesc,
      priority,
      tags,
      checked: false,
    });
    await this.loadTasks();
    this.render();
    bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
  }

  private async addTaskFromTemplate(template: string) {
    // 解析模板中的优先级和标签
    let priority: Priority = "none";
    const prioMatch = template.match(/⭐️P([1-4])/);
    if (prioMatch) {
      const prioMap: Record<string, Priority> = {
        "1": "highest",
        "2": "high",
        "3": "medium",
        "4": "low",
      };
      priority = prioMap[prioMatch[1]] || "none";
    }

    const tags: string[] = [];
    const tagRe = /(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(template)) !== null) {
      tags.push(`#${m[1]}`);
    }

    // 清理描述：移除优先级标记和标签
    let cleanDesc = template
      .replace(/⭐️P[1-4]/g, "")
      .replace(/(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g, "")
      .trim();

    await this.plugin.store.addTask(this.currentDate, {
      description: cleanDesc,
      priority,
      tags,
      checked: false,
    });
    await this.loadTasks();
    this.render();
    bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
    new Notice(`已添加任务：${cleanDesc}`);
  }

  private openEditModal(task: ParsedTask) {
    const modal = new Modal(this.app);
    modal.titleEl.setText("编辑任务");

    const descInput = modal.contentEl.createEl("input", {
      type: "text",
      value: task.description,
      cls: "lp-modal-input",
    });

    const tagsInput = modal.contentEl.createEl("input", {
      type: "text",
      value: task.tags.join(" "),
      placeholder: "标签，如 #工作 #重要",
      cls: "lp-modal-input",
    });

    const prioritySelect = modal.contentEl.createEl("select", { cls: "lp-modal-input" });
    prioritySelect.createEl("option", { value: "none", text: "无优先级" });
    prioritySelect.createEl("option", { value: "highest", text: "P1 最高" });
    prioritySelect.createEl("option", { value: "high", text: "P2 高" });
    prioritySelect.createEl("option", { value: "medium", text: "P3 中" });
    prioritySelect.createEl("option", { value: "low", text: "P4 低" });
    prioritySelect.value = task.priority;

    const dueInput = modal.contentEl.createEl("input", {
      type: "date",
      value: task.dueDate || "",
      cls: "lp-modal-input",
    });

    const saveBtn = modal.contentEl.createEl("button", {
      text: "保存",
      cls: "lp-modal-save-btn",
    });

    saveBtn.addEventListener("click", async () => {
      const newTags = tagsInput.value.trim().split(/\s+/).filter((t) => t.startsWith("#"));
      await this.plugin.store.updateTask(this.currentDate, task.lineIndex, {
        description: descInput.value.trim(),
        priority: prioritySelect.value as Priority,
        tags: newTags,
        dueDate: dueInput.value || null,
        checked: task.checked,
      });
      await this.loadTasks();
      this.render();
      modal.close();
      bus.emit({ type: "data-updated", scope: "day", date: this.currentDate });
    });

    modal.open();
  }
}
