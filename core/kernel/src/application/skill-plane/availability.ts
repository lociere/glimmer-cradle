import type {
  CapabilityScope,
  ContributionRequirements,
  SkillAvailabilityContext,
  SkillPlanePolicyPort,
} from '../../ports/skill-plane.port';
import { GLOBAL_CAPABILITY_SCOPE } from '@glimmer-cradle/capabilities';

/** $self 是扩展接入的身份绑定，不属于 Core 的 scope 判断。 */
function resolveExtensionCapabilityScope(
  scope: CapabilityScope | undefined,
  extensionId: string,
  inherited: CapabilityScope = GLOBAL_CAPABILITY_SCOPE,
): CapabilityScope {
  const selected = scope ?? inherited;
  if (selected.kind === 'global') return selected;
  const [firstId, ...remainingIds] = selected.ids;
  return { ...selected, ids: [firstId === '$self' ? extensionId : firstId,
    ...remainingIds.map(id => id === '$self' ? extensionId : id)] };
}

export function isContributionAvailable(
  requirements: Partial<ContributionRequirements> | undefined,
  context: SkillAvailabilityContext,
): boolean {
  const products = requirements?.products ?? ['any'];
  if (!products.includes('any') && !products.includes(context.productId)) return false;
  const platforms = requirements?.platforms ?? ['any'];
  if (!platforms.includes('any') && !platforms.includes(context.platform)) return false;
  return (requirements?.features ?? []).every((feature) => context.features.has(feature));
}

export class SkillPlanePolicy implements SkillPlanePolicyPort {
  public isContributionAvailable(
    requirements: Partial<ContributionRequirements> | undefined,
    context: SkillAvailabilityContext,
  ): boolean {
    return isContributionAvailable(requirements, context);
  }

  public resolveExtensionScope(
    scope: CapabilityScope | undefined,
    extensionId: string,
    inherited?: CapabilityScope,
  ): CapabilityScope {
    return resolveExtensionCapabilityScope(scope, extensionId, inherited);
  }
}
