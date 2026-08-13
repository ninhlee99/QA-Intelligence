export function buildResponsiveMatrix(browsers: readonly string[]): readonly Readonly<{ browser: string; classification: "mobile" | "tablet" | "desktop"; viewport: Readonly<{ width: number; height: number }> }>[] {
  const devices = [{ classification: "mobile" as const, viewport: { width: 390, height: 844 } }, { classification: "tablet" as const, viewport: { width: 768, height: 1024 } }, { classification: "desktop" as const, viewport: { width: 1440, height: 900 } }];
  return browsers.flatMap((browser) => devices.map((device) => ({ browser, ...device })));
}
