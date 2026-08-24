using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    public static class AvatarModelManifestLoader
    {
        public static AvatarModelManifest Load(AvatarModelDescriptor descriptor)
        {
            var metadataDirectory = ResolveStreamingAssetPath(descriptor.metadataRoot, "metadataRoot");
            var manifest = new AvatarModelManifest
            {
                avatarPackageId = descriptor.avatarPackageId,
                modelId = descriptor.id,
                resourceKey = descriptor.resourceKey,
                idleMotionGroup = descriptor.idleMotionGroup,
                motionGroups = descriptor.motionGroups ?? Array.Empty<AvatarMotionGroup>(),
                presentation = descriptor.presentation ?? new AvatarPresentationProfile(),
                actions = LoadActions(ResolveOptionalChild(metadataDirectory, descriptor.actionsFile, "actionsFile")),
                behavior = LoadBehavior(ResolveOptionalChild(metadataDirectory, descriptor.behaviorFile, "behaviorFile")),
            };

            LoadEmotionMap(
                ResolveOptionalChild(metadataDirectory, descriptor.emotionMapFile, "emotionMapFile"),
                manifest
            );
            return manifest;
        }

        private static AvatarActionManifest LoadActions(string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            {
                return new AvatarActionManifest();
            }
            return AvatarActionManifest.FromDocument(
                JsonUtility.FromJson<AvatarActionDocument>(File.ReadAllText(filePath))
            );
        }

        private static AvatarBehaviorProfile LoadBehavior(string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            {
                return new AvatarBehaviorProfile();
            }
            try
            {
                return AvatarBehaviorProfile.FromDocument(
                    JsonUtility.FromJson<AvatarBehaviorDocument>(File.ReadAllText(filePath))
                );
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 读取模型行为清单失败，将禁用可选身体反应: {ex.Message}");
                return new AvatarBehaviorProfile();
            }
        }

        private static void LoadEmotionMap(string filePath, AvatarModelManifest manifest)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            {
                return;
            }
            var json = File.ReadAllText(filePath);
            CopyNonEmpty(ReadObjectStringMap(json, "expressions"), manifest.emotionToExpression);
            CopyNonEmpty(ReadObjectStringMap(json, "motions"), manifest.emotionToMotion);
        }

        private static void CopyNonEmpty(
            Dictionary<string, string> source,
            Dictionary<string, string> target)
        {
            foreach (var item in source)
            {
                if (!string.IsNullOrWhiteSpace(item.Value))
                {
                    target[item.Key] = item.Value;
                }
            }
        }

        private static Dictionary<string, string> ReadObjectStringMap(string json, string objectKey)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var body = ReadObjectBody(json, objectKey);
            if (body == null) return result;

            foreach (Match match in Regex.Matches(body, "\"([^\"]+)\"\\s*:\\s*(?:\"([^\"]*)\"|null)"))
            {
                result[match.Groups[1].Value] = match.Groups[2].Success ? match.Groups[2].Value : "";
            }
            return result;
        }

        private static string ReadObjectBody(string json, string objectKey)
        {
            var keyMatch = Regex.Match(json, $"\"{Regex.Escape(objectKey)}\"\\s*:\\s*\\{{");
            if (!keyMatch.Success) return null;

            var start = keyMatch.Index + keyMatch.Length;
            var depth = 1;
            for (var index = start; index < json.Length; index++)
            {
                if (json[index] == '{') depth++;
                if (json[index] == '}') depth--;
                if (depth == 0) return json.Substring(start, index - start);
            }
            return null;
        }

        private static string ResolveStreamingAssetPath(string relativePath, string fieldName)
        {
            return ResolveChildPath(Application.streamingAssetsPath, relativePath, fieldName);
        }

        private static string ResolveOptionalChild(string parent, string relativePath, string fieldName)
        {
            return string.IsNullOrWhiteSpace(relativePath)
                ? ""
                : ResolveChildPath(parent, relativePath, fieldName);
        }

        private static string ResolveChildPath(string parent, string relativePath, string fieldName)
        {
            if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath))
            {
                throw new InvalidDataException($"Avatar registry 的 {fieldName} 不是安全相对路径");
            }

            var parentPath = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var candidate = Path.GetFullPath(Path.Combine(parentPath, relativePath));
            if (!candidate.StartsWith(parentPath, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException($"Avatar registry 的 {fieldName} 越过了资产边界");
            }
            return candidate;
        }
    }
}
