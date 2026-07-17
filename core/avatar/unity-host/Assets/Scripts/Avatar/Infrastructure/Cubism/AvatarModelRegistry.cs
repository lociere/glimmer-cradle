using System;
using System.IO;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    [Serializable]
    public sealed class AvatarModelRegistry
    {
        public string defaultAvatarPackageId = "";
        public string defaultModelId = "";
        public AvatarModelDescriptor[] models = Array.Empty<AvatarModelDescriptor>();

        public static AvatarModelRegistry Load(string registryFile)
        {
            if (string.IsNullOrWhiteSpace(registryFile) || Path.IsPathRooted(registryFile))
            {
                throw new InvalidDataException("Avatar registry 文件必须是 StreamingAssets 下的相对路径");
            }

            var registryPath = Path.Combine(Application.streamingAssetsPath, registryFile);
            if (!File.Exists(registryPath))
            {
                throw new FileNotFoundException("Avatar registry 不存在", registryPath);
            }

            var registry = JsonUtility.FromJson<AvatarModelRegistry>(File.ReadAllText(registryPath));
            if (registry == null || registry.models == null || registry.models.Length == 0)
            {
                throw new InvalidDataException("Avatar registry 没有可用模型");
            }
            return registry;
        }

        public AvatarModelDescriptor Resolve(string requestedModelId)
        {
            var targetId = string.IsNullOrWhiteSpace(requestedModelId) ? defaultModelId : requestedModelId;
            foreach (var model in models)
            {
                if (model != null && string.Equals(model.id, targetId, StringComparison.OrdinalIgnoreCase))
                {
                    return model;
                }
            }

            throw new InvalidDataException($"Avatar registry 未声明模型: {targetId}");
        }
    }
}
