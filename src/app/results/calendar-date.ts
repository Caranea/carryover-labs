/** A laboratory collection date is a calendar day, never the viewer's local instant. */
export function calendarTimestamp(isoDate: string): number {
  return Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
}
