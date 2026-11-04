import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  EXTRACTION_IO,
  ExtractionService,
  MAX_PAGES,
  UnsupportedFileError,
} from './extraction.service';
import { PdfPageLimitError, type RenderedPdfPage } from './pdf-extractor';

const canvas = () => Object.assign(document.createElement('canvas'), { width: 120, height: 240 });
const pdfPage = (index: number): RenderedPdfPage & { pageCount: number } => ({
  index,
  pageCount: 2,
  canvas: canvas(),
  image: new Blob(['synthetic']),
});

describe('failed import resource cleanup', () => {
  const readPdf = vi.fn<typeof import('./pdf-extractor').readPdf>();
  const loadImage = vi.fn<typeof import('./image-extractor').loadImage>();
  const canvasToBlob = vi.fn<typeof import('./render').canvasToBlob>();
  const createUrl = vi.fn(() => 'blob:synthetic-page');
  const revokeUrl = vi.fn();
  let service: ExtractionService;
  beforeEach(() => {
    vi.resetAllMocks();
    createUrl.mockReturnValue('blob:synthetic-page');
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: createUrl,
        revokeObjectURL: revokeUrl,
      }),
    );
    TestBed.configureTestingModule({
      providers: [{ provide: EXTRACTION_IO, useValue: { readPdf, loadImage, canvasToBlob } }],
    });
    service = TestBed.inject(ExtractionService);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('revokes earlier PDF previews and closes the iterator when a later page fails', async () => {
    const first = pdfPage(0),
      second = pdfPage(1),
      closed = vi.fn();
    vi.mocked(readPdf).mockImplementation(async function* () {
      try {
        yield first;
        yield second;
      } finally {
        closed();
      }
    });
    createUrl.mockReturnValueOnce('blob:synthetic-page').mockImplementationOnce(() => {
      throw new Error('preview failed');
    });
    await expect(service.extract(new File(['pdf'], 'test.pdf'), () => undefined)).rejects.toThrow(
      'preview failed',
    );
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:synthetic-page');
    expect([
      first.canvas.width,
      first.canvas.height,
      second.canvas.width,
      second.canvas.height,
    ]).toEqual([0, 0, 0, 0]);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('passes the page limit before rendering and preserves the descriptive unsupported-file error', async () => {
    const file = new File(['pdf'], 'large.pdf');
    // eslint-disable-next-line require-yield -- the mock fails before producing a page
    vi.mocked(readPdf).mockImplementation(async function* () {
      throw new PdfPageLimitError(MAX_PAGES);
    });
    await expect(service.extract(file, () => undefined)).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
    expect(readPdf).toHaveBeenCalledWith(file, MAX_PAGES);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('keeps successful PDF preview ownership with the returned page while releasing canvas memory', async () => {
    const page = pdfPage(0);
    vi.mocked(readPdf).mockImplementation(async function* () {
      yield page;
    });
    const [result] = await service.extract(new File(['pdf'], 'test.pdf'), () => undefined);
    expect([result.width, result.height, result.imageUrl, result.image]).toEqual([
      120,
      240,
      'blob:synthetic-page',
      page.image,
    ]);
    expect(result.words).toEqual([]);
    expect([page.canvas.width, page.canvas.height]).toEqual([0, 0]);
    expect(revokeUrl).not.toHaveBeenCalled();
  });

  it('releases the image canvas when it cannot be encoded', async () => {
    const loaded = canvas();
    vi.mocked(loadImage).mockResolvedValue(loaded);
    vi.mocked(canvasToBlob).mockRejectedValue(new Error('encoding failed'));
    await expect(service.extract(new File(['photo'], 'test.jpg'), () => undefined)).rejects.toThrow(
      'encoding failed',
    );
    expect([loaded.width, loaded.height]).toEqual([0, 0]);
    expect(createUrl).not.toHaveBeenCalled();
  });
});
