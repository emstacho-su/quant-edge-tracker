const ET_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const ET_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
})

export function toEtDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return ET_DATE_FORMATTER.format(d)
}

export function toEtLabel(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return ET_LABEL_FORMATTER.format(d)
}
