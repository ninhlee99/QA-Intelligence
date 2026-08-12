import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve base directory for all file-backed stores. Order:
 * 1) QA_INTELLIGENCE_DEV_PERSIST_DIR (explicit absolute path)
 * 2) QA_INTELLIGENCE_DEV_DOMAIN      (~/.workspaces/<domain>/test-engineer)
 * 3) fallback                         (~/.workspaces/qa-intelligence-default/test-engineer)
 */
export function resolvePersistBaseDir(writeWarning: (message: string) => void = () => undefined): string {
  const explicit = process.env["QA_INTELLIGENCE_DEV_PERSIST_DIR"];
  if (explicit) return explicit;

  const domain = process.env["QA_INTELLIGENCE_DEV_DOMAIN"];
  if (domain) return join(homedir(), ".workspaces", domain, "test-engineer");

  writeWarning(
    "[qa-intelligence] WARNING: QA_INTELLIGENCE_DEV_DOMAIN is not set. " +
      'Set it to the product name you are testing (e.g. "daijob6-companytools") ' +
      "so credentials and session data are stored under ~/.workspaces/<domain>/test-engineer/. " +
      "Falling back to ~/.workspaces/qa-intelligence-default/test-engineer/.\n",
  );
  return join(homedir(), ".workspaces", "qa-intelligence-default", "test-engineer");
}
