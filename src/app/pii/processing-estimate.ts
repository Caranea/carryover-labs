import type { DetectorTiming, DeviceCapabilities } from './device-performance';
import type { DetectorVariant } from './model-selection';

/** Reuse observed transfers from the model's origin; never fetch weights to test speed. */
export function observedDownlinkMbps(origin: string,
  entries: Pick<PerformanceResourceTiming, 'name' | 'transferSize' | 'responseStart' | 'responseEnd'>[]): number | null {
  const rates: number[] = [];
  for (const entry of entries) {
    try {
      const ms = entry.responseEnd - entry.responseStart;
      // Zero transfer size indicates cache/hidden timing; tiny files are mostly latency.
      if (new URL(entry.name).origin === origin && entry.transferSize >= 64_000 && ms > 0) {
        rates.push(Math.min(1000, entry.transferSize * 8 / ms / 1000));
      }
    } catch { /* Ignore non-network resources. */ }
  }
  rates.sort((a, b) => a - b);
  return rates.length ? rates[Math.floor(rates.length / 2)] : null;
}

export function approximateDuration(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds / 5) * 5)} sec`;
  return `~${Math.max(1, Math.round(seconds / 60))} min`;
}

/** Broad planning ranges until actual page timings replace them; not device benchmarks. */
export function pageEstimate(variant: DetectorVariant | null, device: DeviceCapabilities,
  timings: DetectorTiming[], ocrMilliseconds: number[]): string {
  const valid = timings.filter(t => t.words >= 100 && t.milliseconds > 0 && Number.isFinite(t.milliseconds));
  if (valid.length) {
    const detectorSeconds = Math.max(...valid.map(t => t.milliseconds / t.words)) * 500 / 1000;
    const readingSeconds = ocrMilliseconds.length ? Math.max(...ocrMilliseconds) / 1000 : 0;
    return `${approximateDuration(detectorSeconds + readingSeconds)}/page`;
  }
  if (variant === null) return 'Estimating time/page…';
  if (variant === 'gpu-fp16') return 'Roughly 5–30 sec/page';
  if ((device.cores !== null && device.cores <= 4) || (device.memoryGb !== null && device.memoryGb <= 4)) return 'Roughly 20–90 sec/page';
  return 'Roughly 10–60 sec/page';
}

export function downloadEstimate(bytes: number, downlinkMbps: number | null, cached: boolean): string {
  if (cached) return 'Checker saved · no download';
  const mb = Math.round(bytes / 1_000_000);
  if (!downlinkMbps || !Number.isFinite(downlinkMbps) || downlinkMbps <= 0) {
    return `First download: ${approximateDuration(bytes * 8 / 10_000_000)} at 10 Mbps (${mb} MB)`;
  }
  return `First download: ${approximateDuration(bytes * 8 / (downlinkMbps * 1_000_000))} (${mb} MB)`;
}
