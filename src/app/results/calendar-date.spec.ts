import { DatePipe } from '@angular/common';
import { calendarTimestamp } from './calendar-date';

describe('laboratory calendar dates', () => {
  it('anchors a date-only string to UTC midnight without local parsing', () => {
    expect(calendarTimestamp('2020-02-12')).toBe(Date.UTC(2020, 1, 12));
    expect(calendarTimestamp('2021-06-18')).toBe(Date.UTC(2021, 5, 18));
  });
  it('prints the same calendar day for viewers east or west of UTC', () => {
    for (const offset of ['-0800', '+0200', '+1400']) {
      const pipe = new DatePipe('en-US', offset);
      expect(pipe.transform(calendarTimestamp('2020-02-12'), 'd MMM y', 'UTC')).toBe('12 Feb 2020');
      expect(pipe.transform(calendarTimestamp('2021-06-18'), 'd MMM y', 'UTC')).toBe('18 Jun 2021');
    }
  });
});
