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
  const activationProfileErrors = validateActivationProfiles(result.data);
  if (activationProfileErrors.length > 0) {
    return { ok: false, errors: activationProfileErrors };
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

function validateActivationProfiles(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];
  const profileIds = new Set<string>();
  let defaultCount = 0;
  for (const [index, profile] of manifest.activationProfiles.entries()) {
    if (profileIds.has(profile.id)) {
      errors.push(`/activationProfiles/${index}/id: 重复的 activation profile id ${profile.id}`);
    }
    profileIds.add(profile.id);
    if (profile.default) defaultCount += 1;
  }
  if (defaultCount > 1) {
    errors.push('/activationProfiles: 最多只能声明一个 default activation profile');
  }

  const validateRequirements = (requirements: { profiles?: string[] } | undefined, pointer: string): void => {
    for (const profileId of requirements?.profiles ?? []) {
      if (!profileIds.has(profileId)) {
        errors.push(`${pointer}: 引用了未声明的 activation profile ${profileId}`);
      }
    }
  };

  for (const [pointId, entries] of Object.entries(manifest.contributes ?? {})) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const record = entry as Record<string, unknown>;
      validateRequirements(asRequirements(record.requirements), `/contributes/${pointId}/${index}/requirements.profiles`);
      if (Array.isArray(record.tools)) {
        record.tools.forEach((tool, toolIndex) => {
          if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return;
          validateRequirements(
            asRequirements((tool as Record<string, unknown>).requirements),
            `/contributes/${pointId}/${index}/tools/${toolIndex}/requirements.profiles`,
          );
        });
      }
      if (Array.isArray(record.resources)) {
        record.resources.forEach((resource, resourceIndex) => {
          if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return;
          validateRequirements(
            asRequirements((resource as Record<string, unknown>).requirements),
            `/contributes/${pointId}/${index}/resources/${resourceIndex}/requirements.profiles`,
          );
        });
      }
      if (Array.isArray(record.prompts)) {
        record.prompts.forEach((prompt, promptIndex) => {
          if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return;
          validateRequirements(
            asRequirements((prompt as Record<string, unknown>).requirements),
            `/contributes/${pointId}/${index}/prompts/${promptIndex}/requirements.profiles`,
          );
        });
      }
    });
  }

  return errors;
}

function asRequirements(value: unknown): { profiles?: string[] } {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as { profiles?: string[] }
    : {};
}
