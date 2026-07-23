using System;
using System.IO;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    [Serializable]
    public sealed class AvatarCompositionConfig
    {
        public string provider = "platform-native";
        public bool alwaysOnTop = true;
        public string inputPolicy = "model-hull";
    }

    [Serializable]
    public sealed class UnityAvatarHostConfig
    {
        public string kernelUrl = "";
        public string hostId = "unity-avatar";
        public string hostVersion = "0.1.4";
        public string modelId = "";
        public string modelRegistryFile = "avatar-package-registry.json";
        public float reconnectDelaySeconds = 2.0f;
        public int windowWidth = 420;
        public int windowHeight = 760;
        /** 身体渲染面相对桌面窗口的超采样倍率，用于高 DPI 下保持发丝和轮廓清晰。 */
        public float renderScale = 1.5f;
        public AvatarCompositionConfig composition = new AvatarCompositionConfig();

        public static UnityAvatarHostConfig Load()
        {
            var configPath = Path.Combine(Application.streamingAssetsPath, "avatar-host.json");
            if (!File.Exists(configPath))
            {
                Debug.LogWarning($"[UnityAvatarHost] 配置文件不存在，使用默认配置: {configPath}");
                return ApplyHostEnvironment(new UnityAvatarHostConfig());
            }

            try
            {
                var json = File.ReadAllText(configPath);
                var config = JsonUtility.FromJson<UnityAvatarHostConfig>(json);
                config ??= new UnityAvatarHostConfig();
                return ApplyHostEnvironment(config);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 读取配置失败，使用默认配置: {ex.Message}");
                return ApplyHostEnvironment(new UnityAvatarHostConfig());
            }
        }

        private static UnityAvatarHostConfig ApplyHostEnvironment(UnityAvatarHostConfig config)
        {
            var endpoint = Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_WS_URL");
            if (!string.IsNullOrWhiteSpace(endpoint)) config.kernelUrl = endpoint;
            return config;
        }
    }
}
