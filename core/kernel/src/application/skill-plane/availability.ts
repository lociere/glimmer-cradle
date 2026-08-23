import type {
  CapabilityScope,
  ContributionRequirements,
  SkillAvailabilityContext,
  SkillPlanePolicyPort,
} from '../../ports/skill-plane.port';
import { resolveExtensionCapabilityScope } from './scope';

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
