// 日期工具：统一按"天"处理，避免时区/时分秒误差
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD -> Date(UTC 00:00)，非法输入返回 null */
export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // 拒绝 2026-02-31 这类被 Date 自动进位的值
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    return null;
  }
  return d;
}

export function isValidDate(value) {
  return parseDate(value) !== null;
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

/** 加 n 个月（自然月），日期超出则取该月最后一天 */
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** b - a 的整天数（同为 UTC 00:00 时精确） */
export function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
