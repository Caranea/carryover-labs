import { DOCUMENTS, ROWS, STEPS, TRACED } from './record-film-data';

/** When each stage starts, in seconds; the film ends on the traced value. */
const CHECK = 1.9;
const READ = 4.5;
const TRACE = 9.3;
export const FILM_END = 9.9;

const STAGES = [0, CHECK, READ, TRACE];
const CHECK_TIME = (READ - CHECK) / DOCUMENTS.length;
const READ_TIME = (TRACE - READ) / DOCUMENTS.length;

export interface OutlineFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RedactionFrame extends OutlineFrame {
  /** How far the bar has been drawn, 0 to 1. */
  drawn: number;
}

export interface PageFrame {
  thumbOpacity: number;
  pageOpacity: number;
  /** The page on show, once there is one. */
  active: boolean;
  redactions: readonly RedactionFrame[];
  /** The row being read, as percentages of the page. */
  outline: OutlineFrame | null;
}

export interface CellFrame {
  opacity: number;
  /** The value the film ends on. */
  traced: boolean;
}

export interface FilmFrame {
  activeStep: number;
  /** How far along each step is, 0 to 100. */
  stepFill: readonly number[];
  /** The document in the viewer. */
  document: number;
  captionOpacity: number;
  pages: readonly PageFrame[];
  /** Per document: the column heading's opacity and whether it is the current column. */
  columns: readonly { opacity: number; active: boolean }[];
  /** Per test, the line under its name. */
  subtitles: readonly string[];
  /** Per test, then per document. */
  cells: readonly (readonly CellFrame[])[];
  traceOpacity: number;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const progress = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const round = (v: number) => Math.round(v * 100) / 100;
const percent = (v: number) => round(v * 100);

/** Which document is open, and which of its rows is being read, if any. */
function position(t: number): { document: number; row: number } {
  if (t >= TRACE) return TRACED;
  if (t >= READ) {
    const document = Math.min(DOCUMENTS.length - 1, Math.floor((t - READ) / READ_TIME));
    const within = (t - READ - document * READ_TIME) / READ_TIME;
    return { document, row: Math.min(ROWS.length - 1, Math.floor(within * ROWS.length)) };
  }
  if (t >= CHECK) {
    return {
      document: Math.min(DOCUMENTS.length - 1, Math.floor((t - CHECK) / CHECK_TIME)),
      row: -1,
    };
  }
  return { document: 0, row: -1 };
}

function pageFrame(index: number, t: number, document: number, row: number): PageFrame {
  const doc = DOCUMENTS[index];
  const active = index === document;
  const opens = CHECK + index * CHECK_TIME;
  const box = active && row >= 0 ? doc.rows[row] : null;
  const pad = 2 / doc.width;
  return {
    active: active && t >= CHECK,
    thumbOpacity: round(progress(t, 0.15 + index * 0.25, 0.4 + index * 0.25)),
    pageOpacity: active ? round(progress(t, 1.5, 1.8)) : 0,
    redactions: doc.redactions.map(([left, top, width, height], n) => {
      const at = opens + 0.04 + n * 0.03;
      return {
        left: percent(left),
        top: percent(top),
        width: percent(width),
        height: percent(height),
        drawn: round(easeOut(progress(t, at, at + 0.2))),
      };
    }),
    outline: box && {
      left: percent(box[0] / doc.width - pad),
      top: percent(box[1] / doc.height - pad),
      width: percent((box[2] * doc.rowReach) / doc.width + pad * 2),
      height: percent(box[3] / doc.height + pad * 2),
    },
  };
}

/** Everything the film shows at `t` seconds. A pure function, so any moment can be inspected. */
export function filmFrame(t: number): FilmFrame {
  const { document, row } = position(t);
  const traced = t >= TRACE;
  let activeStep = 0;
  for (let step = 1; step < STEPS.length; step++) {
    if (t >= STAGES[step]) activeStep = step;
  }
  return {
    activeStep,
    stepFill: STEPS.map((_, step) => Math.round(progress(t, STAGES[step], STAGES[step + 1]) * 100)),
    document,
    captionOpacity: round(progress(t, 1.5, 1.8)),
    pages: DOCUMENTS.map((_, i) => pageFrame(i, t, document, row)),
    columns: DOCUMENTS.map((_, i) => ({
      opacity: round(progress(t, READ + i * READ_TIME - 0.1, READ + i * READ_TIME + 0.1)),
      active: t >= READ && i === document,
    })),
    subtitles: ROWS.map((test, r) =>
      t >= READ && !traced && r === row ? `Printed as ${test.printedAs[document]}` : test.unit,
    ),
    cells: ROWS.map((_, r) =>
      DOCUMENTS.map((_, i) => {
        const at = READ + i * READ_TIME + (r / ROWS.length) * READ_TIME;
        return {
          opacity: round(progress(t, at, at + 0.12)),
          traced: traced && r === TRACED.row && i === TRACED.document,
        };
      }),
    ),
    traceOpacity: round(progress(t, TRACE + 0.05, TRACE + 0.4)),
  };
}
