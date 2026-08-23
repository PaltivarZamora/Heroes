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

export function formatCalendar(calendar: Calendar): string {
  return `M${calendar.month} W${calendar.week} D${calendar.day}`
}

export function sameCalendar(a: Calendar, b: Calendar): boolean {
  return a.day === b.day && a.week === b.week && a.month === b.month
}
