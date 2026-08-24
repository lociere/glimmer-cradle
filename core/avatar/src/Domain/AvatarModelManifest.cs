using System;
using System.Collections.Generic;

namespace GlimmerCradle.Avatar
{
    public sealed class AvatarModelManifest
    {
        public string avatarPackageId = "";
        public string modelId = "";
        public string resourceKey = "";
        public AvatarBehaviorProfile behavior = new AvatarBehaviorProfile();
        public AvatarPresentationProfile presentation = new AvatarPresentationProfile();
        public AvatarActionManifest actions = new AvatarActionManifest();
        public string idleMotionGroup = "";
        public AvatarMotionGroup[] motionGroups = Array.Empty<AvatarMotionGroup>();
        public readonly Dictionary<string, string> emotionToExpression = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public readonly Dictionary<string, string> emotionToMotion = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public string ResolveMotionId(string motionId)
        {
            if (string.IsNullOrWhiteSpace(motionId))
            {
                return "idle";
            }

            return emotionToMotion.TryGetValue(motionId, out var mapped) ? mapped : motionId;
        }

        public string ResolveExpressionId(string expressionOrActionId)
        {
            if (actions.TryResolve(expressionOrActionId, out var action)
                && string.Equals(action.targetKind, "expression", StringComparison.OrdinalIgnoreCase))
            {
                return action.targetId;
            }
            return expressionOrActionId;
        }

        public string[] ResolveMotionClipIds(string motionId)
        {
            var resolved = ResolveMotionId(motionId);
            var groupId = string.Equals(resolved, "idle", StringComparison.OrdinalIgnoreCase)
                ? idleMotionGroup
                : resolved;
            foreach (var group in motionGroups ?? Array.Empty<AvatarMotionGroup>())
            {
                if (group != null && string.Equals(group.id, groupId, StringComparison.OrdinalIgnoreCase)
                    && group.clips != null && group.clips.Length > 0)
                {
                    return group.clips;
                }
            }
            return string.IsNullOrWhiteSpace(resolved) ? Array.Empty<string>() : new[] { resolved };
        }

    }
}
