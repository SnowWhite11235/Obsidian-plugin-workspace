/**
 * 周日历模块
 *
 * 每天一行：
 * - 左栏：日期（点击切换当前日期）
 * - 中栏：今日任务（点击空白处可编辑当天所有任务，点击任务复选框完成，点 + 添加）
 * - 右栏：每日打卡（按习惯类型着色，按 daysOfWeek 过滤，点击即打卡）
 *
 * 打卡颜色逻辑（与任务列表一致）：
 * - 未打卡 = 彩色填充背景（活跃待办）
 * - 已打卡 = 透明 + 灰色文字（已完成）
 */

import { App, Modal, Notice } from "obsidian";
import type LifePanelPlugin from "../main";
import { BaseModule } from "./BaseModule";
import { bus } from "../core/EventBus";
import {
  toISODate,
  fromISODate,
  startOfWeek,
  addDays,
  today,
  WEEK_DAYS_ZH,
} from "../core/DateUtils";
import { ParsedTask, Priority, TaskType, HABIT_TYPE_COLORS, HabitConfig } from "../core/types";

export class WeekCalendarModule extends BaseModule {
  private weekStartDate: Date;
  private selectedDate: string;
  private showTodayOnly = false;

  constructor(app: App, plugin: LifePanelPlugin, container: HTMLElement, currentDate: string) {
    super(app, plugin, container, currentDate);
    this.weekStartDate = startOfWeek(fromISODate(currentDate));
    this.selectedDate = currentDate;
  }

  async render() {
    const c = this.container;
    c.empty();
    c.addClass("lp-week-cal");

    // 周导航
    const nav = c.createDiv({ cls: "lp-week-cal-nav" });
    const prevBtn = nav.createEl("button", { text: "‹", cls: "lp-week-cal-nav-btn" });
    nav.createDiv({
      cls: "lp-week-cal-title",
      text: `${toISODate(this.weekStartDate)} ~ ${toISODate(addDays(this.weekStartDate, 6))}`,
    });
    const nextBtn = nav.createEl("button", { text: "›", cls: "lp-week-cal-nav-btn" });
    const showTodayBtn = nav.createEl("button", {
      text: "显示今天",
      cls: `lp-week-cal-today-btn ${this.showTodayOnly ? "lp-week-cal-today-btn-active" : ""}`,
    });

    prevBtn.addEventListener("click", () => {
      this.weekStartDate = addDays(this.weekStartDate, -7);
      this.showTodayOnly = false;
      this.render();
    });
    nextBtn.addEventListener("click", () => {
      this.weekStartDate = addDays(this.weekStartDate, 7);
      this.showTodayOnly = false;
      this.render();
    });
    showTodayBtn.addEventListener("click", () => {
      this.showTodayOnly = !this.showTodayOnly;
      if (this.showTodayOnly) {
        this.weekStartDate = startOfWeek(fromISODate(today()));
      }
      this.render();
    });

    // 7 天垂直列表
    const list = c.createDiv({ cls: "lp-week-cal-list" });
    const todayStr = today();

    // 扫描范围：周开始前 30 天到周末，确保能找到提前创建但截止日在本周的任务
    const scanStart = addDays(this.weekStartDate, -30);
    const scanEnd = addDays(this.weekStartDate, 6);
    const allTasks = await this.plugin.store.getTasksInRange(scanStart, scanEnd);

    // 按显示日期分组：有 dueDate 的按 dueDate，否则按 sourceDate
    const tasksByDate = new Map<string, ParsedTask[]>();
    const sourceDateMap = new Map<ParsedTask, string>();
    for (const item of allTasks) {
      const displayDate = item.task.dueDate || item.sourceDate;
      if (!tasksByDate.has(displayDate)) tasksByDate.set(displayDate, []);
      tasksByDate.get(displayDate)!.push(item.task);
      sourceDateMap.set(item.task, item.sourceDate);
    }

    for (let i = 0; i < 7; i++) {
      const day = addDays(this.weekStartDate, i);
      const iso = toISODate(day);
      const isToday = iso === todayStr;

      // 只显示今天模式：跳过非今天的行
      if (this.showTodayOnly && !isToday) continue;

      const isSelected = iso === this.selectedDate;

      const row = list.createDiv({
        cls: `lp-week-cal-row ${isToday ? "lp-week-cal-row-today" : ""} ${isSelected ? "lp-week-cal-row-selected" : ""}`,
      });

      // 日期栏（左侧）
      const dateCol = row.createDiv({ cls: "lp-week-cal-date-col" });
      dateCol.createEl("div", {
        text: WEEK_DAYS_ZH[i],
        cls: "lp-week-cal-weekday",
      });
      dateCol.createEl("div", {
        text: `${day.getMonth() + 1}/${day.getDate()}`,
        cls: "lp-week-cal-date-num",
      });
      dateCol.addEventListener("click", () => {
        this.selectedDate = iso;
        bus.emit({ type: "date-changed", date: iso });
        this.render();
      });

      // 内容区：两栏布局
      const contentCol = row.createDiv({ cls: "lp-week-cal-content-col" });

      // 中栏：任务
      const taskCol = contentCol.createDiv({ cls: "lp-week-cal-task-col" });
      const dayTasks = tasksByDate.get(iso) || [];
      await this.renderDayTasks(taskCol, iso, dayTasks, sourceDateMap);

      // 右栏：打卡
      const habitCol = contentCol.createDiv({ cls: "lp-week-cal-habit-col" });
      await this.renderDayHabits(habitCol, iso);
    }
  }

  /** 渲染某天的任务列表 */
  private async renderDayTasks(
    container: HTMLElement,
    dateStr: string,
    tasks: ParsedTask[],
    sourceDateMap: Map<ParsedTask, string>,
  ) {
    const header = container.createDiv({ cls: "lp-week-cal-task-header" });
    const doneCount = tasks.filter((t) => t.checked).length;
    header.createEl("span", {
      text: `任务 ${doneCount}/${tasks.length}`,
      cls: "lp-week-cal-count",
    });
    const addBtn = header.createEl("button", {
      text: "+",
      cls: "lp-week-cal-add-btn",
    });
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openAddTaskModal(dateStr);
    });

    if (tasks.length === 0) {
      const empty = container.createDiv({
        cls: "lp-week-cal-empty",
        text: "暂无任务",
      });
      empty.addEventListener("click", () => {
        this.openAddTaskModal(dateStr);
      });
      return;
    }

    // 任务列表（最多显示 5 个）
    const taskList = container.createDiv({ cls: "lp-week-cal-task-list" });
    const sortedTasks = [...tasks].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      const aUrgent = a.urgent ? 0 : 1;
      const bUrgent = b.urgent ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      const aImportant = a.important ? 0 : 1;
      const bImportant = b.important ? 0 : 1;
      if (aImportant !== bImportant) return aImportant - bImportant;
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return 0;
    });
    const showTasks = sortedTasks.slice(0, 5);
    for (const task of showTasks) {
      this.renderTaskItem(taskList, task, dateStr, sourceDateMap);
    }
    if (tasks.length > 5) {
      taskList.createDiv({
        cls: "lp-week-cal-more",
        text: `+${tasks.length - 5} 更多`,
      });
    }

    // 点击任务列表空白处打开当天任务编辑器
    taskList.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".lp-week-cal-task-item")) return;
      this.openEditDayTasksModal(dateStr);
    });
  }

  /** 渲染单个任务项 */
  private renderTaskItem(
    container: HTMLElement,
    task: ParsedTask,
    dateStr: string,
    sourceDateMap: Map<ParsedTask, string>,
  ) {
    const color = task.taskType ? this.getTaskColor(task.taskType) : "#8f9192";
    const item = container.createDiv({
      cls: `lp-week-cal-task-item ${task.checked ? "lp-week-cal-task-done" : ""}`,
    });
    // 左侧色条
    item.createEl("span", {
      cls: "lp-week-cal-task-bar",
      attr: { style: `background:${color}` },
    });

    // 复选框
    const checkbox = item.createEl("span", {
      text: task.checked ? "✓" : "○",
      cls: "lp-week-cal-task-checkbox",
    });
    checkbox.addEventListener("click", async (e) => {
      e.stopPropagation();
      // 乐观更新：立即切换视觉状态
      task.checked = !task.checked;
      if (task.checked) {
        item.addClass("lp-week-cal-task-done");
        checkbox.textContent = "✓";
      } else {
        item.removeClass("lp-week-cal-task-done");
        checkbox.textContent = "○";
      }
      // 写入文件（用 sourceDate 定位 daily note）
      const src = sourceDateMap.get(task) || dateStr;
      await this.plugin.store.toggleTask(src, task.lineIndex);
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: src });
    });

    // 时间
    if (task.time) {
      item.createEl("span", {
        text: task.time,
        cls: "lp-week-cal-task-time",
      });
    }

    // 紧急/重要标记
    if (task.urgent) {
      item.createEl("span", { text: "❗", cls: "lp-week-cal-task-urgent" });
    }
    if (task.important) {
      item.createEl("span", { text: "⭐", cls: "lp-week-cal-task-important" });
    }

    // 任务描述（点击可编辑）
    const descEl = item.createEl("span", {
      text: task.description,
      cls: "lp-week-cal-task-text",
    });
    descEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openEditTaskModal(task, dateStr, sourceDateMap);
    });

    // 类型标签
    if (task.taskType && task.taskType !== "other") {
      item.createEl("span", {
        text: this.getTaskTypeLabel(task.taskType),
        cls: "lp-week-cal-task-type",
        attr: { style: `color:${color}` },
      });
    }

    // 番茄钟累积分钟数
    if (task.focusMinutes > 0) {
      item.createEl("span", {
        text: `🍅 ${task.focusMinutes}m`,
        cls: "lp-week-cal-task-pomo",
        attr: { title: `已专注 ${task.focusMinutes} 分钟` },
      });
    }
  }

  /** 渲染某天的打卡列表
   * 按习惯类型分组，每组一行：
   * - 左侧色条（按习惯类型着色）
   * - 圆形复选框（○/✓），点击切换
   * - 图标 + 习惯名
   * - 已完成 = 文字半透明 + 删除线
   */
  private async renderDayHabits(container: HTMLElement, dateStr: string) {
    // 获取当天有效的习惯（考虑 daysOfWeek）
    const activeHabits = this.plugin.store.getActiveHabitsForDate(dateStr);

    // 获取打卡状态
    const habitStates = await this.plugin.store.getHabits(dateStr);

    // 顶部：完成统计
    const header = container.createDiv({ cls: "lp-week-cal-habit-header" });
    const doneCount = activeHabits.filter((h) => habitStates[h.name]).length;
    header.createEl("span", {
      text: `打卡 ${doneCount}/${activeHabits.length}`,
      cls: "lp-week-cal-count",
    });

    if (activeHabits.length === 0) {
      container.createDiv({
        cls: "lp-week-cal-empty",
        text: "今天无打卡",
      });
      return;
    }

    // 按习惯类型分组
    const groups: Record<string, HabitConfig[]> = {};
    for (const habit of activeHabits) {
      const key = habit.habitType;
      if (!groups[key]) groups[key] = [];
      groups[key].push(habit);
    }

    // 按类型顺序渲染：health, study, work, life, sport
    const typeOrder = ["health", "study", "work", "life", "sport"];
    const habitList = container.createDiv({ cls: "lp-week-cal-habit-list" });

    for (const type of typeOrder) {
      const habits = groups[type];
      if (!habits || habits.length === 0) continue;

      const color = HABIT_TYPE_COLORS[type] || "#8f9192";

      // 每组一行
      const groupRow = habitList.createDiv({ cls: "lp-week-cal-habit-group" });

      // 左侧色条（按类型着色）
      groupRow.createEl("span", {
        cls: "lp-week-cal-habit-bar",
        attr: { style: `background:${color}` },
      });

      // 组内习惯横向排列
      const itemsContainer = groupRow.createDiv({ cls: "lp-week-cal-habit-items" });
      for (const habit of habits) {
        this.renderHabitItem(itemsContainer, habit, habitStates, dateStr);
      }
    }
  }

  /** 渲染单个习惯项（圆形复选框 + 图标 + 习惯名） */
  private renderHabitItem(
    container: HTMLElement,
    habit: HabitConfig,
    habitStates: Record<string, boolean>,
    dateStr: string,
  ): void {
    const isChecked = !!habitStates[habit.name];

    const item = container.createDiv({
      cls: `lp-week-cal-habit-item ${isChecked ? "lp-week-cal-habit-done" : ""}`,
    });

    // 圆形复选框（○/✓）
    const checkbox = item.createEl("span", {
      text: isChecked ? "✓" : "○",
      cls: "lp-week-cal-habit-check",
    });

    // 图标
    item.createEl("span", {
      text: habit.icon,
      cls: "lp-week-cal-habit-icon",
    });

    // 习惯名
    const nameEl = item.createEl("span", {
      text: habit.name,
      cls: "lp-week-cal-habit-name",
    });

    // 点击复选框切换 - 乐观更新
    checkbox.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newChecked = !isChecked;

      // 立即切换视觉状态
      if (newChecked) {
        item.addClass("lp-week-cal-habit-done");
        checkbox.textContent = "✓";
      } else {
        item.removeClass("lp-week-cal-habit-done");
        checkbox.textContent = "○";
      }

      // 写入文件
      await this.plugin.store.toggleHabit(dateStr, habit.name);

      // 重新渲染
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: dateStr });
    });

    // 点击习惯名也可以切换
    nameEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.plugin.store.toggleHabit(dateStr, habit.name);
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: dateStr });
    });
  }

  private getTaskColor(taskType: string): string {
    const colors: Record<string, string> = {
      work: "#5e81ac",
      study: "#a3be8c",
      exercise: "#d08770",
      reading: "#b48ead",
      life: "#ebcb8b",
      other: "#8f9192",
    };
    return colors[taskType] || "#8f9192";
  }

  private getTaskTypeLabel(taskType: string): string {
    const labels: Record<string, string> = {
      work: "工作",
      study: "学习",
      exercise: "运动",
      reading: "读书",
      life: "生活",
      other: "其他",
    };
    return labels[taskType] || taskType;
  }

  /** 打开添加任务弹窗 */
  private openAddTaskModal(dateStr: string) {
    const modal = new Modal(this.app);
    modal.titleEl.setText(`添加任务 - ${dateStr}`);

    const form = modal.contentEl.createDiv({ cls: "lp-task-form" });

    form.createEl("label", { text: "任务描述" });
    const descInput = form.createEl("input", {
      type: "text",
      placeholder: "如：完成季度报告",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "具体时间（可选）" });
    const timeInput = form.createEl("input", {
      type: "time",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "任务类型" });
    const typeSelect = form.createEl("select", { cls: "lp-modal-input" });
    typeSelect.createEl("option", { value: "other", text: "其他" });
    typeSelect.createEl("option", { value: "work", text: "工作" });
    typeSelect.createEl("option", { value: "study", text: "学习" });
    typeSelect.createEl("option", { value: "exercise", text: "运动" });
    typeSelect.createEl("option", { value: "reading", text: "读书" });
    typeSelect.createEl("option", { value: "life", text: "生活" });

    form.createEl("label", { text: "优先级" });
    const prioritySelect = form.createEl("select", { cls: "lp-modal-input" });
    prioritySelect.createEl("option", { value: "none", text: "无" });
    prioritySelect.createEl("option", { value: "highest", text: "P1 最高" });
    prioritySelect.createEl("option", { value: "high", text: "P2 高" });
    prioritySelect.createEl("option", { value: "medium", text: "P3 中" });
    prioritySelect.createEl("option", { value: "low", text: "P4 低" });

    const flagRow = form.createDiv({ cls: "lp-task-form-flags" });
    const urgentLabel = flagRow.createEl("label", { cls: "lp-task-form-flag" });
    const urgentCheck = urgentLabel.createEl("input", { type: "checkbox" });
    urgentLabel.createEl("span", { text: " ❗紧急" });
    const importantLabel = flagRow.createEl("label", { cls: "lp-task-form-flag" });
    const importantCheck = importantLabel.createEl("input", { type: "checkbox" });
    importantLabel.createEl("span", { text: " ⭐重要" });

    form.createEl("label", { text: "标签（空格分隔，如 #工作 #重要）" });
    const tagsInput = form.createEl("input", {
      type: "text",
      placeholder: "#工作 #重要",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "截止日（可选）" });
    const dueInput = form.createEl("input", {
      type: "date",
      cls: "lp-modal-input",
    });

    const btnRow = form.createDiv({ cls: "lp-task-form-btns" });
    const cancelBtn = btnRow.createEl("button", {
      text: "取消",
      cls: "lp-modal-cancel-btn",
    });
    const submitBtn = btnRow.createEl("button", {
      text: "添加任务",
      cls: "lp-modal-save-btn",
    });

    const submit = async () => {
      const desc = descInput.value.trim();
      if (!desc) {
        new Notice("请输入任务描述");
        return;
      }
      const tags = tagsInput.value.trim().split(/\s+/).filter((t) => t.startsWith("#"));
      const typeTagMap: Record<string, string> = {
        work: "#工作",
        study: "#学习",
        exercise: "#运动",
        reading: "#读书",
        life: "#生活",
      };
      const typeTag = typeTagMap[typeSelect.value];
      if (typeTag && !tags.includes(typeTag)) {
        tags.push(typeTag);
      }

      await this.plugin.store.addTask(dateStr, {
        description: desc,
        priority: prioritySelect.value as Priority,
        tags,
        checked: false,
        time: timeInput.value || null,
        urgent: urgentCheck.checked,
        important: importantCheck.checked,
        taskType: typeSelect.value as TaskType,
        dueDate: dueInput.value || null,
      });
      new Notice("任务已添加");
      modal.close();
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: dateStr });
    };

    submitBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => modal.close());
    descInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    modal.open();
    setTimeout(() => descInput.focus(), 50);
  }

  /** 打开编辑当天所有任务的弹窗 */
  private openEditDayTasksModal(dateStr: string) {
    const modal = new Modal(this.app);
    modal.titleEl.setText(`编辑任务 - ${dateStr}`);

    const list = modal.contentEl.createDiv({ cls: "lp-task-edit-list" });

    const renderTasks = async () => {
      list.empty();
      const tasks = await this.plugin.store.getTasks(dateStr);

      if (tasks.length === 0) {
        list.createDiv({
          cls: "lp-week-cal-empty",
          text: "当天暂无任务",
        });
      }

      for (const task of tasks) {
        const item = list.createDiv({ cls: "lp-task-edit-item" });

        // 复选框
        const checkbox = item.createEl("input", { type: "checkbox" });
        checkbox.checked = task.checked;
        checkbox.addEventListener("change", async () => {
          await this.plugin.store.toggleTask(dateStr, task.lineIndex);
          renderTasks();
          this.render();
          bus.emit({ type: "data-updated", scope: "day", date: dateStr });
        });

        // 描述（可编辑）
        const descInput = item.createEl("input", {
          type: "text",
          value: task.description,
          cls: "lp-task-edit-desc",
        });
        descInput.addEventListener("change", async () => {
          await this.plugin.store.updateTask(dateStr, task.lineIndex, {
            description: descInput.value.trim(),
          });
          bus.emit({ type: "data-updated", scope: "day", date: dateStr });
        });

        // 删除按钮
        const delBtn = item.createEl("button", {
          text: "🗑️",
          cls: "lp-task-edit-del",
        });
        delBtn.addEventListener("click", async () => {
          await this.plugin.store.deleteTask(dateStr, task.lineIndex);
          renderTasks();
          this.render();
          bus.emit({ type: "data-updated", scope: "day", date: dateStr });
        });
      }

      // 添加新任务的输入框
      const addRow = list.createDiv({ cls: "lp-task-edit-add-row" });
      const newInput = addRow.createEl("input", {
        type: "text",
        placeholder: "添加新任务...",
        cls: "lp-task-edit-new-input",
      });
      const addBtn = addRow.createEl("button", {
        text: "+",
        cls: "lp-task-edit-add-btn",
      });

      const addNew = async () => {
        const desc = newInput.value.trim();
        if (!desc) return;
        await this.plugin.store.addTask(dateStr, {
          description: desc,
          checked: false,
        });
        newInput.value = "";
        renderTasks();
        this.render();
        bus.emit({ type: "data-updated", scope: "day", date: dateStr });
      };

      addBtn.addEventListener("click", addNew);
      newInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addNew();
      });
    };

    renderTasks();

    const closeBtn = modal.contentEl.createEl("button", {
      text: "关闭",
      cls: "lp-modal-cancel-btn",
    });
    closeBtn.style.marginTop = "12px";
    closeBtn.addEventListener("click", () => modal.close());

    modal.open();
  }

  /** 打开编辑单个任务的弹窗 */
  private openEditTaskModal(
    task: ParsedTask,
    dateStr: string,
    sourceDateMap: Map<ParsedTask, string>,
  ) {
    const modal = new Modal(this.app);
    const src = sourceDateMap.get(task) || dateStr;
    modal.titleEl.setText(`编辑任务 - ${src}`);

    const form = modal.contentEl.createDiv({ cls: "lp-task-form" });

    form.createEl("label", { text: "任务描述" });
    const descInput = form.createEl("input", {
      type: "text",
      value: task.description,
      placeholder: "任务描述",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "具体时间（可选）" });
    const timeInput = form.createEl("input", {
      type: "time",
      value: task.time || "",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "任务类型" });
    const typeSelect = form.createEl("select", { cls: "lp-modal-input" });
    typeSelect.createEl("option", { value: "other", text: "其他" });
    typeSelect.createEl("option", { value: "work", text: "工作" });
    typeSelect.createEl("option", { value: "study", text: "学习" });
    typeSelect.createEl("option", { value: "exercise", text: "运动" });
    typeSelect.createEl("option", { value: "reading", text: "读书" });
    typeSelect.createEl("option", { value: "life", text: "生活" });
    typeSelect.value = task.taskType || "other";

    form.createEl("label", { text: "优先级" });
    const prioritySelect = form.createEl("select", { cls: "lp-modal-input" });
    prioritySelect.createEl("option", { value: "none", text: "无" });
    prioritySelect.createEl("option", { value: "highest", text: "P1 最高" });
    prioritySelect.createEl("option", { value: "high", text: "P2 高" });
    prioritySelect.createEl("option", { value: "medium", text: "P3 中" });
    prioritySelect.createEl("option", { value: "low", text: "P4 低" });
    prioritySelect.value = task.priority || "none";

    const flagRow = form.createDiv({ cls: "lp-task-form-flags" });
    const urgentLabel = flagRow.createEl("label", { cls: "lp-task-form-flag" });
    const urgentCheck = urgentLabel.createEl("input", { type: "checkbox" });
    urgentCheck.checked = !!task.urgent;
    urgentLabel.createEl("span", { text: " ❗紧急" });
    const importantLabel = flagRow.createEl("label", { cls: "lp-task-form-flag" });
    const importantCheck = importantLabel.createEl("input", { type: "checkbox" });
    importantCheck.checked = !!task.important;
    importantLabel.createEl("span", { text: " ⭐重要" });

    form.createEl("label", { text: "标签（空格分隔，如 #工作 #重要）" });
    const tagsInput = form.createEl("input", {
      type: "text",
      value: (task.tags || []).join(" "),
      placeholder: "#工作 #重要",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "截止日（可选）" });
    const dueInput = form.createEl("input", {
      type: "date",
      value: task.dueDate || "",
      cls: "lp-modal-input",
    });

    const btnRow = form.createDiv({ cls: "lp-task-form-btns" });

    // 删除按钮
    const delBtn = btnRow.createEl("button", {
      text: "删除",
      cls: "lp-modal-cancel-btn",
    });
    delBtn.style.color = "var(--text-error)";

    const cancelBtn = btnRow.createEl("button", {
      text: "取消",
      cls: "lp-modal-cancel-btn",
    });

    const saveBtn = btnRow.createEl("button", {
      text: "保存",
      cls: "lp-modal-save-btn",
    });

    const save = async () => {
      const desc = descInput.value.trim();
      if (!desc) {
        new Notice("请输入任务描述");
        return;
      }
      const tags = tagsInput.value.trim().split(/\s+/).filter((t) => t.startsWith("#"));
      const typeTagMap: Record<string, string> = {
        work: "#工作",
        study: "#学习",
        exercise: "#运动",
        reading: "#读书",
        life: "#生活",
      };
      const typeTag = typeTagMap[typeSelect.value];
      if (typeTag && !tags.includes(typeTag)) {
        tags.push(typeTag);
      }

      await this.plugin.store.updateTask(src, task.lineIndex, {
        description: desc,
        priority: prioritySelect.value as Priority,
        tags,
        time: timeInput.value || null,
        urgent: urgentCheck.checked,
        important: importantCheck.checked,
        taskType: typeSelect.value as TaskType,
        dueDate: dueInput.value || null,
      });
      new Notice("任务已更新");
      modal.close();
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: src });
    };

    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", () => modal.close());
    delBtn.addEventListener("click", async () => {
      await this.plugin.store.deleteTask(src, task.lineIndex);
      new Notice("任务已删除");
      modal.close();
      this.render();
      bus.emit({ type: "data-updated", scope: "day", date: src });
    });
    descInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });

    modal.open();
    setTimeout(() => descInput.focus(), 50);
  }
}
