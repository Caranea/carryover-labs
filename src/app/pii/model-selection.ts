export type DetectorVariant = 'gpu-fp16' | 'cpu-q8';

// XLM-R's vocabulary embedding is the largest tensor in the FP16 export.
export const GPU_MIN_BUFFER_BYTES = 384_003_072;
export interface GpuAdapterProbe {
  features: { has(name: string): boolean };
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number };
  isFallbackAdapter?: boolean;
  requestDevice(options: unknown): Promise<{ destroy(): void }>;
}
export interface ModelDevice {
  deviceMemory?: number;
  gpu?: { requestAdapter(options?: unknown): Promise<GpuAdapterProbe | null> };
}

/** Inspect actual browser/GPU capabilities before requesting ANY model weights. */
export async function selectDetectorVariant(device: ModelDevice): Promise<DetectorVariant> {
  if (!device.gpu) return 'cpu-q8';
  let timer: ReturnType<typeof setTimeout>;
  const probe = async (): Promise<DetectorVariant> => {
    try {
      const adapter = await device.gpu!.requestAdapter({ powerPreference: 'high-performance' });
      if (
        !adapter ||
        adapter.isFallbackAdapter ||
        !adapter.features.has('shader-f16') ||
        adapter.limits.maxBufferSize < GPU_MIN_BUFFER_BYTES ||
        adapter.limits.maxStorageBufferBindingSize < GPU_MIN_BUFFER_BYTES ||
        (device.deviceMemory !== undefined && device.deviceMemory <= 4)
      )
        return 'cpu-q8';
      // Adapter exposure alone is insufficient: device creation can be blocked.
      const gpu = await adapter.requestDevice({
        requiredFeatures: ['shader-f16'],
        requiredLimits: {
          maxBufferSize: GPU_MIN_BUFFER_BYTES,
          maxStorageBufferBindingSize: GPU_MIN_BUFFER_BYTES,
        },
      });
      gpu.destroy();
      return 'gpu-fp16';
    } catch {
      return 'cpu-q8';
    }
  };
  try {
    return await Promise.race([
      probe(),
      new Promise<DetectorVariant>((resolve) => {
        timer = setTimeout(() => resolve('cpu-q8'), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** If the optional GPU asset was omitted from a deployment, use CPU directly. */
export async function gpuExportAvailable(modelBase: string): Promise<boolean> {
  try {
    const response = await fetch(`${modelBase}manifest.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return false;
    const manifest = await response.json();
    return (
      manifest.dtype === 'fp16' &&
      manifest.source === 'bardsai/eu-pii-anonimization-multilang' &&
      manifest.bytes > 0 &&
      manifest.largestTensorBytes <= GPU_MIN_BUFFER_BYTES
    );
  } catch {
    return false;
  }
}
