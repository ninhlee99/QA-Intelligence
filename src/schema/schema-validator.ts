import {
  Ajv2020,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import formatsPackage from "ajv-formats";

type FormatsInstaller = (ajv: Ajv2020) => unknown;
const addFormats = formatsPackage as unknown as FormatsInstaller;

export interface NormalizedValidationError {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly NormalizedValidationError[] };

export type SchemaObject = Readonly<Record<string, unknown>>;

/**
 * Owns strict JSON Schema validation and hides provider-specific errors behind a
 * stable, caller-facing result.
 */
export class SchemaValidator {
  readonly #validators: ReadonlyMap<string, ValidateFunction>;

  constructor(schemas: readonly SchemaObject[]) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);

    for (const schema of schemas) {
      ajv.addSchema(schema as AnySchemaObject);
    }

    this.#validators = new Map(
      schemas.flatMap((schema) => {
        const schemaId = schema.$id;
        if (typeof schemaId !== "string") {
          return [];
        }

        const validator = ajv.getSchema(schemaId);
        return validator === undefined ? [] : [[schemaId, validator] as const];
      }),
    );
  }

  validate<T>(schemaId: string, value: unknown): ValidationResult<T> {
    const validator = this.#validators.get(schemaId);
    if (validator === undefined) {
      return {
        ok: false,
        errors: [
          {
            path: "",
            keyword: "unknown_schema",
            message: `Schema is not registered: ${schemaId}`,
          },
        ],
      };
    }

    return validator(value)
      ? { ok: true, value: value as T }
      : {
          ok: false,
          errors: (validator.errors ?? []).map(normalizeError),
        };
  }
}

function normalizeError(error: ErrorObject): NormalizedValidationError {
  return {
    path: errorPath(error),
    keyword: error.keyword,
    message: normalizedMessage(error.keyword),
  };
}

function errorPath(error: ErrorObject): string {
  const parameters = error.params as Readonly<Record<string, unknown>>;
  const property =
    error.keyword === "required"
      ? parameters.missingProperty
      : error.keyword === "additionalProperties"
        ? parameters.additionalProperty
        : undefined;

  return typeof property === "string"
    ? `${error.instancePath}/${escapeJsonPointerSegment(property)}`
    : error.instancePath;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizedMessage(keyword: string): string {
  switch (keyword) {
    case "additionalProperties":
      return "Property is not allowed.";
    case "format":
      return "Value does not match the required format.";
    case "maxLength":
      return "Value is longer than the allowed maximum.";
    case "minLength":
      return "Value is shorter than the allowed minimum.";
    case "required":
      return "Required property is missing.";
    default:
      return "Value does not satisfy the schema constraint.";
  }
}
