import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gpuExportAvailable,
  GPU_MIN_BUFFER_BYTES,
  selectDetectorVariant,
  type GpuAdapterProbe,
} from './model-selection';

function adapter(): GpuAdapterProbe {
  return {
    features: new Set(['shader-f16']),
    limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30 },
    requestDevice: vi.fn(async () => ({ destroy: vi.fn() })),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('model selection before downloads', () => {
  it('uses CPU without WebGPU and performs no network requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await selectDetectorVariant({})).toBe('cpu-q8');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('waits for a usable adapter and device before choosing FP16', async () => {
    let finish!: (value: GpuAdapterProbe) => void;
    const a = adapter();
    let settled = false;
    const selection = selectDetectorVariant({
      gpu: {
        requestAdapter: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    }).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(a);
    expect(await selection).toBe('gpu-fp16');
    expect(a.requestDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredFeatures: ['shader-f16'],
        requiredLimits: expect.objectContaining({
          maxStorageBufferBindingSize: GPU_MIN_BUFFER_BYTES,
        }),
      }),
    );
  });
  it.each(['absent', 'no-f16', 'buffer', 'software', 'device-error', 'low-memory'])(
    'chooses the CPU model for %s',
    async (reason) => {
      const a = adapter();
      if (reason === 'no-f16') a.features = new Set();
      if (reason === 'buffer') a.limits.maxStorageBufferBindingSize = 2 ** 28;
      if (reason === 'software') a.isFallbackAdapter = true;
      if (reason === 'device-error')
        a.requestDevice = async () => {
          throw new Error('Unavailable');
        };
      expect(
        await selectDetectorVariant({
          deviceMemory: reason === 'low-memory' ? 4 : 8,
          gpu: { requestAdapter: async () => (reason === 'absent' ? null : a) },
        }),
      ).toBe('cpu-q8');
    },
  );
  it('does not hang on a browser that never returns an adapter', async () => {
    vi.useFakeTimers();
    const result = selectDetectorVariant({ gpu: { requestAdapter: () => new Promise(() => {}) } });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe('cpu-q8');
  });
  it('rejects a missing export or an HTML fallback instead of attempting a large download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    expect(await gpuExportAvailable('/models/pii-fp16/')).toBe(false);
  });
});
