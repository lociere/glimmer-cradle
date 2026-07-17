using System;

namespace GlimmerCradle.Avatar
{
    [Serializable]
    public sealed class AvatarPlacementPreset
    {
        public string id = "full-body";
        public float visibleRatio = 1f;
        public int rightInset = 24;
        public int bottomInset = 16;
    }

    [Serializable]
    public sealed class AvatarPresentationProfile
    {
        public string defaultPlacement = "full-body";
        public AvatarPlacementPreset[] placementPresets = Array.Empty<AvatarPlacementPreset>();

        public AvatarPlacementPreset Resolve(string placementId = null)
        {
            var targetId = string.IsNullOrWhiteSpace(placementId) ? defaultPlacement : placementId;
            foreach (var preset in placementPresets ?? Array.Empty<AvatarPlacementPreset>())
            {
                if (preset != null && string.Equals(preset.id, targetId, StringComparison.OrdinalIgnoreCase))
                {
                    return preset;
                }
            }
            return new AvatarPlacementPreset();
        }
    }

    [Serializable]
    public sealed class AvatarMotionGroup
    {
        public string id = "";
        public string[] clips = Array.Empty<string>();
    }

    [Serializable]
    public sealed class AvatarModelDescriptor
    {
        public string avatarPackageId = "";
        public string id = "";
        public string displayName = "";
        public string metadataRoot = "";
        public string emotionMapFile = "";
        public string actionsFile = "";
        public string behaviorFile = "";
        public string resourceKey = "";
        public string modelFormat = "";
        public string idleMotionGroup = "";
        public AvatarMotionGroup[] motionGroups = Array.Empty<AvatarMotionGroup>();
        public AvatarPresentationProfile presentation = new AvatarPresentationProfile();
    }
}
