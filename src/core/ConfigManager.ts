/**
 * 配置文件管理器
 *
 * 配置文件路径: <vault>/LifePanel/config.md
 *
 * 配置文件格式（Markdown 表格）:
 *
 * # 生活面板配置
 *
 * > 在此文件中配置打卡习惯、任务类型等。修改后运行命令「生活面板: 重新加载配置」即可生效。
 *
 * ## 打卡习惯
 *
 * | 名称 | 图标 | 类型 | 周目标 | 打卡日 | 开始日期 | 结束日期 |
 * |------|------|------|--------|--------|----------|----------|
 * | 早起 | 🌅 | 健康 | 7 | 一二三四五六日 | | |
 * | 运动 | 🏃 | 运动 | 5 | 一二三四五 | | |
 * | 读书 | 📚 | 学习 | 7 | 一二三四五六日 | | |
 * | 早睡 | 🌙 | 健康 | 7 | 一二三四五六日 | | |
 *
 * 打卡日：用「一二三四五六日」组合，留空=每天
 *
 * ## 任务类型
 *
 * | 类型代码 | 中文名 | 颜色 | 标签 |
 * |----------|--------|------|------|
 * | work | 工作 | #5e81ac | #工作 |
 * | study | 学习 | #a3be8c | #学习 |
 * | exercise | 运动 | #d08770 | #运动 |
 * | reading | 读书 | #b48ead | #读书 |
 * | life | 生活 | #ebcb8b | #生活 |
 *
 * ## 番茄钟
 *
 * - 专注时长: 25
 * - 休息时长: 5
 *
 * ## 每日复盘问题
 *
 * 1. 今天完成了什么？
 * 2. 今天学到了什么？
 * 3. 明天的重点是什么？
 */

import { App, TFile, normalizePath } from "obsidian";
import { LifePanelSettings, HabitConfig, normalizeHabitType } from "./types";

const CONFIG_HEADER = `# 生活面板配置

> 在此文件中配置打卡习惯、任务类型等。修改后运行命令「生活面板: 重新加载配置」即可生效。

## 打卡习惯

| 名称 | 图标 | 类型 | 周目标 | 打卡日 | 开始日期 | 结束日期 |
|------|------|------|--------|--------|----------|----------|
| 早起 | 🌅 | 健康 | 7 | 一二三四五六日 | | |
| 冥想 | 🧘 | 生活 | 7 | 一二三四五六日 | | |
| 运动 | 🏃 | 运动 | 5 | 一二三四五 | | |
| 读书 | 📚 | 学习 | 7 | 一二三四五六日 | | |
| 早睡 | 🌙 | 健康 | 7 | 一二三四五六日 | | |

打卡日：用「一二三四五六日」组合，留空=每天

## 任务类型

| 类型代码 | 中文名 | 颜色 | 标签 |
|----------|--------|------|------|
| work | 工作 | #5e81ac | #工作 |
| study | 学习 | #a3be8c | #学习 |
| exercise | 运动 | #d08770 | #运动 |
| reading | 读书 | #b48ead | #读书 |
| life | 生活 | #ebcb8b | #生活 |

## 番茄钟

- 专注时长: 25
- 休息时长: 5

## 每日复盘问题

1. 今天完成了什么？
2. 今天学到了什么？
3. 明天的重点是什么？
`;

/** 打卡日字符串解析：一→1, 二→2...日→7 */
function parseDaysOfWeek(raw: string): number[] {
  if (!raw || !raw.trim()) return [1, 2, 3, 4, 5, 6, 7];
  const map: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  };
  const result: number[] = [];
  for (const ch of raw) {
    const n = map[ch];
    if (n && !result.includes(n)) result.push(n);
  }
  return result.length > 0 ? result : [1, 2, 3, 4, 5, 6, 7];
}

export interface TaskTypeConfig {
  code: string;
  label: string;
  color: string;
  tag: string;
}

export class ConfigManager {
  constructor(public app: App, public settings: LifePanelSettings) {}

  getConfigPath(): string {
    return normalizePath(`${this.settings.folder}/config.md`);
  }

  async ensureConfigFile(): Promise<TFile> {
    const path = this.getConfigPath();
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    // 创建文件夹
    const folder = path.substring(0, path.lastIndexOf("/"));
    if (folder) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // 文件夹已存在
      }
    }

    return await this.app.vault.create(path, CONFIG_HEADER);
  }

  async loadConfig(): Promise<{
    habits: HabitConfig[];
    taskTypes: TaskTypeConfig[];
    pomodoroFocus: number;
    pomodoroBreak: number;
    reviewQuestions: string[];
  }> {
    const file = await this.ensureConfigFile();
    const content = await this.app.vault.read(file);

    return {
      habits: this.parseHabits(content),
      taskTypes: this.parseTaskTypes(content),
      pomodoroFocus: this.parseNumber(content, "专注时长", this.settings.pomodoroFocus),
      pomodoroBreak: this.parseNumber(content, "休息时长", this.settings.pomodoroBreak),
      reviewQuestions: this.parseReviewQuestions(content),
    };
  }

  /** 解析打卡习惯表格 */
  private parseHabits(content: string): HabitConfig[] {
    const section = this.extractSection(content, "## 打卡习惯");
    if (!section) return [];

    const rows = this.parseTable(section);
    const habits: HabitConfig[] = [];

    for (const row of rows) {
      const name = (row["名称"] || "").trim();
      if (!name) continue;
      const icon = (row["图标"] || "✨").trim();
      const type = normalizeHabitType(row["类型"]);
      const target = parseInt(row["周目标"] || "7", 10) || 7;
      const daysRaw = (row["打卡日"] || "").trim();
      const startDate = (row["开始日期"] || "").trim() || null;
      const endDate = (row["结束日期"] || "").trim() || null;

      habits.push({
        name,
        icon,
        targetPerWeek: target,
        habitType: type,
        startDate,
        endDate,
        archived: false,
        createdDate: new Date().toISOString().slice(0, 10),
        archivedDate: null,
        archivedReason: null,
        daysOfWeek: parseDaysOfWeek(daysRaw),
      });
    }

    return habits;
  }

  /** 解析任务类型表格 */
  private parseTaskTypes(content: string): TaskTypeConfig[] {
    const section = this.extractSection(content, "## 任务类型");
    if (!section) return [];

    const rows = this.parseTable(section);
    const types: TaskTypeConfig[] = [];

    for (const row of rows) {
      const code = (row["类型代码"] || "").trim();
      if (!code) continue;
      types.push({
        code,
        label: (row["中文名"] || code).trim(),
        color: (row["颜色"] || "#8f9192").trim(),
        tag: (row["标签"] || "").trim(),
      });
    }

    return types;
  }

  /** 解析数字配置 */
  private parseNumber(content: string, key: string, defaultValue: number): number {
    const re = new RegExp(`-\\s*${key}\\s*:\\s*(\\d+)`);
    const m = content.match(re);
    return m ? parseInt(m[1], 10) : defaultValue;
  }

  /** 解析复盘问题列表 */
  private parseReviewQuestions(content: string): string[] {
    const section = this.extractSection(content, "## 每日复盘问题");
    if (!section) return [];

    const questions: string[] = [];
    const lines = section.split("\n");
    for (const line of lines) {
      const m = line.match(/^\d+\.\s*(.+)/);
      if (m) questions.push(m[1].trim());
    }
    return questions;
  }

  /** 提取 Markdown 章节 */
  private extractSection(content: string, header: string): string | null {
    const lines = content.split("\n");
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === header) {
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

  /** 解析 Markdown 表格为对象数组 */
  private parseTable(section: string): Array<Record<string, string>> {
    const lines = section.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];

    // 第一行是表头
    const headers = lines[0]
      .split("|")
      .map((h) => h.trim())
      .filter((h) => h);

    // 第二行是分隔线（|---|---|），跳过
    const dataLines = lines.slice(1).filter((l) => !l.match(/^\|[-:\s|]+$/));

    const rows: Array<Record<string, string>> = [];
    for (const line of dataLines) {
      // 按 | 分割，不去掉空 cell（保持列对齐）
      const rawCells = line.split("|").map((c) => c.trim());
      // 去掉首尾空 cell（来自行首/行尾的 |）
      const cells = rawCells.slice(1, -1);
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = cells[i] || "";
      }
      rows.push(row);
    }
    return rows;
  }
}
