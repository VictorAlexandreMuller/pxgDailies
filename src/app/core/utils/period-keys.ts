function pad2(n: number) { return String(n).padStart(2, '0'); }

export function dailyKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

export function monthlyKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}

export function weeklyKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(weekNo)}`;
}

export function currentKey(period: 'daily'|'weekly'|'monthly'): string {
  if (period === 'daily') return dailyKey();
  if (period === 'weekly') return weeklyKey();
  return monthlyKey();
}
