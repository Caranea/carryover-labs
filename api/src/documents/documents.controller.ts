import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ClerkAuthGuard, type AuthedRequest } from '../auth/clerk-auth.guard.js';
import type { DocumentManifest, SavedDocument, SavedDocumentSummary } from './contract.js';
import { resultsFor } from '../results/results.controller.js';
import { DocumentStorage, NotFoundError, StorageQuotaError } from './storage.js';
import { STORAGE } from './storage.token.js';
import { assertOnlyMoreHidden, findVisiblePesel, isJpeg, LIMITS, ManifestError, parseManifest } from './validate.js';
import { sanitizePageImage } from './images.js';
import { boundedUploadMemory } from '../security/upload-memory.js';


const upload = FilesInterceptor('pages', LIMITS.pages, {
  storage: boundedUploadMemory(),
  limits: { fileSize: LIMITS.imageBytes, files: LIMITS.pages, fieldSize: LIMITS.manifestBytes, fields: 1 },
});

@Controller('documents')
@UseGuards(ClerkAuthGuard)
export class DocumentsController {
  constructor(@Inject(STORAGE) private readonly storage: DocumentStorage) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<SavedDocumentSummary[]> {
    return this.storage.list(req.userId);
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string): Promise<SavedDocument> {
    return this.found(this.storage.read(req.userId, id));
  }

  @Get(':id/pages/:index')
  async page(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res() res: Response,
  ) {
    const buf = await this.found(this.storage.readPage(req.userId, id, index));
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' }).send(buf);
  }

  @Post()
  @UseInterceptors(upload)
  async create(
    @Req() req: AuthedRequest,
    @Body('manifest') raw: unknown,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<SavedDocumentSummary> {
    const { manifest, images } = await this.checkUpload(raw, files);
    const saved = await this.found(this.storage.create(req.userId, manifest, images));
    await resultsFor(this.storage, req.userId, saved.id);
    return saved;
  }

  @Put(':id')
  @UseInterceptors(upload)
  async replace(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body('manifest') raw: unknown,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<SavedDocumentSummary> {
    const { manifest, images } = await this.checkUpload(raw, files);
    const existing = await this.found(this.storage.read(req.userId, id));
    try {
      assertOnlyMoreHidden(existing.pages, manifest.pages);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const saved = await this.found(this.storage.replace(req.userId, id, manifest, images));
    // Words may have been hidden: extract again from the new copy.
    await resultsFor(this.storage, req.userId, id);
    return saved;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.found(this.storage.delete(req.userId, id));
  }

  private async checkUpload(raw: unknown, files: Express.Multer.File[]): Promise<{ manifest: DocumentManifest; images: Map<number, Buffer> }> {
    let manifest: DocumentManifest;
    try {
      manifest = parseManifest(raw);
    } catch (e) {
      if (e instanceof ManifestError) throw new BadRequestException(e.message);
      throw e;
    }

    const images = new Map<number, Buffer>();
    if (files.reduce((total, file) => total + file.buffer.length, 0) > LIMITS.uploadBytes) throw new PayloadTooLargeException('Add fewer pages at a time.');
    for (const f of files) {
      const m = /^page-(\d+)\.jpg$/.exec(f.originalname);
      if (!m) throw new BadRequestException('Unexpected file in upload.');
      const index = Number(m[1]);
      if (images.has(index)) throw new BadRequestException('A page was sent twice.');
      if (!isJpeg(f.buffer)) throw new BadRequestException('Pages must be JPEG images.');
      images.set(index, f.buffer);
    }
    for (const page of manifest.pages) {
      if (page.hasImage !== images.has(page.index)) throw new BadRequestException('Page images do not match the pages.');
    }
    if (images.size !== manifest.pages.filter((p) => p.hasImage).length) {
      throw new BadRequestException('Page images do not match the pages.');
    }

    const peselPage = findVisiblePesel(manifest.pages);
    if (peselPage !== null) {
      throw new UnprocessableEntityException(
        `A PESEL number still seems to be visible on page ${peselPage}. Hide it and save again.`,
      );
    }
    for (const page of manifest.pages) if (page.hasImage) {
      try { images.set(page.index, await sanitizePageImage(images.get(page.index)!, page)); }
      catch (error) { if (error instanceof ManifestError) throw new BadRequestException(error.message); throw error; }
    }
    return { manifest, images };
  }

  private async found<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof NotFoundError) throw new NotFoundException('Document not found.');
      if (e instanceof StorageQuotaError) throw new PayloadTooLargeException(e.message);
      if (e instanceof ManifestError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
