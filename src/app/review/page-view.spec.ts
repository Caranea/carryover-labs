import { TestBed } from '@angular/core/testing';
import type { WorkingPage } from '../core/models';
import { PageView, percentageBox } from './page-view';
import { TextView } from './text-view';

describe('keyboard redaction areas', () => {
  const page = { width: 1200, height: 1600 };
  it('places a percentage rectangle correctly on a scanned page', () => {
    expect(percentageBox({ left: 10, top: 20, width: 30, height: 10 }, page)).toEqual({ x: 120, y: 320, w: 360, h: 160 });
  });
  it('rejects rectangles that are empty, nonnumeric or outside the page', () => {
    for (const area of [{ left: -1, top: 0, width: 10, height: 10 }, { left: 90, top: 0, width: 11, height: 10 }, { left: 0, top: 0, width: 0, height: 10 }, { left: NaN, top: 0, width: 10, height: 10 }]) {
      expect(percentageBox(area, page)).toBeNull();
    }
  });
});

describe('final mask preview', () => {
  const page = (): WorkingPage => ({ index: 0, width: 100, height: 80, image: null, imageUrl: null, ocr: true, regions: [], words: [10, 22, 34, 50].map((x, id) => ({ id, text: `word${id}`, line: 0, hidden: id === 0, box: { x, y: 10, w: 10, h: 10 } })) });
  it('shows the expanded image masks and undo returns to the initiating word', () => {
    const fixture = TestBed.createComponent(PageView);
    fixture.componentRef.setInput('page', page());
    fixture.detectChanges();
    const masks = fixture.nativeElement.querySelectorAll('rect.redacted') as NodeListOf<SVGRectElement>;
    expect(masks.length).toBe(3);
    expect(masks[0].getAttribute('width')).toBe('15');
    const toggled: number[] = [];
    fixture.componentInstance.toggleWord.subscribe((id) => toggled.push(id));
    masks[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggled).toEqual([0]);
  });
  it('shows the same covered neighbours in the keyboard-friendly text view', () => {
    const fixture = TestBed.createComponent(TextView);
    fixture.componentRef.setInput('page', page());
    fixture.detectChanges();
    const masks = fixture.nativeElement.querySelectorAll('button.redacted') as NodeListOf<HTMLButtonElement>;
    expect(masks.length).toBe(3);
    expect(masks[2].getAttribute('aria-label')).toContain('original removal');
    const toggled: number[] = [];
    fixture.componentInstance.toggleWord.subscribe((id) => toggled.push(id));
    masks[2].click();
    expect(toggled).toEqual([0]);
  });
});
