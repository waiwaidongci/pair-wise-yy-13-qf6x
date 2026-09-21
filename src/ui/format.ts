// 仅用于页面展示的格式化函数，业务判定不使用这里的任何输出。
export function formatTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatNumber(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}
