export type Calendar = {
  day: number
  week: number
  month: number
}

export function startCalendar(): Calendar {
  return { day: 1, week: 1, month: 1 }
}

export function advanceDay(calendar: Calendar): Calendar {
  let { day, week, month } = calendar
  day += 1
  if (day > 7) {
    day = 1
    week += 1
  }
  if (week > 4) {
    week = 1
    month += 1
  }
  if (month > 13) {
    month = 1
  }
  return { day, week, month }
}

export function isWeekRollover(previous: Calendar, next: Calendar): boolean {
  return previous.day === 7 && next.day === 1
}

export function isMonthRollover(previous: Calendar, next: Calendar): boolean {
  return previous.month !== next.month
}

/** Highest calendar unit that ticked; null if the date did not change. */
export function calendarRolloverTitle(
  previous: Calendar,
  next: Calendar,
): 'New Day' | 'New Week' | 'New Month' | null {
  if (sameCalendar(previous, next)) {
    return null
  }
  if (isMonthRollover(previous, next)) {
    return 'New Month'
  }
  if (isWeekRollover(previous, next)) {
    return 'New Week'
  }
  return 'New Day'
}

export function formatCalendar(calendar: Calendar): string {
  return `M${calendar.month} W${calendar.week} D${calendar.day}`
}

export function sameCalendar(a: Calendar, b: Calendar): boolean {
  return a.day === b.day && a.week === b.week && a.month === b.month
}

/** Monotonic day index for last_build_day comparisons (13×4×7 calendar). */
export function calendarDayNumber(calendar: Calendar): number {
  return (calendar.month - 1) * 28 + (calendar.week - 1) * 7 + calendar.day
}
