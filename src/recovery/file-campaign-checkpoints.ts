import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CampaignCheckpoint = Readonly<{ campaign_id: string; case_id: string; input_digest: string; outcome: string; evidence: readonly string[]; completed_at: string }>;

export class FileCampaignCheckpoints {
  constructor(private readonly root: string) {}
  async record(value: CampaignCheckpoint): Promise<string> {
    const dir = join(this.root, safe(value.campaign_id));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${safe(value.case_id)}.json`);
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify({ schema_version: "1.0.0", ...value }, null, 2)}\n`, "utf8");
    await rename(temp, path);
    return path;
  }
  async resume(campaignId: string, caseId: string, inputDigest: string): Promise<
    Readonly<{ status: "resume"; checkpoint: CampaignCheckpoint }> | Readonly<{ status: "run" }> | Readonly<{ status: "conflict"; message: string }>
  > {
    try {
      const value = JSON.parse(await readFile(join(this.root, safe(campaignId), `${safe(caseId)}.json`), "utf8")) as CampaignCheckpoint;
      if (value.input_digest !== inputDigest) return { status: "conflict", message: "Checkpoint input digest differs from the current testcase." };
      return { status: "resume", checkpoint: value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "run" };
      throw error;
    }
  }
}

function safe(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "_"); }
