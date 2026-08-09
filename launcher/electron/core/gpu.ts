import { app } from 'electron';

import { log } from './logger';
import { readSettings, writeSettings } from './store';

export type GpuVendor = 'nvidia' | 'amd' | 'other';

let cached: { model: string; vendor: GpuVendor } | null = null;

const NVIDIA = /nvidia|geforce|rtx|gtx|quadro/i;
const AMD = /amd|radeon|ati/i;

interface Device {
  model: string;
}

async function detect(): Promise<{ model: string; vendor: GpuVendor }> {
  const devices: Device[] = [];

  try {
    // Electron typings say `unknown`; the basic payload carries the device list.
    const gpu = (await app.getGPUInfo('basic')) as { gpuDevice: Device[] };
    devices.push(...((gpu.gpuDevice ?? []) as Device[]));
  } catch (error) {
    log.warn('Could not read GPU information.', error);
  }

  // Hybrid laptops expose several adapters and Chromium does not promise any order,
  // so the first device is not always the NVIDIA one. Look at every adapter instead.
  for (const device of devices) {
    if (NVIDIA.test(device.model)) {
      return { model: device.model.trim(), vendor: 'nvidia' };
    }
  }

  for (const device of devices) {
    if (AMD.test(device.model)) {
      return { model: device.model.trim(), vendor: 'amd' };
    }
  }

  const fallback = (devices[0]?.model ?? '').trim();
  return { model: fallback, vendor: fallback ? 'other' : 'other' };
}

/** The GPU model string Chromium reports, once per session. */
export async function gpuModel(): Promise<string> {
  cached ??= await detect();
  return cached.model;
}

/** NVIDIA, AMD, or neither - decided from the model string, once per session. */
export async function gpuVendor(): Promise<GpuVendor> {
  cached ??= await detect();
  return cached.vendor;
}

/**
 * Resolves the NVIDIA-optimization switch to a real on/off value.
 *
 * Before the player has ever touched it the answer comes from the machine: NVIDIA cards
 * get Nvidium on by default, everyone else starts with it off. The choice is persisted,
 * so the GPU is only asked about once.
 */
export async function resolveNvidiaOptimize(): Promise<boolean> {
  const current = readSettings().nvidiaOptimize;

  if (current !== null) return current;

  const { model, vendor } = await detect();

  // An empty model means no adapter was reported at all. Persisting "other" would pin
  // the wrong answer for good, so leave the switch alone and re-detect next launch.
  if (!model) return false;

  const on = vendor === 'nvidia';
  writeSettings({ nvidiaOptimize: on });
  return on;
}