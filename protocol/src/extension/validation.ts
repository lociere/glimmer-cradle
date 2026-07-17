import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type {
  ExtensionManifest,
  ExtensionPackageChecksums,
  ExtensionPackageEnvelope,
  ExtensionRegistryCatalog,
  ExtensionReleaseManifest,
} from '../generated/extension';
import ExtensionManifestSchema from '../schemas/extension/ExtensionManifest.schema.json';
import ExtensionPermissionSchema from '../schemas/extension/ExtensionPermission.schema.json';
import CapabilityScopeSchema from '../schemas/models/CapabilityScope.schema.json';
import ExtensionPackageChecksumsSchema from '../schemas/extension/ExtensionPackageChecksums.schema.json';
import ExtensionPackageEnvelopeSchema from '../schemas/extension/ExtensionPackageEnvelope.schema.json';
import ExtensionRegistryCatalogSchema from '../schemas/extension/ExtensionRegistryCatalog.schema.json';
import ExtensionReleaseManifestSchema from '../schemas/extension/ExtensionReleaseManifest.schema.json';
import { isSafeExtensionPackagePath } from './package-format';

export interface ExtensionContractValidation<T> {
  ok: boolean;
  data?: T;
  errors: string[];
}

const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false, removeAdditional: false });
addFormats(ajv);
for (const schema of [
  CapabilityScopeSchema,
  ExtensionPermissionSchema,
  ExtensionManifestSchema,
  ExtensionPackageChecksumsSchema,
  ExtensionPackageEnvelopeSchema,
  ExtensionRegistryCatalogSchema,
  ExtensionReleaseManifestSchema,
]) ajv.addSchema(schema);

const validators = {
  manifest: ajv.getSchema(ExtensionManifestSchema.$id) as ValidateFunction,
  checksums: ajv.getSchema(ExtensionPackageChecksumsSchema.$id) as ValidateFunction,
  envelope: ajv.getSchema(ExtensionPackageEnvelopeSchema.$id) as ValidateFunction,
  registry: ajv.getSchema(ExtensionRegistryCatalogSchema.$id) as ValidateFunction,
  release: ajv.getSchema(ExtensionReleaseManifestSchema.$id) as ValidateFunction,
};

export function validateExtensionManifest(value: unknown): ExtensionContractValidation<ExtensionManifest> {
  const result = validate<ExtensionManifest>(validators.manifest, value);
  if (!result.ok || !result.data) return result;
  const namespace = result.data.id.split('.')[0];
  if (result.data.publisher !== namespace) {
    return { ok: false, errors: [`/publisher: 必须与 extension id 命名空间一致，期望 ${namespace}`] };
  }
  return result;
}

export function validateExtensionPackageEnvelope(value: unknown): ExtensionContractValidation<ExtensionPackageEnvelope> {
  return validate(validators.envelope, value);
}

export function validateExtensionPackageChecksums(value: unknown): ExtensionContractValidation<ExtensionPackageChecksums> {
  const result = validate<ExtensionPackageChecksums>(validators.checksums, value);
  if (!result.ok || !result.data) return result;
  const invalid = result.data.files.find((entry) => !isSafeExtensionPackagePath(entry.path));
  return invalid
    ? { ok: false, errors: [`/files: 非法包内路径 ${invalid.path}`] }
    : result;
}

export function validateExtensionRegistryCatalog(value: unknown): ExtensionContractValidation<ExtensionRegistryCatalog> {
  return validate(validators.registry, value);
}

export function validateExtensionReleaseManifest(value: unknown): ExtensionContractValidation<ExtensionReleaseManifest> {
  const result = validate<ExtensionReleaseManifest>(validators.release, value);
  if (!result.ok || !result.data) return result;
  const invalid = result.data.artifacts.find((artifact) => !isSafeExtensionPackagePath(artifact.file));
  return invalid
    ? { ok: false, errors: [`/artifacts: 非法包路径 ${invalid.file}`] }
    : result;
}

function validate<T>(validator: ValidateFunction, value: unknown): ExtensionContractValidation<T> {
  if (!validator(value)) {
    return {
      ok: false,
      errors: (validator.errors ?? []).map((error) => `${error.instancePath || '/'}: ${error.message ?? 'unknown'}`),
    };
  }
  return { ok: true, data: value as T, errors: [] };
}
