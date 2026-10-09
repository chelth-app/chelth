import type { MalwareScanProviderName } from "@/config/env.server.schema";

import { createCloudmersiveScanner } from "./providers/cloudmersive";
import { createLocalTestScanner } from "./providers/local-test";
import type { MalwareScanner } from "./types";

export { runDocumentScans } from "./worker";
export type { MalwareScanner, ScanVerdict } from "./types";

/**
 * Resolves the configured scanner. Returns null when scanning is disabled or
 * misconfigured — callers then scan nothing and documents stay untrusted.
 * The deterministic local stub is never allowed in production.
 */
export function getMalwareScanner(options: {
  provider: MalwareScanProviderName;
  apiKey: string | undefined;
  production: boolean;
}): MalwareScanner | null {
  switch (options.provider) {
    case "cloudmersive":
      return options.apiKey ? createCloudmersiveScanner({ apiKey: options.apiKey }) : null;
    case "local_test":
      return options.production ? null : createLocalTestScanner();
    default:
      return null;
  }
}
