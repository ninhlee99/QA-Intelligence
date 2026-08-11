/**
 * Network oracle helpers for UI→API coupling in the same Playwright run.
 * Observations are captured from xhr/fetch only; bodies are truncated and
 * never include request Authorization headers.
 */
export type PlaywrightNetworkObservation = Readonly<{
  method: string;
  url: string;
  status: number;
  /** Truncated response body text when content-type is textual; else empty. */
  body_snippet: string;
}>;

export type ExpectedNetworkOracle = Readonly<{
  /** Substring that must appear in the response URL. */
  url_includes: string;
  method?: string;
  status?: number | readonly number[];
  body_includes?: string;
}>;

const MAX_BODY_CHARS = 4_096;
const MAX_OBSERVATIONS = 40;

export function shouldCaptureNetworkResponse(resourceType: string, url: string): boolean {
  if (resourceType !== "xhr" && resourceType !== "fetch") return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  return true;
}

export async function readBodySnippet(
  contentType: string | undefined,
  readText: () => Promise<string>,
): Promise<string> {
  const type = (contentType ?? "").toLowerCase();
  const textual =
    type.includes("json") ||
    type.includes("text/") ||
    type.includes("xml") ||
    type.includes("javascript") ||
    type === "";
  if (!textual) return "";
  try {
    const text = await readText();
    return text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;
  } catch {
    return "";
  }
}

export function pushNetworkObservation(
  bucket: PlaywrightNetworkObservation[],
  observation: PlaywrightNetworkObservation,
): void {
  if (bucket.length >= MAX_OBSERVATIONS) return;
  bucket.push(observation);
}

/**
 * True when at least one observation matches all declared constraints.
 * Missing optional fields do not constrain.
 */
export function networkOracleSatisfied(
  observations: readonly PlaywrightNetworkObservation[],
  expected: ExpectedNetworkOracle,
): boolean {
  const urlNeedle = expected.url_includes.trim();
  if (urlNeedle.length === 0) return false;
  const method = expected.method?.trim().toUpperCase();
  const statuses =
    expected.status === undefined
      ? undefined
      : Array.isArray(expected.status)
        ? expected.status
        : [expected.status];
  const bodyNeedle = expected.body_includes;

  return observations.some((obs) => {
    if (!obs.url.includes(urlNeedle)) return false;
    if (method !== undefined && obs.method.toUpperCase() !== method) return false;
    if (statuses !== undefined && !statuses.includes(obs.status)) return false;
    if (bodyNeedle !== undefined && !obs.body_snippet.includes(bodyNeedle)) return false;
    return true;
  });
}
