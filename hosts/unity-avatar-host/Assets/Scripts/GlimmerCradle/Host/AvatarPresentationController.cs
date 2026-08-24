using System;
using System.IO;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 身体驻留位置和构图的应用控制器；它不理解平台窗口细节，只通过 Composition Host 工作。
    /// </summary>
    public sealed class AvatarPresentationController : MonoBehaviour
    {
        [Serializable]
        private sealed class PlacementState
        {
            public int version;
            public bool hasPosition;
            public int x;
            public int y;
        }

        private const int PlacementStateVersion = 1;
        private AvatarCompositionHost compositionHost;
        private AvatarPresentationProfile presentation = new AvatarPresentationProfile();
        private string placementOverride;
        private float displayScale = 1.2f;
        private string placementStatePath;
        private UnityAvatarHostConfig config;
        private AvatarLive2DController avatar;
        private bool placementApplied;
        private bool firstFrameReady;

        public bool HasPresentedFirstFrame => compositionHost != null && compositionHost.HasPresentedFirstFrame;
        public bool IsReady => firstFrameReady && HasPresentedFirstFrame;
        public AvatarCompositionHost CompositionHost => compositionHost;
        public event Action PresentationReady;

        private void Awake()
        {
            config = UnityAvatarHostConfig.Load();
            placementStatePath = ResolvePlacementStatePath();
            compositionHost = GetComponent<AvatarCompositionHost>() ?? gameObject.AddComponent<AvatarCompositionHost>();
            compositionHost.PresentationReady += HandleCompositionReady;
            compositionHost.Initialize(UnityAvatarHostBootstrap.GetPresentationCamera(), config);
        }

        private void OnDestroy()
        {
            if (compositionHost != null)
            {
                compositionHost.PresentationReady -= HandleCompositionReady;
            }
        }

        private void Update()
        {
            if (!firstFrameReady && HasPresentedFirstFrame)
            {
                HandleCompositionReady();
            }
            if (compositionHost == null || !compositionHost.IsReady)
            {
                return;
            }
            if (!placementApplied)
            {
                RestoreOrDock();
                placementApplied = true;
            }
            if (compositionHost.TakePlacementDirty())
            {
                SaveCurrentPlacement();
            }
            if (avatar == null)
            {
                avatar = GetComponent<AvatarLive2DController>();
            }
            if (avatar != null && avatar.TryGetInteractionHull(out var hull))
            {
                compositionHost.SetInputHull(hull);
            }
        }

        private void HandleCompositionReady()
        {
            if (firstFrameReady || !HasPresentedFirstFrame)
            {
                return;
            }
            firstFrameReady = true;
            RestoreOrDock();
            placementApplied = true;
            PresentationReady?.Invoke();
        }

        public void ApplyPresentation(AvatarPresentationProfile profile)
        {
            presentation = profile ?? new AvatarPresentationProfile();
            placementOverride = null;
            placementApplied = false;
            RestoreOrDock();
        }

        public void ApplyPresentationCommand(string placementId, float requestedDisplayScale, bool resetPlacement)
        {
            if (!string.IsNullOrWhiteSpace(placementId))
            {
                placementOverride = placementId;
            }
            if (requestedDisplayScale > 0f)
            {
                ApplyDisplayScale(requestedDisplayScale);
            }
            if (resetPlacement)
            {
                TryDeletePlacement();
            }
            if (!string.IsNullOrWhiteSpace(placementId) || resetPlacement)
            {
                placementApplied = true;
                Dock();
            }
        }

        private void ApplyDisplayScale(float requestedScale)
        {
            var nextScale = Mathf.Clamp(requestedScale, 0.5f, 2.5f);
            if (Mathf.Approximately(nextScale, displayScale) || compositionHost == null || !compositionHost.IsReady)
            {
                displayScale = nextScale;
                return;
            }

            displayScale = nextScale;
            if (!compositionHost.TryGetBounds(out var current))
            {
                return;
            }
            var width = Mathf.RoundToInt(config.windowWidth * displayScale);
            var height = Mathf.RoundToInt(config.windowHeight * displayScale);
            compositionHost.SetBounds(new RectInt(current.xMax - width, current.yMax - height, width, height));
        }

        public bool TryGetPointerNormalized(out Vector2 pointer)
        {
            pointer = Vector2.zero;
            return compositionHost != null && compositionHost.TryGetPointerNormalized(out pointer);
        }

        private void RestoreOrDock()
        {
            if (compositionHost == null || !compositionHost.IsReady)
            {
                return;
            }
            if (TryLoadPlacement(out var placement))
            {
                compositionHost.SetBounds(new RectInt(
                    placement.x,
                    placement.y,
                    Mathf.RoundToInt(config.windowWidth * displayScale),
                    Mathf.RoundToInt(config.windowHeight * displayScale)
                ));
                return;
            }
            Dock();
        }

        private void Dock()
        {
            if (compositionHost == null || !compositionHost.IsReady)
            {
                return;
            }
            var preset = presentation.Resolve(placementOverride);
            var surfaceHeight = Mathf.RoundToInt(config.windowHeight * displayScale);
            var visibleHeight = Mathf.RoundToInt(surfaceHeight * Mathf.Clamp(preset.visibleRatio, 0.25f, 1f));
            compositionHost.Dock(visibleHeight, preset.rightInset, preset.bottomInset);
        }

        private bool TryLoadPlacement(out PlacementState placement)
        {
            placement = null;
            try
            {
                if (string.IsNullOrWhiteSpace(placementStatePath) || !File.Exists(placementStatePath))
                {
                    return false;
                }
                placement = JsonUtility.FromJson<PlacementState>(File.ReadAllText(placementStatePath));
                return placement != null
                    && placement.version == PlacementStateVersion
                    && placement.hasPosition;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 读取身体位置失败，将使用默认驻留位置: {ex.Message}");
                return false;
            }
        }

        private void SaveCurrentPlacement()
        {
            if (compositionHost == null || !compositionHost.TryGetBounds(out var bounds))
            {
                return;
            }
            try
            {
                var directory = Path.GetDirectoryName(placementStatePath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                File.WriteAllText(placementStatePath, JsonUtility.ToJson(new PlacementState
                {
                    version = PlacementStateVersion,
                    hasPosition = true,
                    x = bounds.x,
                    y = bounds.y,
                }, true));
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 保存身体位置失败: {ex.Message}");
            }
        }

        private void TryDeletePlacement()
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(placementStatePath) && File.Exists(placementStatePath))
                {
                    File.Delete(placementStatePath);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 重置身体位置失败: {ex.Message}");
            }
        }

        private static string ResolvePlacementStatePath()
        {
            var configured = Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_PLACEMENT_PATH");
            return string.IsNullOrWhiteSpace(configured)
                ? Path.Combine(Application.persistentDataPath, "avatar-placement.json")
                : Path.GetFullPath(configured);
        }
    }
}
