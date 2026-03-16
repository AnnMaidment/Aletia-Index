/**
 * lib/eudamed.ts
 * EUDAMED (EU device database) integration — stub pending full implementation.
 *
 * The live EUDAMED API requires an EU Commission account and certificate-based auth.
 * This stub keeps the build passing while that integration is in progress.
 * Replace with the real implementation once credentials are available.
 */

export interface EudamedDevice {
  basic_udi_ulid: string;
  device_name: string;
  manufacturer_name: string;
  risk_class: string;
  gmdn_term: string;
  registration_status: string;
  country: string;
}

/**
 * Look up a device in EUDAMED by its Basic UDI-DI ULID.
 * Returns null until the full implementation is in place.
 */
export async function getEudamedDevice(
  basicUdiUlid: string
): Promise<EudamedDevice | null> {
  console.info(`[eudamed.ts] getEudamedDevice called for ${basicUdiUlid} — implementation pending`);
  return null;
}
