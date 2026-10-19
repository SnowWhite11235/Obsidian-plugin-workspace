/**
 * 设置面板 - 习惯管理（含归档、有效期、按周几配置）
 */

import { App, PluginSettingTab, Setting, Modal, Notice } from "obsidian";
import type LifePanelPlugin from "./main";
import { HabitConfig, HABIT_TYPE_LABELS } from "./core/types";

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export class LifePanelSettingTab extends PluginSettingTab {
  constructor(public app: App, public plugin: LifePanelPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ===== 存储设置 =====
    containerEl.createEl("h2", { text: "存储" });

    new Setting(containerEl)
      .setName("根文件夹")
      .setDesc("所有生活管理数据存放的根目录（默认 LifePanel）")
      .addText((text) =>
        text
          .setPlaceholder("LifePanel")
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v || "LifePanel";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("复用 Daily Notes")
      .setDesc("读写到 Obsidian 核心 Daily Notes 插件生成的当日笔记")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.useDailyNotes)
          .onChange(async (v) => {
            this.plugin.settings.useDailyNotes = v;
            await this.plugin.saveSettings();
          }),
      );

    // ===== 活跃习惯管理 =====
    containerEl.createEl("h2", { text: "活跃习惯" });
    containerEl.createEl("p", {
      text: "管理当前正在进行的打卡习惯。可设置有效期、按周几配置、归档历史习惯。",
      cls: "lp-setting-desc",
    });

    for (let i = 0; i < this.plugin.settings.habits.length; i++) {
      const h = this.plugin.settings.habits[i];
      const setting = new Setting(containerEl);
      setting.setName(`${h.icon} ${h.name}`);

      // 构造描述：类型 + 周目标 + 打卡日 + 有效期
      const daysDesc = h.daysOfWeek && h.daysOfWeek.length > 0
        ? h.daysOfWeek.map((d) => WEEKDAY_LABELS[d - 1]).join("、")
        : "每天";
      setting.setDesc(
        `类型: ${HABIT_TYPE_LABELS[h.habitType] || h.habitType} | 周目标: ${h.targetPerWeek} | ` +
        `打卡日: ${daysDesc} | 有效期: ${h.startDate || "无"} ~ ${h.endDate || "无"}`,
      );

      setting.addExtraButton((btn) =>
        btn.setIcon("pencil").setTooltip("编辑").onClick(() => {
          this.openEditHabitModal(h, i, false);
        }),
      );
      setting.addExtraButton((btn) =>
        btn.setIcon("archive").setTooltip("归档").onClick(async () => {
          await this.archiveHabit(i);
        }),
      );
      setting.addExtraButton((btn) =>
        btn.setIcon("trash").setTooltip("删除").onClick(async () => {
          this.plugin.settings.habits.splice(i, 1);
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("添加习惯").onClick(() => {
        this.openAddHabitModal();
      }),
    );

    // ===== 归档习惯 =====
    if (this.plugin.settings.archivedHabits.length > 0) {
      containerEl.createEl("h2", { text: "归档习惯" });
      containerEl.createEl("p", {
        text: "已归档的习惯保留历史记录，可恢复或永久删除。",
        cls: "lp-setting-desc",
      });

      for (let i = 0; i < this.plugin.settings.archivedHabits.length; i++) {
        const h = this.plugin.settings.archivedHabits[i];
        const setting = new Setting(containerEl);
        setting.setName(`${h.icon} ${h.name}`);
        setting.setDesc(
          `类型: ${HABIT_TYPE_LABELS[h.habitType] || h.habitType} | ` +
          `归档于: ${h.archivedDate || "未知"} | ` +
          `原因: ${h.archivedReason || "无"}`,
        );
        setting.addExtraButton((btn) =>
          btn.setIcon("rotate-ccw").setTooltip("恢复").onClick(async () => {
            await this.restoreHabit(i);
          }),
        );
        setting.addExtraButton((btn) =>
          btn.setIcon("trash").setTooltip("永久删除").onClick(async () => {
            this.plugin.settings.archivedHabits.splice(i, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
        );
      }
    }

    // ===== 番茄钟 =====
    containerEl.createEl("h2", { text: "番茄钟" });

    new Setting(containerEl)
      .setName("专注时长（分钟）")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pomodoroFocus))
          .onChange(async (v) => {
            this.plugin.settings.pomodoroFocus = parseInt(v, 10) || 25;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("休息时长（分钟）")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pomodoroBreak))
          .onChange(async (v) => {
            this.plugin.settings.pomodoroBreak = parseInt(v, 10) || 5;
            await this.plugin.saveSettings();
          }),
      );

    // ===== 每日复盘问题 =====
    containerEl.createEl("h2", { text: "每日复盘问题" });

    for (let i = 0; i < this.plugin.settings.reviewQuestions.length; i++) {
      const q = this.plugin.settings.reviewQuestions[i];
      const setting = new Setting(containerEl);
      setting.addText((text) =>
        text.setValue(q).onChange(async (v) => {
          this.plugin.settings.reviewQuestions[i] = v;
          await this.plugin.saveSettings();
        }),
      );
      setting.addExtraButton((btn) =>
        btn.setIcon("trash").setTooltip("删除").onClick(async () => {
          this.plugin.settings.reviewQuestions.splice(i, 1);
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("添加问题").onClick(async () => {
        this.plugin.settings.reviewQuestions.push("新问题？");
        await this.plugin.saveSettings();
        this.display();
      }),
    );

    // ===== 主题 =====
    containerEl.createEl("h2", { text: "外观" });

    new Setting(containerEl)
      .setName("主题")
      .setDesc("面板主题（默认跟随 Obsidian）")
      .addDropdown((dd) =>
        dd
          .addOption("auto", "跟随 Obsidian")
          .addOption("light", "浅色")
          .addOption("dark", "深色")
          .setValue(this.plugin.settings.theme)
          .onChange(async (v) => {
            this.plugin.settings.theme = v as "auto" | "light" | "dark";
            await this.plugin.saveSettings();
            this.plugin.applyTheme();
          }),
      );
  }

  /** 打开添加习惯弹窗 */
  private openAddHabitModal() {
    const modal = new Modal(this.app);
    modal.titleEl.setText("添加习惯");

    const { form, nameInput, iconInput, typeSelect, targetInput, startInput, endInput, dayCheckboxes } = this.buildHabitForm(modal, null);

    const btnRow = form.createDiv({ cls: "lp-task-form-btns" });
    btnRow.createEl("button", {
      text: "取消",
      cls: "lp-modal-cancel-btn",
    }).addEventListener("click", () => modal.close());
    btnRow.createEl("button", {
      text: "添加",
      cls: "lp-modal-save-btn",
    }).addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice("请输入习惯名称");
        return;
      }
      const daysOfWeek = dayCheckboxes
        .map((cb, i) => (cb.checked ? i + 1 : 0))
        .filter((d) => d > 0);
      const habit: HabitConfig = {
        name,
        icon: iconInput.value.trim() || "✨",
        targetPerWeek: parseInt(targetInput.value, 10) || 7,
        habitType: typeSelect.value as HabitConfig["habitType"],
        startDate: startInput.value || null,
        endDate: endInput.value || null,
        archived: false,
        createdDate: new Date().toISOString().slice(0, 10),
        archivedDate: null,
        archivedReason: null,
        daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [1, 2, 3, 4, 5, 6, 7],
      };
      this.plugin.settings.habits.push(habit);
      await this.plugin.saveSettings();
      modal.close();
      this.display();
    });

    modal.open();
    setTimeout(() => nameInput.focus(), 50);
  }

  /** 打开编辑习惯弹窗 */
  private openEditHabitModal(habit: HabitConfig, index: number, isArchived: boolean) {
    const modal = new Modal(this.app);
    modal.titleEl.setText("编辑习惯");

    const { form, nameInput, iconInput, typeSelect, targetInput, startInput, endInput, dayCheckboxes } = this.buildHabitForm(modal, habit);

    const btnRow = form.createDiv({ cls: "lp-task-form-btns" });
    btnRow.createEl("button", {
      text: "取消",
      cls: "lp-modal-cancel-btn",
    }).addEventListener("click", () => modal.close());
    btnRow.createEl("button", {
      text: "保存",
      cls: "lp-modal-save-btn",
    }).addEventListener("click", async () => {
      habit.name = nameInput.value.trim();
      habit.icon = iconInput.value.trim() || "✨";
      habit.targetPerWeek = parseInt(targetInput.value, 10) || 7;
      habit.habitType = typeSelect.value as HabitConfig["habitType"];
      habit.startDate = startInput.value || null;
      habit.endDate = endInput.value || null;
      const daysOfWeek = dayCheckboxes
        .map((cb, i) => (cb.checked ? i + 1 : 0))
        .filter((d) => d > 0);
      habit.daysOfWeek = daysOfWeek.length > 0 ? daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
      await this.plugin.saveSettings();
      modal.close();
      this.display();
    });

    modal.open();
  }

  /** 构建习惯表单（添加/编辑共用） */
  private buildHabitForm(modal: Modal, habit: HabitConfig | null) {
    const form = modal.contentEl.createDiv({ cls: "lp-task-form" });

    form.createEl("label", { text: "习惯名称" });
    const nameInput = form.createEl("input", {
      type: "text",
      value: habit?.name || "",
      placeholder: "如：早起",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "图标 emoji" });
    const iconInput = form.createEl("input", {
      type: "text",
      value: habit?.icon || "",
      placeholder: "🌅",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "习惯类型（决定颜色）" });
    const typeSelect = form.createEl("select", { cls: "lp-modal-input" });
    typeSelect.createEl("option", { value: "health", text: "健康（红）" });
    typeSelect.createEl("option", { value: "study", text: "学习（绿）" });
    typeSelect.createEl("option", { value: "work", text: "工作（蓝）" });
    typeSelect.createEl("option", { value: "life", text: "生活（黄）" });
    typeSelect.createEl("option", { value: "sport", text: "运动（橙）" });
    if (habit) typeSelect.value = habit.habitType;

    form.createEl("label", { text: "周目标数" });
    const targetInput = form.createEl("input", {
      type: "number",
      value: String(habit?.targetPerWeek ?? 7),
      cls: "lp-modal-input",
    });

    // 打卡日选择（7 个 checkbox）
    form.createEl("label", { text: "打卡日（每天打卡内容可以不同）" });
    const dayRow = form.createDiv({ cls: "lp-habit-day-row" });
    const dayCheckboxes: HTMLInputElement[] = [];
    for (let i = 0; i < 7; i++) {
      const dayLabel = dayRow.createEl("label", { cls: "lp-habit-day-label" });
      const cb = dayLabel.createEl("input", { type: "checkbox" });
      dayLabel.createEl("span", { text: WEEKDAY_LABELS[i] });
      // 默认值
      if (habit?.daysOfWeek && habit.daysOfWeek.length > 0) {
        cb.checked = habit.daysOfWeek.includes(i + 1);
      } else {
        cb.checked = true; // 默认每天
      }
      dayCheckboxes.push(cb);
    }

    form.createEl("label", { text: "有效期开始（可选）" });
    const startInput = form.createEl("input", {
      type: "date",
      value: habit?.startDate || "",
      cls: "lp-modal-input",
    });

    form.createEl("label", { text: "有效期结束（可选）" });
    const endInput = form.createEl("input", {
      type: "date",
      value: habit?.endDate || "",
      cls: "lp-modal-input",
    });

    return { form, nameInput, iconInput, typeSelect, targetInput, startInput, endInput, dayCheckboxes };
  }

  /** 归档习惯 */
  private async archiveHabit(index: number) {
    const habit = this.plugin.settings.habits[index];
    if (!habit) return;

    const modal = new Modal(this.app);
    modal.titleEl.setText(`归档习惯: ${habit.name}`);

    const form = modal.contentEl.createDiv({ cls: "lp-task-form" });
    form.createEl("label", { text: "归档原因（可选）" });
    const reasonInput = form.createEl("input", {
      type: "text",
      placeholder: "如：已完成目标、不再需要等",
      cls: "lp-modal-input",
    });

    const btnRow = form.createDiv({ cls: "lp-task-form-btns" });
    btnRow.createEl("button", {
      text: "取消",
      cls: "lp-modal-cancel-btn",
    }).addEventListener("click", () => modal.close());
    btnRow.createEl("button", {
      text: "确认归档",
      cls: "lp-modal-save-btn",
    }).addEventListener("click", async () => {
      habit.archived = true;
      habit.archivedDate = new Date().toISOString().slice(0, 10);
      habit.archivedReason = reasonInput.value.trim() || null;
      this.plugin.settings.habits.splice(index, 1);
      this.plugin.settings.archivedHabits.push(habit);
      await this.plugin.saveSettings();
      modal.close();
      this.display();
      new Notice(`习惯「${habit.name}」已归档`);
    });

    modal.open();
    setTimeout(() => reasonInput.focus(), 50);
  }

  /** 恢复归档的习惯 */
  private async restoreHabit(index: number) {
    const habit = this.plugin.settings.archivedHabits[index];
    if (!habit) return;
    habit.archived = false;
    habit.archivedDate = null;
    habit.archivedReason = null;
    this.plugin.settings.archivedHabits.splice(index, 1);
    this.plugin.settings.habits.push(habit);
    await this.plugin.saveSettings();
    this.display();
    new Notice(`习惯「${habit.name}」已恢复`);
  }
}
