/**
 * 任务行解析 - 兼容 obsidian-tasks-plugin 的 emoji 语法
 *
 * 支持的语法：
 *   - [ ] / - [x]          复选框
 *   🔺 ⏫ 🔼 🔽             优先级（最高/高/中/低）
 *   📅 YYYY-MM-DD          截止日 (due)
 *   ⏳ YYYY-MM-DD          计划日 (scheduled)
 *   🛫 YYYY-MM-DD          开始日 (start)
 *   🔁 every ...           循环
 *   ✅ YYYY-MM-DD          完成日
 *   ➕ YYYY-MM-DD          创建日
 *   ⏰ HH:MM               具体时间
 *   #tag                   标签
 *   !urgent                紧急标记
 *   *important             重要标记
 */

import { Priority, ParsedTask, TaskType } from "./types";

// emoji 优先级映射
const PRIORITY_EMOJI: Record<string, Priority> = {
  "🔺": "highest",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
};

// 反向映射：优先级 -> emoji（写入时使用）
export const PRIORITY_TO_EMOJI: Record<Priority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  none: "",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  highest: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
  none: "无",
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const DATE_PATTERNS: Array<{ key: keyof ParsedTask; emoji: string }> = [
  { key: "dueDate", emoji: "📅" },
  { key: "scheduledDate", emoji: "⏳" },
  { key: "startDate", emoji: "🛫" },
  { key: "doneDate", emoji: "✅" },
  { key: "createdDate", emoji: "➕" },
];

const TASK_LINE_RE = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/;

/** 从标签推断任务类型 */
function inferTaskType(tags: string[]): TaskType {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower.includes("work") || lower.includes("工作")) return "work";
    if (lower.includes("study") || lower.includes("学习")) return "study";
    if (lower.includes("exercise") || lower.includes("运动") || lower.includes("exercise")) return "exercise";
    if (lower.includes("read") || lower.includes("读书") || lower.includes("阅读")) return "reading";
    if (lower.includes("life") || lower.includes("生活")) return "life";
  }
  return "other";
}

export function parseTaskLine(line: string, lineIndex = -1): ParsedTask | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;

  const indent = m[1];
  const tabs = (indent.match(/\t/g) || []).length;
  const spaces = (indent.match(/ /g) || []).length;
  const indentLevel = tabs + Math.floor(spaces / 2);

  const checked = m[2].toLowerCase() === "x";
  const rest = m[3];

  const task: ParsedTask = {
    raw: line,
    description: "",
    checked,
    priority: "none",
    dueDate: null,
    scheduledDate: null,
    startDate: null,
    tags: [],
    indentLevel,
    recurrence: null,
    doneDate: null,
    createdDate: null,
    lineIndex,
    time: null,
    urgent: false,
    important: false,
    taskType: "other",
    focusMinutes: 0,
  };

  let working = rest;

  // 紧急标记 !urgent 或 ❗
  if (/!urgent/i.test(working) || working.includes("❗")) {
    task.urgent = true;
    working = working.replace(/!urgent/gi, "").replace(/❗/g, "").trim();
  }

  // 重要标记 *important 或 ⭐
  if (/\*important/i.test(working) || working.includes("⭐")) {
    task.important = true;
    working = working.replace(/\*important/gi, "").replace(/⭐/g, "").trim();
  }

  // 具体时间 ⏰ HH:MM
  const timeMatch = working.match(/⏰\s*(\d{1,2}:\d{2})/);
  if (timeMatch) {
    task.time = timeMatch[1];
    working = working.replace(timeMatch[0], "").trim();
  }

  // 优先级 emoji
  for (const [emoji, prio] of Object.entries(PRIORITY_EMOJI)) {
    if (working.includes(emoji)) {
      task.priority = prio;
      working = working.replace(emoji, "").trim();
      break;
    }
  }

  // 日期 emoji
  for (const { key, emoji } of DATE_PATTERNS) {
    const re = new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`);
    const dm = working.match(re);
    if (dm) {
      (task[key] as string) = dm[1];
      working = working.replace(dm[0], "").trim();
    }
  }

  // 循环 🔁 every day / every week ...
  const recurRe = /(🔁\s+every[^\n]*)/;
  const rm = working.match(recurRe);
  if (rm) {
    task.recurrence = rm[1].trim();
    working = working.replace(rm[0], "").trim();
  }

  // 番茄钟累积分钟 🍅 Nm 或 🍅 N
  const pomoMatch = working.match(/🍅\s*(\d+)\s*m?/);
  if (pomoMatch) {
    task.focusMinutes = parseInt(pomoMatch[1], 10) || 0;
    working = working.replace(pomoMatch[0], "").trim();
  }

  // 标签
  const tagRe = /(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(working)) !== null) {
    task.tags.push(`#${tm[1]}`);
  }
  working = working.replace(/(?:^|\s)#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g, "").trim();

  task.description = working;

  // 推断任务类型
  task.taskType = inferTaskType(task.tags);

  return task;
}

export function serializeTask(task: ParsedTask): string {
  const indent = task.indentLevel > 0 ? "  ".repeat(task.indentLevel) : "";
  const check = task.checked ? "x" : " ";
  let desc = task.description;

  // 紧急标记
  if (task.urgent) desc += " ❗";
  // 重要标记
  if (task.important) desc += " ⭐";

  // 标签
  for (const tag of task.tags) {
    if (!desc.includes(tag)) {
      desc += ` ${tag}`;
    }
  }

  // 优先级 emoji
  const prioEmoji = PRIORITY_TO_EMOJI[task.priority];
  if (prioEmoji) {
    desc += ` ${prioEmoji}`;
  }

  // 具体时间
  if (task.time) desc += ` ⏰ ${task.time}`;

  // 日期 emoji
  if (task.dueDate) desc += ` 📅 ${task.dueDate}`;
  if (task.scheduledDate) desc += ` ⏳ ${task.scheduledDate}`;
  if (task.startDate) desc += ` 🛫 ${task.startDate}`;
  if (task.recurrence) desc += ` ${task.recurrence}`;
  if (task.createdDate) desc += ` ➕ ${task.createdDate}`;
  if (task.doneDate) desc += ` ✅ ${task.doneDate}`;
  if (task.focusMinutes > 0) desc += ` 🍅 ${task.focusMinutes}m`;

  return `${indent}- [${check}] ${desc}`;
}

/** 从 markdown 文本中提取所有任务行（保留顺序与行号） */
export function parseTasksFromText(text: string): ParsedTask[] {
  const lines = text.split("\n");
  const tasks: ParsedTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = parseTaskLine(lines[i], i);
    if (t) tasks.push(t);
  }
  return tasks;
}

/** 给定一段 markdown 文本，把指定行号的任务替换/重写后返回新文本 */
export function rewriteTaskLine(
  text: string,
  lineIndex: number,
  newTask: ParsedTask,
): string {
  const lines = text.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return text;
  lines[lineIndex] = serializeTask(newTask);
  return lines.join("\n");
}
