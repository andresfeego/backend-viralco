export function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function addMinutes(date: Date, minutes: number) {
  const next = new Date(date.getTime());
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}
