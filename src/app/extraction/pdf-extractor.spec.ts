import { vi, type MockInstance } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { PdfPageLimitError, readPdf } from './pdf-extractor';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
  Util: { transform: vi.fn() },
}));

describe('PDF reader resource ownership', () => {
  const file = { arrayBuffer: async () => new ArrayBuffer(0) } as File;
  const destroy = vi.fn(async () => undefined);
  let created: MockInstance<Document['createElement']>;
  let page: ReturnType<typeof setupPage>;
  let getPage: ReturnType<typeof vi.fn>;
  function setupPage() {
    return {
      cleanup: vi.fn(),
      getViewport: vi.fn(() => ({ width: 120, height: 240, transform: [1, 0, 0, 1, 0, 0] })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      getTextContent: vi.fn(async () => ({ items: [] })),
    };
  }
  function documentWith(pages: number) {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: pages, getPage }),
      destroy,
    } as unknown as ReturnType<typeof getDocument>);
  }
  beforeEach(() => {
    vi.resetAllMocks();
    created = vi.spyOn(document, 'createElement');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['synthetic'])),
    );
    page = setupPage();
    getPage = vi.fn(async () => page);
    documentWith(1);
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects excessive page counts before loading or rendering any page and destroys the worker', async () => {
    documentWith(41);
    await expect(readPdf(file, 40).next()).rejects.toBeInstanceOf(PdfPageLimitError);
    expect(getPage).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('destroys a PDF loading task even when opening the document fails', async () => {
    vi.mocked(getDocument).mockImplementation(
      () =>
        ({
          promise: Promise.reject(new Error('opening failed')),
          destroy,
        }) as unknown as ReturnType<typeof getDocument>,
    );
    await expect(readPdf(file, 40).next()).rejects.toThrow('opening failed');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each(['render', 'encode'] as const)(
    'releases the canvas, page and worker after a %s failure',
    async (failure) => {
      if (failure === 'render')
        page.render.mockImplementation(() => ({ promise: Promise.reject(new Error('failed')) }));
      if (failure === 'encode')
        vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) =>
          callback(null),
        );
      await expect(readPdf(file, 40).next()).rejects.toThrow(
        failure === 'encode' ? 'Could not encode' : 'failed',
      );
      const bitmap = created.mock.results.find(
        (result) => result.value instanceof HTMLCanvasElement,
      )?.value as HTMLCanvasElement;
      expect([bitmap.width, bitmap.height]).toEqual([0, 0]);
      expect(page.cleanup).toHaveBeenCalledOnce();
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it('releases a yielded canvas and PDF resources when its consumer stops early', async () => {
    documentWith(2);
    const reader = readPdf(file, 40);
    const first = await reader.next();
    expect(first.done).toBe(false);
    expect(page.getTextContent).not.toHaveBeenCalled();
    const bitmap = first.value!.canvas;
    expect([bitmap.width, bitmap.height]).toEqual([120, 240]);
    await reader.return(undefined);
    expect([bitmap.width, bitmap.height]).toEqual([0, 0]);
    expect(getPage).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
