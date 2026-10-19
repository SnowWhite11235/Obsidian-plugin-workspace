/**
 * DataStore - 数据落库引擎
 *
 * 职责：
 * 1. 根据日期解析/创建对应的 daily note 路径
 * 2. 读写 markdown 文件的 frontmatter 与章节
 * 3. 处理 weekly note、habits log
 * 4. 防抖批量保存（避免覆盖用户手动编辑）
 *
 * 数据落库结构：
 *   <vault>/<settings.folder>/
 *   ├── daily/2026-10-18.md       # 若不复用 Daily Notes
 *   ├── weekly/2026-W42.md
 *   └── habits/habits-log.md
 *
 * 当日 daily note 的标准章节：
 *   ## 今日任务
 *   ## 灵感
 *   ## 每日复盘
 *
 * frontmatter:
 *   ---
 *   date: 2026-10-18
 *   habits:
 *     早起: true
 *   mood: 4
 *   focusMinutes: 75
 *   ---
 */

import { App, TFile, normalizePath, Notice, FrontMatterCache } from "obsidian";
import { LifePanelSettings, HabitConfig } from "./types";
import { toISODate, fromISODate, pad2, weekKey, parseWeekKey, addDays } from "./DateUtils";
import { ParsedTask } from "./types";
import { parseTasksFromText, rewriteTaskLine, serializeTask } from "./TaskParser";

const SECTION_TASKS = "## 今日任务";
const SECTION_INSPIRATION = "## 灵感";
const SECTION_REVIEW = "## 每日复盘";

export class DataStore {
  constructor(public app: App, public settings: LifePanelSettings) {}

  updateSettings(s: LifePanelSettings) {
    this.settings = s;
  }

  // ---------- 路径解析 ----------

  /** 获取 daily notes 核心插件配置（如果启用） */
  private getDailyNotesConfig(): { format: string; folder: string; template?: string } | null {
    try {
      // @ts-ignore - internalPlugins 是私有 API
      const dp = this.app.internalPlugins?.getPluginById?.("daily-notes");
      if (dp && dp.enabled && dp.instance?.options) {
        const opts = dp.instance.options;
        return {
          format: opts.format || "YYYY-MM-DD",
          folder: opts.folder || "",
          template: opts.template,
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** 把 moment 格式字符串转换为固定的日期路径片段 */
  private formatDailyNoteFilename(format: string, date: Date): string {
    // 简化：只支持常见的 YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD 等
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    let out = format;
    out = out.replace(/YYYY/g, String(y));
    out = out.replace(/YY/g, String(y).slice(-2));
    out = out.replace(/MM/g, m);
    out = out.replace(/M\b/g, String(date.getMonth() + 1));
    out = out.replace(/DD/g, d);
    out = out.replace(/D\b/g, String(date.getDate()));
    return out;
  }

  /** 给定日期，返回 daily note 的完整 vault 路径
   * 始终使用 settings.folder 作为根目录，避免文件散落到其他位置
   */
  getDailyNotePath(date: Date | string): string {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const iso = toISODate(d);
    return normalizePath(`${this.settings.folder}/daily/${iso}.md`);
  }

  /** 周记录路径：始终放在 settings.folder 下 */
  getWeeklyNotePath(date: Date | string): string {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const wk = weekKey(d);
    return normalizePath(`${this.settings.folder}/weekly/${wk}.md`);
  }

  getHabitsLogPath(): string {
    return normalizePath(`${this.settings.folder}/habits/habits-log.md`);
  }

  // ---------- 文件读写底层 ----------

  async ensureFile(path: string, initialContent = ""): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    // 创建父目录
    const folder = path.substring(0, path.lastIndexOf("/"));
    if (folder) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // 文件夹已存在，忽略
      }
    }
    return await this.app.vault.create(path, initialContent);
  }

  async readFile(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    return await this.app.vault.read(file);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const file = await this.ensureFile(path);
    await this.app.vault.modify(file, content);
  }

  async appendToFile(path: string, content: string): Promise<void> {
    const file = await this.ensureFile(path);
    const existing = await this.app.vault.read(file);
    const sep = existing.endsWith("\n") ? "" : "\n";
    await this.app.vault.modify(file, existing + sep + content);
  }

  // ---------- Daily Note 操作 ----------

  /** 获取或创建 daily note，返回文件对象和内容 */
  async getDailyNote(date: Date | string): Promise<{ file: TFile; content: string }> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const path = this.getDailyNotePath(d);
    const iso = toISODate(d);

    // 初始模板
    const initial = `---
date: ${iso}
habits: {}
mood: 
focusMinutes: 0
---

## 今日任务

## 灵感

## 每日复盘
`;

    const file = await this.ensureFile(path, initial);
    let content = await this.app.vault.read(file);

    // 确保必要章节存在
    const sections = [SECTION_TASKS, SECTION_INSPIRATION, SECTION_REVIEW];
    let modified = false;
    for (const sec of sections) {
      if (!content.includes(sec)) {
        content += `\n${sec}\n\n`;
        modified = true;
      }
    }
    // 确保 frontmatter 存在
    if (!content.startsWith("---")) {
      content = `---\ndate: ${iso}\nhabits: {}\n---\n\n` + content;
      modified = true;
    }
    if (modified) {
      await this.app.vault.modify(file, content);
    }
    return { file, content };
  }

  /** 读取 daily note 的 frontmatter */
  async getDailyFrontmatter(date: Date | string): Promise<Record<string, any>> {
    const { content } = await this.getDailyNote(date);
    return this.parseFrontmatter(content);
  }

  /** 更新 daily note 的 frontmatter 字段 */
  async updateDailyFrontmatter(
    date: Date | string,
    updates: Record<string, any>,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const newContent = this.mergeFrontmatter(content, updates);
    await this.app.vault.modify(file, newContent);
  }

  // ---------- 任务操作 ----------

  /** 获取某日的所有任务 */
  async getTasks(date: Date | string): Promise<ParsedTask[]> {
    const { content } = await this.getDailyNote(date);
    const sectionContent = this.extractSection(content, SECTION_TASKS);
    if (!sectionContent) return [];
    return parseTasksFromText(sectionContent);
  }

  /** 添加任务到某日的任务区 */
  async addTask(
    date: Date | string,
    task: Partial<ParsedTask>,
  ): Promise<ParsedTask> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const newTask: ParsedTask = {
      raw: "",
      description: task.description || "新任务",
      checked: task.checked || false,
      priority: task.priority || "none",
      dueDate: task.dueDate || null,
      scheduledDate: task.scheduledDate || null,
      startDate: task.startDate || null,
      tags: task.tags || [],
      indentLevel: task.indentLevel || 0,
      recurrence: task.recurrence || null,
      doneDate: task.doneDate || null,
      createdDate: task.createdDate || toISODate(d),
      lineIndex: -1,
      time: task.time || null,
      urgent: task.urgent || false,
      important: task.important || false,
      taskType: task.taskType || "other",
      focusMinutes: task.focusMinutes || 0,
    };
    const line = serializeTask(newTask);

    const newContent = this.appendLineToSection(content, SECTION_TASKS, line);
    await this.app.vault.modify(file, newContent);
    return newTask;
  }

  /** 切换任务完成状态（根据 lineIndex） */
  async toggleTask(date: Date | string, lineIndex: number): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const sectionStart = this.findSectionStart(content, SECTION_TASKS);
    if (sectionStart < 0) return;

    // 找到任务区在完整文件中的行范围
    const allLines = content.split("\n");
    const nextSectionStart = this.findNextSectionStart(content, sectionStart);

    // lineIndex 是相对于任务区第一行的偏移
    const absoluteLine = sectionStart + 1 + lineIndex;
    if (absoluteLine < 0 || absoluteLine >= allLines.length) return;
    if (nextSectionStart > 0 && absoluteLine >= nextSectionStart) return;

    // 重新解析这一行
    const { parseTaskLine, serializeTask } = await import("./TaskParser");
    const t = parseTaskLine(allLines[absoluteLine], absoluteLine);
    if (!t) return;
    t.checked = !t.checked;
    if (t.checked) {
      t.doneDate = toISODate(d);
    } else {
      t.doneDate = null;
    }
    allLines[absoluteLine] = serializeTask(t);
    await this.app.vault.modify(file, allLines.join("\n"));
  }

  /** 更新任务（按 lineIndex 定位） */
  async updateTask(
    date: Date | string,
    lineIndex: number,
    updates: Partial<ParsedTask>,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const sectionStart = this.findSectionStart(content, SECTION_TASKS);
    if (sectionStart < 0) return;
    const allLines = content.split("\n");
    const absoluteLine = sectionStart + 1 + lineIndex;
    if (absoluteLine < 0 || absoluteLine >= allLines.length) return;

    const { parseTaskLine, serializeTask } = await import("./TaskParser");
    const t = parseTaskLine(allLines[absoluteLine], absoluteLine);
    if (!t) return;
    const updated: ParsedTask = { ...t, ...updates };
    allLines[absoluteLine] = serializeTask(updated);
    await this.app.vault.modify(file, allLines.join("\n"));
  }

  /** 删除任务（按 lineIndex） */
  async deleteTask(date: Date | string, lineIndex: number): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const sectionStart = this.findSectionStart(content, SECTION_TASKS);
    if (sectionStart < 0) return;
    const allLines = content.split("\n");
    const absoluteLine = sectionStart + 1 + lineIndex;
    if (absoluteLine < 0 || absoluteLine >= allLines.length) return;
    allLines.splice(absoluteLine, 1);
    await this.app.vault.modify(file, allLines.join("\n"));
  }

  /** 给任务增加专注分钟数 */
  async addTaskFocusMinutes(
    date: Date | string,
    lineIndex: number,
    minutes: number,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const sectionStart = this.findSectionStart(content, SECTION_TASKS);
    if (sectionStart < 0) return;
    const allLines = content.split("\n");
    const absoluteLine = sectionStart + 1 + lineIndex;
    if (absoluteLine < 0 || absoluteLine >= allLines.length) return;

    const { parseTaskLine, serializeTask } = await import("./TaskParser");
    const t = parseTaskLine(allLines[absoluteLine], absoluteLine);
    if (!t) return;
    t.focusMinutes = (t.focusMinutes || 0) + minutes;
    allLines[absoluteLine] = serializeTask(t);
    await this.app.vault.modify(file, allLines.join("\n"));
  }

  /** 重排序任务（移动一个任务到新位置） */
  async reorderTasks(
    date: Date | string,
    fromIndex: number,
    toIndex: number,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const tasks = await this.getTasks(d);
    if (fromIndex < 0 || fromIndex >= tasks.length) return;
    if (toIndex < 0 || toIndex >= tasks.length) return;

    // 重新生成任务区
    const moved = tasks.splice(fromIndex, 1)[0];
    tasks.splice(toIndex, 0, moved);

    const newSectionBody = tasks.map((t) => serializeTask(t)).join("\n");
    const newContent = this.replaceSection(content, SECTION_TASKS, newSectionBody);
    await this.app.vault.modify(file, newContent);
  }

  // ---------- 灵感操作 ----------

  /** 添加一条灵感 */
  async addInspiration(
    date: Date | string,
    text: string,
    time?: string,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const ts = time || this.nowHM();
    const line = `- [${ts}] ${text}`;
    const newContent = this.appendLineToSection(content, SECTION_INSPIRATION, line);
    await this.app.vault.modify(file, newContent);
  }

  /** 获取某日所有灵感 */
  async getInspirations(date: Date | string): Promise<Array<{ time: string; text: string }>> {
    const { content } = await this.getDailyNote(date);
    const sectionContent = this.extractSection(content, SECTION_INSPIRATION);
    if (!sectionContent) return [];
    const lines = sectionContent.split("\n").filter((l) => l.trim().startsWith("-"));
    const result: Array<{ time: string; text: string }> = [];
    for (const line of lines) {
      const m = line.match(/^-\s*\[(\d{2}:\d{2})\]\s*(.*)$/);
      if (m) {
        result.push({ time: m[1], text: m[2] });
      } else {
        const txt = line.replace(/^-\s*/, "");
        result.push({ time: "", text: txt });
      }
    }
    return result;
  }

  // ---------- 每日复盘操作 ----------

  /** 获取每日复盘内容（按问题分段） */
  async getReview(date: Date | string): Promise<Record<string, string>> {
    const { content } = await this.getDailyNote(date);
    const sectionContent = this.extractSection(content, SECTION_REVIEW);
    if (!sectionContent) return {};
    const result: Record<string, string> = {};
    const questions = this.settings.reviewQuestions;
    const lines = sectionContent.split("\n");
    let currentQ = "";
    let buffer: string[] = [];
    for (const line of lines) {
      const matched = questions.find((q) => line.includes(q));
      if (matched) {
        if (currentQ) result[currentQ] = buffer.join("\n").trim();
        currentQ = matched;
        buffer = [];
        // 问题行可能后面跟着答案
        const afterQ = line.substring(line.indexOf(matched) + matched.length).trim();
        if (afterQ) buffer.push(afterQ);
      } else if (line.trim()) {
        buffer.push(line);
      }
    }
    if (currentQ) result[currentQ] = buffer.join("\n").trim();
    return result;
  }

  /** 保存每日复盘内容 */
  async saveReview(date: Date | string, answers: Record<string, string>): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const questions = this.settings.reviewQuestions;
    let body = "";
    for (const q of questions) {
      const ans = answers[q] || "";
      body += `### ${q}\n${ans}\n\n`;
    }
    const newContent = this.replaceSection(content, SECTION_REVIEW, body.trim());
    await this.app.vault.modify(file, newContent);
  }

  // ---------- 打卡操作 ----------

  /**
   * 获取某日打卡状态
   * 只返回在当天有效（未归档、在有效期内、且当天是配置的打卡日）的习惯
   */
  async getHabits(date: Date | string): Promise<Record<string, boolean>> {
    const fm = await this.getDailyFrontmatter(date);
    const habits = fm.habits || {};
    const result: Record<string, boolean> = {};
    const d = typeof date === "string" ? fromISODate(date) : date;
    const dayOfWeek = ((d.getDay() + 6) % 7) + 1; // 1=周一...7=周日
    const isoDate = toISODate(d);

    for (const h of this.settings.habits) {
      // 检查是否归档
      if (h.archived) continue;
      // 检查有效期
      if (h.startDate && isoDate < h.startDate) continue;
      if (h.endDate && isoDate > h.endDate) continue;
      // 检查当天是否是打卡日
      if (h.daysOfWeek && h.daysOfWeek.length > 0 && !h.daysOfWeek.includes(dayOfWeek)) continue;
      result[h.name] = !!habits[h.name];
    }
    return result;
  }

  /**
   * 获取某天应该显示的习惯列表（考虑 daysOfWeek 配置）
   */
  getActiveHabitsForDate(date: Date | string): HabitConfig[] {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const dayOfWeek = ((d.getDay() + 6) % 7) + 1;
    const isoDate = toISODate(d);

    return this.settings.habits.filter((h) => {
      if (h.archived) return false;
      if (h.startDate && isoDate < h.startDate) return false;
      if (h.endDate && isoDate > h.endDate) return false;
      if (h.daysOfWeek && h.daysOfWeek.length > 0 && !h.daysOfWeek.includes(dayOfWeek)) return false;
      return true;
    });
  }

  /**
   * 切换某习惯的打卡状态
   * 一次性读取文件、修改 frontmatter、写回，避免状态不一致
   * 同时同步到 habits log（月度表格）
   */
  async toggleHabit(date: Date | string, habitName: string): Promise<boolean> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getDailyNote(d);
    const fm = this.parseFrontmatter(content);
    const habits = fm.habits || {};
    const current = !!habits[habitName];
    const newState = !current;
    habits[habitName] = newState;
    const newContent = this.mergeFrontmatter(content, { habits });
    await this.app.vault.modify(file, newContent);
    // 同步到 habits log（newState=true 加✓，false 移除✓）
    await this.setHabitsLogCell(d, habitName, newState);
    return newState;
  }

  /** 计算 habit 的连续打卡天数 */
  async getHabitStreak(habitName: string, endDate: Date = new Date()): Promise<number> {
    let streak = 0;
    let cursor = new Date(endDate);
    // 如果今天还没打卡，从昨天开始算
    const todayHabits = await this.getHabits(toISODate(cursor));
    if (!todayHabits[habitName]) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    for (let i = 0; i < 365; i++) {
      const iso = toISODate(cursor);
      // 快速检查：如果文件不存在则中断
      const path = this.getDailyNotePath(cursor);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) break;
      const habits = await this.getHabits(iso);
      if (habits[habitName]) {
        streak++;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  /** 设置 habits log 月历的某个单元格
   * checked=true → 写 ✓
   * checked=false → 清空
   *
   * 月历格式（每个习惯一个月历）：
   *
   * ## 2026-10
   *
   * ### 早起
   *
   * | 一 | 二 | 三 | 四 | 五 | 六 | 日 |
   * |---|---|---|---|---|---|---|
   * |   |   |   | 1✓ | 2  | 3  | 4  |
   * | 5✓ | 6✓ | 7  | 8✓ | 9  | 10 | 11 |
   * ...
   *
   * 历史记录保持不变：配置改变后，过去月份的月历是快照
   */
  private async setHabitsLogCell(
    date: Date | string,
    habitName: string,
    checked: boolean,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();

    const path = this.getHabitsLogPath();
    const file = await this.ensureFile(path, `# 打卡日志\n\n`);
    let content = await this.app.vault.read(file);

    const monthHeader = `## ${year}-${String(month).padStart(2, "0")}`;

    // 找到月份章节
    const lines = content.split("\n");
    let monthStart = -1;
    let monthEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === monthHeader) {
        monthStart = i;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^##\s/.test(lines[j])) {
            monthEnd = j;
            break;
          }
        }
        break;
      }
    }

    // 在月份章节内找习惯的月历
    const monthLines = monthStart >= 0 ? lines.slice(monthStart + 1, monthEnd) : [];
    const habitHeader = `### ${habitName}`;

    // 找习惯章节
    let habitStart = -1;
    let habitEnd = monthLines.length;
    for (let i = 0; i < monthLines.length; i++) {
      if (monthLines[i].trim() === habitHeader) {
        habitStart = i;
        for (let j = i + 1; j < monthLines.length; j++) {
          if (/^###\s/.test(monthLines[j])) {
            habitEnd = j;
            break;
          }
        }
        break;
      }
    }

    // 解析已有月历表格
    const habitLines = habitStart >= 0 ? monthLines.slice(habitStart + 1, habitEnd) : [];
    const tableLines = habitLines.filter((l) => l.startsWith("|"));

    // dayCells: day -> "✓" or ""
    const dayCells: Map<number, string> = new Map();
    for (const tl of tableLines) {
      if (/^[-:\s|]+$/.test(tl)) continue;
      const cells = tl.split("|").map((c) => c.trim());
      const clean = cells.slice(1, -1);
      if (clean[0] === "一" || clean[0] === "二") continue; // 表头
      for (const cell of clean) {
        // 匹配 "1✓" 或 "1" 或 ""
        const m = cell.match(/^(\d+)(✓?)$/);
        if (m) {
          const dayNum = parseInt(m[1], 10);
          if (m[2] === "✓") dayCells.set(dayNum, "✓");
        }
      }
    }

    // 更新目标单元格
    if (checked) {
      dayCells.set(day, "✓");
    } else {
      dayCells.delete(day);
    }

    // 重新生成月历表格
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1);
    // 周一=0, 周二=1, ..., 周日=6
    const firstDayOffset = (firstDay.getDay() + 6) % 7;

    const headerLine = "| 一 | 二 | 三 | 四 | 五 | 六 | 日 |";
    const sepLine = "|---|---|---|---|---|---|---|";
    const newTableLines: string[] = [headerLine, sepLine];

    // 生成网格
    const totalCells = Math.ceil((daysInMonth + firstDayOffset) / 7) * 7;
    let cellIndex = 0;
    while (cellIndex < totalCells) {
      let line = "|";
      for (let col = 0; col < 7; col++) {
        if (cellIndex >= firstDayOffset && cellIndex < firstDayOffset + daysInMonth) {
          const dayNum = cellIndex - firstDayOffset + 1;
          const mark = dayCells.get(dayNum) || "";
          line += ` ${dayNum}${mark} |`;
        } else {
          line += `   |`;
        }
        cellIndex++;
      }
      newTableLines.push(line);
    }

    // 重新组装
    // 月份章节内容
    const newMonthContent: string[] = [];
    // 保留月份章节内习惯之前的内容
    if (habitStart >= 0) {
      newMonthContent.push(...monthLines.slice(0, habitStart));
    }
    // 习惯月历
    newMonthContent.push(habitHeader);
    newMonthContent.push("");
    newMonthContent.push(...newTableLines);
    newMonthContent.push("");
    // 保留该习惯之后的内容（其他习惯）
    if (habitStart >= 0 && habitEnd < monthLines.length) {
      newMonthContent.push(...monthLines.slice(habitEnd));
    }

    // 重新组装全文
    const beforeMonth = monthStart >= 0 ? lines.slice(0, monthStart + 1) : [];
    const afterMonth = monthStart >= 0 && monthEnd < lines.length ? lines.slice(monthEnd) : [];

    const newLines: string[] = [];
    if (monthStart < 0) {
      // 新月份
      newLines.push(...lines.slice(0, lines.length));
      newLines.push(monthHeader);
      newLines.push("");
      newLines.push(...newMonthContent);
    } else {
      newLines.push(...beforeMonth);
      newLines.push(...newMonthContent);
      newLines.push(...afterMonth);
    }

    const newContent = newLines.join("\n");
    await this.app.vault.modify(file, newContent);
  }

  // ---------- 周任务操作 ----------

  /** 获取或创建 weekly note */
  async getWeeklyNote(date: Date | string): Promise<{ file: TFile; content: string }> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const path = this.getWeeklyNotePath(d);
    const wk = weekKey(d);
    const monday = parseWeekKey(wk);
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(toISODate(addDays(monday, i)));
    }
    const initial = `# 周计划 ${wk}\n\n> 周一 ${weekDays[0]} ~ 周日 ${weekDays[6]}\n\n`;
    const file = await this.ensureFile(path, initial);
    const content = await this.app.vault.read(file);
    return { file, content };
  }

  /** 获取周任务矩阵：category -> day -> boolean */
  async getWeeklyTasks(
    date: Date | string,
  ): Promise<Record<string, Array<boolean | null>>> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { content } = await this.getWeeklyNote(d);
    const categories = this.settings.weeklyCategories.map((c) => c.name);
    const result: Record<string, Array<boolean | null>> = {};
    for (const cat of categories) {
      result[cat] = [null, null, null, null, null, null, null];
    }
    const lines = content.split("\n");
    for (const line of lines) {
      // 格式: - [x] 工作 | 2026-10-13
      const m = line.match(/^-\s*\[( |x|X)\]\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})/);
      if (m) {
        const checked = m[1].toLowerCase() === "x";
        const cat = m[2].trim();
        const dayStr = m[3];
        if (categories.includes(cat)) {
          const monday = parseWeekKey(weekKey(d));
          for (let i = 0; i < 7; i++) {
            if (toISODate(addDays(monday, i)) === dayStr) {
              result[cat][i] = checked;
              break;
            }
          }
        }
      }
    }
    return result;
  }

  /** 切换某周任务状态 */
  async toggleWeeklyTask(
    date: Date | string,
    category: string,
    dayIndex: number,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getWeeklyNote(d);
    const wk = weekKey(d);
    const monday = parseWeekKey(wk);
    const targetDate = toISODate(addDays(monday, dayIndex));

    const lines = content.split("\n");
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /^-\s*\[( |x|X)\]\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})/,
      );
      if (m && m[2].trim() === category && m[3] === targetDate) {
        const currentChecked = m[1].toLowerCase() === "x";
        const newCheck = currentChecked ? " " : "x";
        lines[i] = lines[i].replace(
          /^-\s*\[( |x|X)\]/,
          `- [${newCheck}]`,
        );
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(`- [x] ${category} | ${targetDate}`);
    }
    await this.app.vault.modify(file, lines.join("\n"));
  }

  /**
   * 联动：当日任务完成/取消时，同步到周打卡管理
   * 如果任务有标签匹配周打卡分类，则同步该分类的周打卡状态
   */
  async syncDailyTaskToWeekly(
    date: Date | string,
    task: ParsedTask,
  ): Promise<void> {
    const categories = this.settings.weeklyCategories.map((c) => c.name);
    // 检查任务标签是否匹配某个周打卡分类
    const matchedCats: string[] = [];
    for (const tag of task.tags) {
      const cleanTag = tag.replace(/^#/, "");
      if (categories.includes(cleanTag)) {
        matchedCats.push(cleanTag);
      }
    }
    if (matchedCats.length === 0) return;

    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getWeeklyNote(d);
    const monday = parseWeekKey(weekKey(d));
    const targetDate = toISODate(addDays(monday, this.getDayIndex(d)));
    const lines = content.split("\n");

    for (const cat of matchedCats) {
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(
          /^-\s*\[( |x|X)\]\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})/,
        );
        if (m && m[2].trim() === cat && m[3] === targetDate) {
          const newCheck = task.checked ? "x" : " ";
          lines[i] = lines[i].replace(
            /^-\s*\[( |x|X)\]/,
            `- [${newCheck}]`,
          );
          found = true;
          break;
        }
      }
      if (!found && task.checked) {
        lines.push(`- [x] ${cat} | ${targetDate}`);
      }
    }
    await this.app.vault.modify(file, lines.join("\n"));
  }

  /**
   * 联动：周打卡切换时，同步到当日任务
   * 在当日任务列表中添加/移除对应分类的任务
   */
  async syncWeeklyToDailyTask(
    date: Date | string,
    category: string,
    checked: boolean,
  ): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const tasks = await this.getTasks(d);
    // 查找是否有匹配分类的任务
    const matchingTask = tasks.find((t) =>
      t.tags.includes(`#${category}`),
    );

    if (checked && !matchingTask) {
      // 添加一个对应分类的任务
      await this.addTask(d, {
        description: `${category}完成`,
        priority: "none",
        tags: [`#${category}`],
        checked: true,
      });
    } else if (!checked && matchingTask) {
      // 取消对应任务的完成状态
      await this.updateTask(d, matchingTask.lineIndex, {
        checked: false,
      });
    } else if (checked && matchingTask && !matchingTask.checked) {
      // 标记对应任务为完成
      await this.updateTask(d, matchingTask.lineIndex, {
        checked: true,
      });
    }
  }

  /** 获取日期在周中的索引（0=周一） */
  private getDayIndex(date: Date): number {
    const day = date.getDay();
    return day === 0 ? 6 : day - 1;
  }

  /** 获取/保存周复盘文本 */
  async getWeeklyReview(date: Date | string): Promise<string> {
    const { content } = await this.getWeeklyNote(date);
    const m = content.match(/##\s*周复盘([\s\S]*?)(?:##|$)/);
    return m ? m[1].trim() : "";
  }

  async saveWeeklyReview(date: Date | string, text: string): Promise<void> {
    const d = typeof date === "string" ? fromISODate(date) : date;
    const { file, content } = await this.getWeeklyNote(d);
    let newContent: string;
    if (content.includes("## 周复盘")) {
      newContent = content.replace(
        /##\s*周复盘[\s\S]*?(?=##|$)/,
        `## 周复盘\n${text}\n\n`,
      );
    } else {
      newContent = content + `\n## 周复盘\n${text}\n\n`;
    }
    await this.app.vault.modify(file, newContent);
  }

  // ---------- 番茄钟专注记录 ----------

  /** 增加专注分钟数到当日 */
  async addFocusMinutes(date: Date | string, minutes: number): Promise<void> {
    const fm = await this.getDailyFrontmatter(date);
    const current = Number(fm.focusMinutes) || 0;
    await this.updateDailyFrontmatter(date, { focusMinutes: current + minutes });
  }

  async getFocusMinutes(date: Date | string): Promise<number> {
    const fm = await this.getDailyFrontmatter(date);
    return Number(fm.focusMinutes) || 0;
  }

  // ---------- 辅助：Frontmatter 解析 ----------

  private parseFrontmatter(content: string): Record<string, any> {
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const yaml = m[1];
    const result: Record<string, any> = {};
    // 简易 YAML 解析（支持 key: value 和嵌套 map，支持中文 key）
    const lines = yaml.split("\n");
    let currentKey = "";
    let inMap = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      // 用 [^\s:]+ 匹配 key，兼容中文、特殊字符
      const kvMatch = line.match(/^([^\s:]+):\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const val = kvMatch[2].trim();
        if (val === "" || val === "{}") {
          // 可能是嵌套 map
          if (val === "{}") {
            result[currentKey] = {};
            inMap = false;
          } else {
            inMap = true;
            result[currentKey] = {};
          }
        } else {
          // 尝试解析为各种类型
          if (val === "true") result[currentKey] = true;
          else if (val === "false") result[currentKey] = false;
          else if (val === "null" || val === "~") result[currentKey] = null;
          else if (/^-?\d+$/.test(val)) result[currentKey] = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) result[currentKey] = parseFloat(val);
          else result[currentKey] = val.replace(/^['"]|['"]$/g, "");
          inMap = false;
        }
      } else if (inMap && line.startsWith("  ")) {
        // 子 key 也用 [^\s:]+ 匹配，兼容中文
        const subMatch = line.match(/^\s+([^\s:]+):\s*(.*)$/);
        if (subMatch && currentKey) {
          const subVal = subMatch[2].trim();
          if (subVal === "true") (result[currentKey] as any)[subMatch[1]] = true;
          else if (subVal === "false") (result[currentKey] as any)[subMatch[1]] = false;
          else (result[currentKey] as any)[subMatch[1]] = subVal;
        }
      }
    }
    return result;
  }

  private mergeFrontmatter(content: string, updates: Record<string, any>): string {
    const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (!fmMatch) {
      // 没有 frontmatter，新建一个
      const yaml = this.stringifyYaml(updates);
      return `---\n${yaml}\n---\n\n${content}`;
    }
    const existingFm = this.parseFrontmatter(content);
    const merged = { ...existingFm, ...updates };
    const yaml = this.stringifyYaml(merged);
    return content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${yaml}\n---`,
    );
  }

  private stringifyYaml(obj: Record<string, any>, indent = ""): string {
    const lines: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined) {
        lines.push(`${indent}${key}: `);
      } else if (typeof val === "object" && !Array.isArray(val)) {
        if (Object.keys(val).length === 0) {
          lines.push(`${indent}${key}: {}`);
        } else {
          lines.push(`${indent}${key}:`);
          lines.push(this.stringifyYaml(val, indent + "  "));
        }
      } else if (typeof val === "string") {
        lines.push(`${indent}${key}: ${val}`);
      } else {
        lines.push(`${indent}${key}: ${val}`);
      }
    }
    return lines.join("\n");
  }

  // ---------- 辅助：章节操作 ----------

  private findSectionStart(content: string, sectionHeader: string): number {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionHeader) return i;
    }
    return -1;
  }

  private findNextSectionStart(content: string, afterLine: number): number {
    const lines = content.split("\n");
    for (let i = afterLine + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) return i;
    }
    return -1;
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

  private replaceSection(content: string, sectionHeader: string, newBody: string): string {
    const lines = content.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionHeader) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      // 章节不存在，追加
      return content + `\n${sectionHeader}\n${newBody}\n`;
    }
    // 找到下一个 ## 章节开始
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const before = lines.slice(0, start + 1);
    const after = lines.slice(end);
    return [...before, newBody, "", ...after].join("\n");
  }

  private appendLineToSection(content: string, sectionHeader: string, line: string): string {
    const lines = content.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionHeader) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      // 章节不存在，追加
      return content + `\n${sectionHeader}\n${line}\n`;
    }
    // 找到下一个 ## 章节开始
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    // 在 end 之前插入新行
    const before = lines.slice(0, end);
    const after = lines.slice(end);
    // 处理空行
    const insertLines = [line];
    return [...before, ...insertLines, ...after].join("\n");
  }

  private nowHM(): string {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}
