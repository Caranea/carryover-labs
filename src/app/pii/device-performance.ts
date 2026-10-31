/** Estimates are detector time only, not photo reading or first-use setup. */
export const ESTIMATE_DOCUMENTS = 30;
export const ESTIMATE_WORDS_PER_DOCUMENT = 500;
export const RECOMMENDED_LIMIT_SECONDS = 15 * 60;

export interface DetectorTiming {
  words: number;
  milliseconds: number;
}
export interface DeviceCapabilities {
  supported: boolean;
  memoryGb: number | null;
  cores: number | null;
}
export interface DeviceAssessment {
  recommendation: 'automatic' | 'manual' | null;
  seconds: number | null;
  title: string;
  detail: string;
}

export function readDeviceCapabilities(): DeviceCapabilities {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  const positive = (value?: number) =>
    value && Number.isFinite(value) && value > 0 ? value : null;
  return {
    supported: typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined',
    memoryGb: positive(nav?.deviceMemory),
    cores: positive(nav?.hardwareConcurrency),
  };
}

export function assessDevice(
  device: DeviceCapabilities,
  timings: DetectorTiming[],
  failed = false,
): DeviceAssessment {
  if (!device.supported)
    return {
      recommendation: 'manual',
      seconds: null,
      title: 'Use manual review in this browser',
      detail: 'This browser does not support the full privacy detector.',
    };
  if (failed)
    return {
      recommendation: 'manual',
      seconds: null,
      title: 'Full check is not recommended right now',
      detail:
        'The detector could not finish on this device. Use manual review, or retry after checking your connection and closing other tabs.',
    };
  // Tiny pages give unreliable extrapolations. Use the slowest of the recent
  // substantial pages, so one quick page cannot erase a slower measurement.
  const rates = timings
    .filter(
      (t) =>
        t.words >= 100 &&
        Number.isFinite(t.words) &&
        Number.isFinite(t.milliseconds) &&
        t.milliseconds > 0,
    )
    .map((t) => t.milliseconds / t.words);
  const seconds = rates.length
    ? (Math.max(...rates) * ESTIMATE_DOCUMENTS * ESTIMATE_WORDS_PER_DOCUMENT) / 1000
    : null;
  if (seconds !== null) {
    const slow = seconds > RECOMMENDED_LIMIT_SECONDS;
    return {
      recommendation: slow ? 'manual' : 'automatic',
      seconds,
      title: slow
        ? 'Full check is not recommended on this device'
        : 'Full check is recommended on this device',
      detail: slow
        ? 'Checking 30 similar pages is estimated to take over 15 minutes. We recommend manual review on this device.'
        : 'Based on the pages checked on this device, 30 similar pages should take less than 15 minutes, or about 15 minutes at the limit.',
    };
  }
  if (
    (device.memoryGb !== null && device.memoryGb <= 2) ||
    (device.cores !== null && device.cores <= 2)
  ) {
    return {
      recommendation: 'manual',
      seconds: null,
      title: 'Manual review is recommended for now',
      detail:
        'Your browser reports limited memory or processing capacity, so the automatic check may struggle. You can still choose it.',
    };
  }
  return {
    recommendation: 'automatic',
    seconds: null,
    title: 'Automatic privacy check is available',
    detail: 'We’ll estimate the time automatically as your first document is checked.',
  };
}
