import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChartLine,
  Check,
  CircleAlert,
  CircleCheck,
  Cpu,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  FileType,
  Highlighter,
  Lock,
  Menu,
  MousePointerClick,
  RotateCcw,
  ScanText,
  ShieldCheck,
  SquareDashedMousePointer,
  Stethoscope,
  Trash2,
  TriangleAlert,
  Redo2,
  Undo2,
  Upload,
  X,
} from 'lucide-static';

const ICONS = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  camera: Camera,
  chart: ChartLine,
  check: Check,
  alert: CircleAlert,
  'check-circle': CircleCheck,
  cpu: Cpu,
  eye: Eye,
  'eye-off': EyeOff,
  'file-image': FileImage,
  'file-text': FileText,
  'file-type': FileType,
  highlighter: Highlighter,
  lock: Lock,
  menu: Menu,
  click: MousePointerClick,
  replay: RotateCcw,
  scan: ScanText,
  shield: ShieldCheck,
  'draw-box': SquareDashedMousePointer,
  stethoscope: Stethoscope,
  trash: Trash2,
  warning: TriangleAlert,
  undo: Undo2,
  redo: Redo2,
  upload: Upload,
  x: X,
} as const;

export type IconName = keyof typeof ICONS;

/** Lucide line icons (ISC licence), inlined so they inherit colour and size. */
@Component({
  selector: 'app-icon',
  template: '',
  host: {
    '[innerHTML]': 'svg()',
    'aria-hidden': 'true',
    class: 'inline-flex shrink-0 [&>svg]:size-full',
    '[style.width]': 'size()',
    '[style.height]': 'size()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);
  readonly name = input.required<IconName>();
  readonly size = input('1.25rem');
  protected readonly svg = computed<SafeHtml>(() =>
    // Static, trusted strings from the lucide-static package.
    this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name()]),
  );
}
