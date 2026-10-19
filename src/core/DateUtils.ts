/**
 * 日期工具 - ISO 周（周一为起始，符合中国习惯）
 */

export const WEEK_DAYS_ZH = ["一", "二", "三", "四", "五", "六", "日"];
export const MONTH_NAMES_ZH = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Date -> 'YYYY-MM-DD' (local time) */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date (local midnight) */
export function fromISODate(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function today(): string {
  return toISODate(new Date());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

/** 周一为一周起始；返回周一的 Date */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** ISO week number (ISO 8601) */
export function isoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
}

/** ISO week year (周所属的年，跨年时可能±1) */
export function isoWeekYear(d: Date): number {
  const date = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayNr + 3);
  return date.getFullYear();
}

/** e.g. '2026-W42' */
export function weekKey(d: Date): string {
  return `${isoWeekYear(d)}-W${pad2(isoWeekNumber(d))}`;
}

/** 把 '2026-W42' 解析为该周周一的 Date */
export function parseWeekKey(key: string): Date {
  const m = key.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return startOfWeek(new Date());
  const year = Number(m[1]);
  const week = Number(m[2]);
  // 简单算法：1月4日所在那周为第一周
  const jan4 = new Date(year, 0, 4);
  const week1Monday = startOfWeek(jan4);
  return addDays(week1Monday, (week - 1) * 7);
}

/** 当月所有天的 Date 数组（按日历布局需要前后补齐） */
export function getMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeek(first);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(addDays(gridStart, i));
  }
  return days;
}

export function diffDays(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

/** 时间戳 HH:MM */
export function nowHM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 友好的相对时间描述 */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  return toISODate(d);
}
