/**
 * 共享类型定义
 */

export type Priority = "highest" | "high" | "medium" | "low" | "none";

/** 任务类型 */
export type TaskType = "work" | "study" | "exercise" | "reading" | "life" | "other";

/** 任务时间类型 */
export type TaskTimeType = "none" | "morning" | "afternoon" | "evening" | "specific";

export interface ParsedTask {
  raw: string;
  description: string;
  checked: boolean;
  priority: Priority;
  dueDate: string | null;
  scheduledDate: string | null;
  startDate: string | null;
  tags: string[];
  indentLevel: number;
  recurrence: string | null;
  doneDate: string | null;
  createdDate: string | null;
  lineIndex: number;
  /** 自定义扩展字段 */
  time: string | null;          // 具体时间 HH:MM
  urgent: boolean;              // 是否紧急
  important: boolean;           // 是否重要
  taskType: TaskType;           // 任务类型
  focusMinutes: number;         // 累积专注分钟数
}

export interface HabitConfig {
  name: string;
  icon: string;
  targetPerWeek: number;
  /** 习惯类型，决定颜色 */
  habitType: "health" | "study" | "work" | "life" | "sport";
  /** 有效期开始（ISO 日期），null 表示无限制 */
  startDate: string | null;
  /** 有效期结束（ISO 日期），null 表示无限制 */
  endDate: string | null;
  /** 是否归档 */
  archived: boolean;
  /** 创建日期 */
  createdDate: string;
  /** 归档日期 */
  archivedDate: string | null;
  /** 归档原因 */
  archivedReason: string | null;
  /** 每周哪几天需要打卡，1=周一...7=周日，空数组=每天都要 */
  daysOfWeek: number[];
}

export interface WeeklyCategory {
  name: string;
  icon: string;
}

export interface LifePanelSettings {
  folder: string;
  useDailyNotes: boolean;
  dailyNoteFormat: string;
  dailyNoteFolder: string;
  habits: HabitConfig[];
  archivedHabits: HabitConfig[];
  weeklyCategories: WeeklyCategory[];
  pomodoroFocus: number;
  pomodoroBreak: number;
  reviewQuestions: string[];
  theme: "auto" | "light" | "dark";
  taskTemplates: string[];
  /** 模块顺序，存模块 id 数组 */
  moduleOrder: string[];
}

export const DEFAULT_SETTINGS: LifePanelSettings = {
  folder: "LifePanel",
  useDailyNotes: false,
  dailyNoteFormat: "YYYY-MM-DD",
  dailyNoteFolder: "",
  habits: [
    { name: "早起", icon: "🌅", targetPerWeek: 7, habitType: "health", startDate: null, endDate: null, archived: false, createdDate: "2024-01-01", archivedDate: null, archivedReason: null, daysOfWeek: [1,2,3,4,5,6,7] },
    { name: "冥想", icon: "🧘", targetPerWeek: 7, habitType: "life", startDate: null, endDate: null, archived: false, createdDate: "2024-01-01", archivedDate: null, archivedReason: null, daysOfWeek: [1,2,3,4,5,6,7] },
    { name: "运动", icon: "🏃", targetPerWeek: 5, habitType: "sport", startDate: null, endDate: null, archived: false, createdDate: "2024-01-01", archivedDate: null, archivedReason: null, daysOfWeek: [1,2,3,4,5] },
    { name: "读书", icon: "📚", targetPerWeek: 7, habitType: "study", startDate: null, endDate: null, archived: false, createdDate: "2024-01-01", archivedDate: null, archivedReason: null, daysOfWeek: [1,2,3,4,5,6,7] },
    { name: "早睡", icon: "🌙", targetPerWeek: 7, habitType: "health", startDate: null, endDate: null, archived: false, createdDate: "2024-01-01", archivedDate: null, archivedReason: null, daysOfWeek: [1,2,3,4,5,6,7] },
  ],
  archivedHabits: [],
  weeklyCategories: [
    { name: "工作", icon: "💼" },
    { name: "学习", icon: "📖" },
    { name: "运动", icon: "🏋️" },
    { name: "读书", icon: "📕" },
  ],
  pomodoroFocus: 25,
  pomodoroBreak: 5,
  reviewQuestions: [
    "今天完成了什么？",
    "今天学到了什么？",
    "明天的重点是什么？",
  ],
  theme: "auto",
  taskTemplates: [
    "整理邮件 ⭐️P2 #工作",
    "代码审查 ⭐️P1 #工作",
    "阅读 30 分钟 ⭐️P3 #学习",
    "运动 30 分钟 ⭐️P2 #健康",
  ],
  moduleOrder: [
    "calendar",
    "week-calendar",
    "inspiration",
    "review",
    "pomodoro",
    "stats",
    "recent",
  ],
};

/** 习惯类型颜色映射 */
export const HABIT_TYPE_COLORS: Record<string, string> = {
  health: "#bf616a",   // 红色 - 健康
  study: "#a3be8c",    // 绿色 - 学习
  work: "#5e81ac",     // 蓝色 - 工作
  life: "#ebcb8b",     // 黄色 - 生活
  sport: "#d08770",    // 橙色 - 运动
};

/** 习惯类型中文名 */
export const HABIT_TYPE_LABELS: Record<string, string> = {
  health: "健康",
  study: "学习",
  work: "工作",
  life: "生活",
  sport: "运动",
};

/** 把任意输入（中文标签或英文 key）归一化为英文 key */
export function normalizeHabitType(input: string | undefined | null): HabitConfig["habitType"] {
  if (!input) return "life";
  const s = input.trim();
  // 反向映射：中文 → 英文 key
  const reverse: Record<string, string> = {};
  for (const k of Object.keys(HABIT_TYPE_LABELS)) {
    reverse[HABIT_TYPE_LABELS[k]] = k;
  }
  if (reverse[s]) return reverse[s] as HabitConfig["habitType"];
  if (["health", "study", "work", "life", "sport"].includes(s)) {
    return s as HabitConfig["habitType"];
  }
  return "life";
}

/** 任务类型颜色映射 */
export const TASK_TYPE_COLORS: Record<string, string> = {
  work: "#5e81ac",
  study: "#a3be8c",
  exercise: "#d08770",
  reading: "#b48ead",
  life: "#ebcb8b",
  other: "#8f9192",
};

/** 任务类型中文名 */
export const TASK_TYPE_LABELS: Record<string, string> = {
  work: "工作",
  study: "学习",
  exercise: "运动",
  reading: "读书",
  life: "生活",
  other: "其他",
};
