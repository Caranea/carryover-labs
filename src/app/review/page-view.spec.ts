import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Box, WorkingPage } from '../core/models';
import { PageView, percentageBox } from './page-view';

describe('keyboard redaction areas', () => {
  const page = { width: 1200, height: 1600 };
  it('places a percentage rectangle correctly on a scanned page', () => {
    expect(percentageBox({ left: 10, top: 20, width: 30, height: 10 }, page)).toEqual({
      x: 120,
      y: 320,
      w: 360,
      h: 160,
    });
  });
  it('rejects rectangles that are empty, nonnumeric or outside the page', () => {
    for (const area of [
      { left: -1, top: 0, width: 10, height: 10 },
      { left: 90, top: 0, width: 11, height: 10 },
      { left: 0, top: 0, width: 0, height: 10 },
      { left: NaN, top: 0, width: 10, height: 10 },
    ]) {
      expect(percentageBox(area, page)).toBeNull();
    }
  });
});

describe('final mask preview', () => {
  const page = (): WorkingPage => ({
    index: 0,
    width: 100,
    height: 80,
    image: null,
    imageUrl: null,
    ocr: true,
    regions: [],
    words: [10, 22, 34, 50].map((x, id) => ({
      id,
      text: `word${id}`,
      line: 0,
      hidden: id === 0,
      box: { x, y: 10, w: 10, h: 10 },
    })),
  });
  const draw = (fixture: ComponentFixture<PageView>) => {
    const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 80 }) as DOMRect;
    svg.setPointerCapture = () => undefined;
    return (type: string, x: number, y: number) =>
      svg.dispatchEvent(
        Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), {
          pointerId: 1,
        }),
      );
  };
  it('draws hidden words as bounded masks', () => {
    const fixture = TestBed.createComponent(PageView);
    fixture.componentRef.setInput('page', page());
    fixture.detectChanges();
    const masks = fixture.nativeElement.querySelectorAll(
      'rect.redacted',
    ) as NodeListOf<SVGRectElement>;
    expect(masks.length).toBe(1);
    expect(masks[0].getAttribute('width')).toBe('14');
  });
  it('turns a drag into a box', () => {
    const fixture = TestBed.createComponent(PageView);
    fixture.componentRef.setInput('page', page());
    fixture.detectChanges();
    const added: Box[] = [];
    fixture.componentInstance.addRegion.subscribe((box) => added.push(box));
    const pointer = draw(fixture);
    pointer('pointerdown', 10, 40);
    pointer('pointermove', 30, 50);
    pointer('pointerup', 30, 50);
    expect(added).toEqual([{ x: 10, y: 40, w: 20, h: 10 }]);
  });
  it('removes the box under a tap, but never one already saved', () => {
    const fixture = TestBed.createComponent(PageView);
    const regions = [
      { x: 10, y: 40, w: 20, h: 10 },
      { x: 50, y: 40, w: 20, h: 10 },
    ];
    fixture.componentRef.setInput('page', { ...page(), regions, lockedRegions: 1 });
    fixture.detectChanges();
    const removed: number[] = [];
    fixture.componentInstance.removeRegion.subscribe((index) => removed.push(index));
    const pointer = draw(fixture);
    pointer('pointerdown', 15, 45);
    pointer('pointerup', 15, 45);
    expect(removed).toEqual([]);
    pointer('pointerdown', 55, 45);
    pointer('pointerup', 55, 45);
    expect(removed).toEqual([1]);
  });
});
