type ApiOperation = Readonly<{ required_parameters?: readonly string[]; response_statuses?: readonly string[] }>;
export type ApiContract = Readonly<Record<string, Readonly<Record<string, ApiOperation>>>>;
export function assessApiContractDrift(input: Readonly<{ baseline: ApiContract; candidate: ApiContract }>): Readonly<{ breaking: boolean; changes: readonly string[] }> {
  const changes: string[] = [];
  for (const [path, methods] of Object.entries(input.baseline)) for (const [method, operation] of Object.entries(methods)) {
    const next = input.candidate[path]?.[method];
    if (!next) { changes.push(`removed operation ${method.toUpperCase()} ${path}`); continue; }
    for (const parameter of next.required_parameters ?? []) if (!(operation.required_parameters ?? []).includes(parameter)) changes.push(`new required parameter ${parameter} on ${method.toUpperCase()} ${path}`);
    for (const status of operation.response_statuses ?? []) if (!(next.response_statuses ?? []).includes(status)) changes.push(`removed response ${status} from ${method.toUpperCase()} ${path}`);
  }
  return { breaking: changes.length > 0, changes };
}
