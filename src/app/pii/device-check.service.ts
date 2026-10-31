import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { assessDevice, readDeviceCapabilities } from './device-performance';
import { NerService } from './ner.service';
import { OcrService } from '../extraction/ocr.service';
import { ASSETS, assetUrl } from '../core/assets';
import {
  gpuExportAvailable,
  selectDetectorVariant,
  type DetectorVariant,
  type ModelDevice,
} from './model-selection';
import {
  approximateDuration,
  downloadEstimate,
  observedDownlinkMbps,
  pageEstimate,
} from './processing-estimate';
import { NER_MODEL_ID } from './ner-protocol';

@Injectable({ providedIn: 'root' })
export class DeviceCheckService {
  readonly ner = inject(NerService);
  readonly capabilities = readDeviceCapabilities();
  private readonly ocr = inject(OcrService);
  private readonly previewVariant = signal<DetectorVariant | null>(null);
  private readonly cachedVariant = signal<DetectorVariant | null>(null);
  readonly variant = computed(() => this.ner.variant() ?? this.previewVariant());
  readonly pageEstimate = computed(() =>
    pageEstimate(this.variant(), this.capabilities, this.ner.timings(), this.ocr.timings()),
  );
  readonly photoEstimate = computed(() =>
    this.ocr.timings().length
      ? `${approximateDuration(Math.max(...this.ocr.timings()) / 1000)}/page to read photos`
      : 'Photos: roughly 3–20 sec/page',
  );
  readonly downloadEstimate = computed(() => {
    const variant = this.variant();
    if (!variant) return 'Checking download size…';
    if (this.ner.modelCached()) return 'Checker saved · no download';
    if (this.ner.phase() === 'downloading' && this.ner.remainingSeconds() !== null)
      return `${approximateDuration(this.ner.remainingSeconds()!)} download remaining`;
    const modelOrigin =
      variant === 'gpu-fp16'
        ? new URL(assetUrl(ASSETS.piiGpuModel)).origin
        : 'https://huggingface.co';
    const observed =
      typeof performance.getEntriesByType === 'function'
        ? observedDownlinkMbps(
            modelOrigin,
            performance.getEntriesByType('resource') as PerformanceResourceTiming[],
          )
        : null;
    const downlink =
      observed ??
      (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink ??
      null;
    return downloadEstimate(
      variant === 'gpu-fp16' ? 556_000_000 : 279_000_000,
      downlink,
      this.ner.state() === 'ready' || this.cachedVariant() === variant,
    );
  });
  readonly assessment = computed(() =>
    assessDevice(this.capabilities, this.ner.timings(), this.ner.state() === 'unavailable'),
  );
  readonly duration = computed(() => {
    const seconds = this.assessment().seconds;
    return seconds === null
      ? null
      : seconds < 60
        ? 'Less than 1 minute'
        : 'About ' + Math.ceil(seconds / 60) + ' minutes';
  });

  constructor() {
    // Capability/cache inspection only; no weights download before adding a file.
    void this.inspect();
    effect(() => {
      const variant = this.variant();
      if (variant) void this.checkCache(variant);
    });
  }

  private async inspect() {
    const variant = await selectDetectorVariant(navigator as unknown as ModelDevice);
    this.previewVariant.set(
      variant === 'gpu-fp16' && (await gpuExportAvailable(assetUrl(ASSETS.piiGpuModel)))
        ? 'gpu-fp16'
        : 'cpu-q8',
    );
  }

  private async checkCache(variant: DetectorVariant) {
    try {
      const url =
        variant === 'gpu-fp16'
          ? assetUrl(`${ASSETS.piiGpuModel}onnx/model_fp16.onnx`)
          : `https://huggingface.co/${NER_MODEL_ID}/resolve/main/onnx/model_quantized.onnx`;
      if (typeof caches !== 'undefined' && (await caches.match(url)))
        this.cachedVariant.set(variant);
    } catch {
      /* Private browsing may disable caching; normal loading still works. */
    }
  }
}
