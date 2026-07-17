using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Live2D.Cubism.Core;
using Live2D.Cubism.Framework;
using Live2D.Cubism.Framework.Expression;
using Live2D.Cubism.Framework.HarmonicMotion;
using Live2D.Cubism.Framework.Motion;
using Live2D.Cubism.Framework.MotionFade;
using Live2D.Cubism.Rendering;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// Cubism 正式身体驱动。运行时只加载编辑期投影出的 prefab，不读取原始模型文件。
    /// </summary>
    public sealed class CubismAvatarModelDriver : MonoBehaviour, IAvatarModelDriver
    {
        private readonly Dictionary<string, CubismParameter> parameters = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, int> expressionIndices = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, AnimationClip> motionClips = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> missingMotionWarnings = new(StringComparer.OrdinalIgnoreCase);

        private GameObject modelRoot;
        private CubismModel model;
        private CubismExpressionController expressionController;
        private CubismExpressionList expressionList;
        private CubismUpdateController updateController;
        private CubismRenderController renderController;
        private CubismParameterMixer bodyParameterMixer;
        private CubismMotionController motionController;
        private CubismFadeController fadeController;
        private CubismActionOverlayController actionOverlay;
        private AvatarModelManifest manifest;

        public bool IsReady => modelRoot != null && model != null;
        public string DriverName => "cubism-sdk-unity";

        public void Initialize(AvatarModelManifest nextManifest)
        {
            DisposeModel();
            manifest = nextManifest;

            var prefab = Resources.Load<GameObject>(manifest.resourceKey);
            if (prefab == null)
            {
                Debug.LogWarning($"[UnityAvatarHost] 未找到 Cubism 模型 prefab: {manifest.resourceKey}");
                return;
            }

            modelRoot = Instantiate(prefab, transform, false);
            modelRoot.name = manifest.modelId;
            model = modelRoot.GetComponentInChildren<CubismModel>(true);
            if (model == null)
            {
                Debug.LogWarning($"[UnityAvatarHost] Cubism prefab 缺少 CubismModel: {manifest.resourceKey}");
                DisposeModel();
                return;
            }

            EnsureOriginalWorkflowComponents();
            LoadMotionClips();
            foreach (var parameter in model.Parameters)
            {
                if (parameter != null && !string.IsNullOrWhiteSpace(parameter.Id))
                {
                    parameters[parameter.Id] = parameter;
                }
            }

            BuildExpressionIndex();
            ConfigureActionOverlay();
            ConfigureBodyBaseline();
            ConfigureBodyParameterMixer();
            // 所有运行时添加的身体节点到齐后统一刷新，保证眨眼、呼吸、参数混合和动作层
            // 进入同一条确定的 Cubism 更新序列。
            updateController.Refresh();
        }

        public bool TryPreparePresentation(Camera camera, out string error)
        {
            error = string.Empty;
            if (!IsReady)
            {
                error = "Cubism 模型尚未初始化";
                return false;
            }
            if (camera == null || !camera.orthographic)
            {
                error = "Avatar 缺少正交主相机";
                return false;
            }
            if (!TryGetVisibleBounds(out var bounds))
            {
                error = "Cubism prefab 没有可见 Renderer";
                return false;
            }
            if (!HasRenderableDrawables(out error))
            {
                return false;
            }

            var viewportHeight = camera.orthographicSize * 2f * 0.94f;
            var viewportWidth = viewportHeight * camera.aspect * 0.94f;
            var fitScale = Mathf.Min(viewportWidth / bounds.size.x, viewportHeight / bounds.size.y);
            if (!float.IsFinite(fitScale) || fitScale <= 0f)
            {
                error = $"模型 bounds 无效: {bounds.size}";
                return false;
            }

            modelRoot.transform.localScale *= fitScale;
            if (!TryGetVisibleBounds(out bounds))
            {
                error = "模型缩放后无法计算可见 bounds";
                return false;
            }

            var presentationCenter = new Vector3(camera.transform.position.x, camera.transform.position.y, bounds.center.z);
            modelRoot.transform.position += presentationCenter - bounds.center;

            if (!TryGetVisibleBounds(out bounds) || !IsInsideCamera(camera, bounds))
            {
                error = "模型构图没有进入相机可见区域";
                return false;
            }

            Debug.Log($"[UnityAvatarHost] 模型构图完成 model={manifest.modelId} bounds={bounds.size}");
            return true;
        }

        public void SetEmotion(string emotionId, float intensity)
        {
            if (!string.IsNullOrWhiteSpace(emotionId))
            {
                SetExpression(emotionId);
            }
        }

        public void SetExpression(string expressionId)
        {
            TryTriggerExpression(expressionId, out _);
        }

        public bool TryTriggerExpression(string expressionId, out string error)
        {
            error = null;
            if (expressionController == null)
            {
                error = "Cubism 表情控制器尚未初始化";
                return false;
            }
            if (string.IsNullOrWhiteSpace(expressionId))
            {
                error = "动作缺少表达资源";
                return false;
            }

            var resolved = manifest?.ResolveExpressionId(expressionId) ?? expressionId;
            if (!expressionIndices.TryGetValue(NormalizeExpressionId(resolved), out var index))
            {
                error = $"模型未声明表达资源 {resolved}";
                return false;
            }

            expressionController.CurrentExpressionIndex = index;
            return true;
        }

        public bool TrySetActionExpression(string actionId, string expressionId, bool active, out string error)
        {
            if (actionOverlay == null)
            {
                error = $"模型未初始化可组合动作层: {actionId}";
                return false;
            }
            return actionOverlay.TrySetActionState(actionId, expressionId, active, out error);
        }

        public void PlayMotion(string motionId, bool loop, int priority)
        {
            if (!TryPlayMotion(motionId, loop, priority, out _) && missingMotionWarnings.Add(motionId ?? ""))
            {
                Debug.LogWarning($"[UnityAvatarHost] 模型未声明可播放动作: {motionId}");
            }
        }

        public bool TryPlayMotion(string motionId, bool loop, int priority, out string error)
        {
            error = null;
            if (motionController == null)
            {
                error = "Cubism 动作控制器尚未初始化";
                return false;
            }

            AnimationClip clip = null;
            foreach (var candidate in manifest?.ResolveMotionClipIds(motionId) ?? Array.Empty<string>())
            {
                if (motionClips.TryGetValue(candidate, out clip))
                {
                    break;
                }
            }
            if (clip == null)
            {
                error = $"模型未声明可播放动作 {motionId}";
                return false;
            }
            var cubismPriority = priority >= 50
                ? CubismMotionPriority.PriorityForce
                : priority > 0
                    ? CubismMotionPriority.PriorityNormal
                    : CubismMotionPriority.PriorityIdle;
            motionController.PlayAnimation(clip, 0, cubismPriority, loop);
            return true;
        }

        public void SetParameter(string parameterId, float value)
        {
            if (string.IsNullOrWhiteSpace(parameterId))
            {
                return;
            }

            if (parameters.TryGetValue(parameterId, out var parameter))
            {
                parameter.Value = Mathf.Clamp(value, parameter.MinimumValue, parameter.MaximumValue);
            }
        }

        public void ApplyBehaviorFrame(AvatarBehaviorFrame frame)
        {
            SetMouthOpen(frame.MouthOpen);
            bodyParameterMixer?.SetAttention(frame.GazeTarget);
        }

        private void SetMouthOpen(float value)
        {
            var mouthParameter = manifest?.behavior?.speech?.mouthParameterId;
            if (!string.IsNullOrWhiteSpace(mouthParameter) && parameters.ContainsKey(mouthParameter))
            {
                SetParameter(mouthParameter, value);
            }
        }

        public void Tick(float deltaTime)
        {
        }

        public bool TryGetInteractionHull(Camera camera, out Rect viewportHull)
        {
            viewportHull = default;
            if (camera == null || !TryGetVisibleBounds(out var bounds))
            {
                return false;
            }
            var minimum = camera.WorldToViewportPoint(bounds.min);
            var maximum = camera.WorldToViewportPoint(bounds.max);
            if (minimum.z <= 0f || maximum.z <= 0f)
            {
                return false;
            }
            const float padding = 0.025f;
            var xMin = Mathf.Clamp01(Mathf.Min(minimum.x, maximum.x) - padding);
            var yMin = Mathf.Clamp01(Mathf.Min(minimum.y, maximum.y) - padding);
            var xMax = Mathf.Clamp01(Mathf.Max(minimum.x, maximum.x) + padding);
            var yMax = Mathf.Clamp01(Mathf.Max(minimum.y, maximum.y) + padding);
            viewportHull = Rect.MinMaxRect(xMin, yMin, xMax, yMax);
            return viewportHull.width > 0.01f && viewportHull.height > 0.01f;
        }

        private void EnsureOriginalWorkflowComponents()
        {
            updateController = modelRoot.GetComponent<CubismUpdateController>();
            if (updateController == null)
            {
                updateController = modelRoot.AddComponent<CubismUpdateController>();
            }
            if (modelRoot.GetComponent<CubismParameterStore>() == null)
            {
                modelRoot.AddComponent<CubismParameterStore>();
            }

            _ = modelRoot.GetComponent<Animator>() ?? modelRoot.AddComponent<Animator>();
            fadeController = modelRoot.GetComponent<CubismFadeController>() ?? modelRoot.AddComponent<CubismFadeController>();
            if (fadeController.CubismFadeMotionList == null)
            {
                var directory = Path.GetDirectoryName(manifest.resourceKey)?.Replace('\\', '/') ?? string.Empty;
                var modelName = Path.GetFileName(manifest.resourceKey);
                fadeController.CubismFadeMotionList = Resources.Load<CubismFadeMotionList>(
                    $"{directory}/{modelName}.fadeMotionList"
                );
            }
            motionController = modelRoot.GetComponent<CubismMotionController>();
            if (motionController == null && fadeController.CubismFadeMotionList != null)
            {
                motionController = modelRoot.AddComponent<CubismMotionController>();
            }
            fadeController.Refresh();

            renderController = modelRoot.GetComponent<CubismRenderController>();
            if (renderController == null)
            {
                renderController = modelRoot.AddComponent<CubismRenderController>();
            }

            expressionController = modelRoot.GetComponent<CubismExpressionController>();
            if (expressionController == null)
            {
                expressionController = modelRoot.AddComponent<CubismExpressionController>();
            }

            // 运行时实例化发生在 Unity 的首帧之后，不能等组件自己的 Start 才建立更新委托。
            // 这里显式刷新，让 Cubism 的模型更新和 URP Render Pass 从同一帧开始拥有完整 Drawables。
            renderController.TryInitialize();
            updateController.Refresh();
            model.ForceUpdateNow();
            renderController.OnLateUpdate();

            var renderGroup = CubismRenderControllerGroup.GetInstance();
            if (!renderGroup.RenderControllers.Contains(renderController))
            {
                // 动态实例在 OnEnable 早于模型复苏时可能错过 SDK 的自动注册；补上唯一注册，
                // 让 URP Render Pass 能在本帧发现该身体。
                renderGroup.AddRenderController(renderController);
            }
        }

        private void ConfigureBodyBaseline()
        {
            var baseline = manifest?.behavior?.baseline;
            if (baseline?.blink?.enabled == true)
            {
                var blinkController = modelRoot.GetComponent<CubismEyeBlinkController>()
                    ?? modelRoot.AddComponent<CubismEyeBlinkController>();
                blinkController.Refresh();
                var blinkInput = modelRoot.GetComponent<CubismAutoEyeBlinkInput>()
                    ?? modelRoot.AddComponent<CubismAutoEyeBlinkInput>();
                blinkInput.Mean = Mathf.Clamp(baseline.blink.meanSeconds, 1f, 10f);
                blinkInput.MaximumDeviation = Mathf.Clamp(baseline.blink.maximumDeviationSeconds, 0.5f, 5f);
                blinkInput.Timescale = Mathf.Clamp(baseline.blink.timescale, 1f, 20f);
            }

            var breath = baseline?.breath;
            if (breath?.enabled != true || string.IsNullOrWhiteSpace(breath.parameterId)
                || !parameters.TryGetValue(breath.parameterId, out var breathParameter))
            {
                return;
            }

            var harmonicParameter = breathParameter.GetComponent<CubismHarmonicMotionParameter>()
                ?? breathParameter.gameObject.AddComponent<CubismHarmonicMotionParameter>();
            harmonicParameter.Channel = 0;
            harmonicParameter.Direction = CubismHarmonicMotionDirection.Centric;
            harmonicParameter.Duration = Mathf.Clamp(breath.durationSeconds, 0.5f, 10f);
            harmonicParameter.NormalizedOrigin = Mathf.Clamp01(breath.normalizedOrigin);
            harmonicParameter.NormalizedRange = Mathf.Clamp01(breath.normalizedRange);

            var harmonicController = modelRoot.GetComponent<CubismHarmonicMotionController>()
                ?? modelRoot.AddComponent<CubismHarmonicMotionController>();
            harmonicController.ChannelTimescales = new[] { 1f };
            harmonicController.BlendMode = CubismParameterBlendMode.Override;
            harmonicController.Refresh();
        }

        private void ConfigureBodyParameterMixer()
        {
            // prefab 中若带有旧 LookController，必须禁用；连续头身参数只能由统一混合器写入。
            foreach (var controller in modelRoot.GetComponents<Live2D.Cubism.Framework.LookAt.CubismLookController>())
            {
                controller.enabled = false;
            }

            bodyParameterMixer = modelRoot.GetComponent<CubismParameterMixer>()
                ?? modelRoot.AddComponent<CubismParameterMixer>();
            bodyParameterMixer.Configure(manifest?.behavior?.baseline, manifest?.behavior?.gaze, parameters);
        }

        private void LoadMotionClips()
        {
            motionClips.Clear();
            var directory = Path.GetDirectoryName(manifest.resourceKey)?.Replace('\\', '/') ?? string.Empty;
            foreach (var clip in Resources.LoadAll<AnimationClip>($"{directory}/motions"))
            {
                if (clip != null && !string.IsNullOrWhiteSpace(clip.name))
                {
                    motionClips[clip.name] = clip;
                }
            }
            Debug.Log($"[UnityAvatarHost] Cubism 动作资源已加载 clips={motionClips.Count} idle_group={manifest.idleMotionGroup}");
        }

        private bool HasRenderableDrawables(out string error)
        {
            error = string.Empty;
            if (renderController == null || !renderController.enabled || renderController.Renderers == null || renderController.Renderers.Length == 0)
            {
                error = "Cubism 渲染控制器没有可用 Drawables";
                return false;
            }

            var supportedCount = 0;
            foreach (var cubismRenderer in renderController.Renderers)
            {
                var material = cubismRenderer?.DrawMaterial ?? cubismRenderer?.Material;
                if (material == null || material.shader == null)
                {
                    continue;
                }
                if (!material.shader.isSupported)
                {
                    error = $"Cubism Shader 不受当前渲染管线支持: {material.shader.name}";
                    return false;
                }
                supportedCount++;
            }

            if (supportedCount == 0)
            {
                error = "Cubism 没有可用材质；请检查 Cubism URP SDK 是否完整导入";
                return false;
            }

            var registeredCount = CubismRenderControllerGroup.GetInstance().RenderControllers.Length;
            var maskedCount = model.Drawables.Count(drawable => drawable != null && drawable.IsMasked);
            Debug.Log($"[UnityAvatarHost] Cubism 渲染链路已验证 drawables={renderController.Renderers.Length} masked={maskedCount} group_controllers={registeredCount} materials={supportedCount}");
            return true;
        }

        private void BuildExpressionIndex()
        {
            var directory = Path.GetDirectoryName(manifest.resourceKey)?.Replace('\\', '/') ?? string.Empty;
            var expressions = Resources.LoadAll<CubismExpressionData>(directory);
            expressionList = ScriptableObject.CreateInstance<CubismExpressionList>();
            expressionList.CubismExpressionObjects = expressions;
            expressionController.ExpressionsList = expressionList;

            for (var index = 0; index < expressions.Length; index++)
            {
                var expression = expressions[index];
                if (expression != null)
                {
                    expressionIndices[NormalizeExpressionId(expression.name)] = index;
                }
            }
        }

        private void ConfigureActionOverlay()
        {
            actionOverlay = modelRoot.GetComponent<CubismActionOverlayController>()
                ?? modelRoot.AddComponent<CubismActionOverlayController>();
            actionOverlay.Configure(
                expressionList?.CubismExpressionObjects ?? Array.Empty<CubismExpressionData>(),
                parameters
            );
            actionOverlay.Refresh();
            // Overlay 是运行时动态添加的 Cubism 更新节点，刷新后才会进入 SDK 的稳定更新序列。
            updateController?.Refresh();
        }

        private static string NormalizeExpressionId(string value)
        {
            return Path.GetFileNameWithoutExtension(value ?? string.Empty)
                .Replace(".exp3", string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        private bool TryGetVisibleBounds(out Bounds bounds)
        {
            bounds = default;
            var renderers = modelRoot == null ? Array.Empty<Renderer>() : modelRoot.GetComponentsInChildren<Renderer>(true);
            var initialized = false;
            foreach (var renderer in renderers)
            {
                if (renderer == null || !renderer.enabled)
                {
                    continue;
                }

                if (!initialized)
                {
                    bounds = renderer.bounds;
                    initialized = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }

            if (initialized && bounds.size.x > 0.0001f && bounds.size.y > 0.0001f)
            {
                return true;
            }

            // Cubism 的动态 Mesh 在实例化首帧还没有有效 Renderer.bounds。
            // 初始构图必须读取模型自己的 Drawable 顶点，不能把首帧时序误判为模型损坏。
            initialized = false;
            var drawables = model?.Drawables ?? Array.Empty<CubismDrawable>();
            foreach (var drawable in drawables)
            {
                if (drawable == null)
                {
                    continue;
                }

                var vertices = drawable.VertexPositions;
                foreach (var vertex in vertices)
                {
                    var worldPoint = drawable.transform.TransformPoint(vertex);
                    if (!initialized)
                    {
                        bounds = new Bounds(worldPoint, Vector3.zero);
                        initialized = true;
                    }
                    else
                    {
                        bounds.Encapsulate(worldPoint);
                    }
                }
            }

            return initialized && bounds.size.x > 0.0001f && bounds.size.y > 0.0001f;
        }

        private static bool IsInsideCamera(Camera camera, Bounds bounds)
        {
            var minimum = camera.WorldToViewportPoint(bounds.min);
            var maximum = camera.WorldToViewportPoint(bounds.max);
            const float tolerance = 0.03f;
            return minimum.z > 0f
                && maximum.z > 0f
                && minimum.x >= -tolerance
                && maximum.x <= 1f + tolerance
                && minimum.y >= -tolerance
                && maximum.y <= 1f + tolerance;
        }

        private void DisposeModel()
        {
            parameters.Clear();
            expressionIndices.Clear();
            motionClips.Clear();
            missingMotionWarnings.Clear();
            if (expressionList != null)
            {
                Destroy(expressionList);
                expressionList = null;
            }
            if (modelRoot != null)
            {
                Destroy(modelRoot);
                modelRoot = null;
            }
            model = null;
            expressionController = null;
            updateController = null;
            renderController = null;
            bodyParameterMixer = null;
            motionController = null;
            fadeController = null;
            actionOverlay = null;
        }

        private void OnDestroy()
        {
            DisposeModel();
        }
    }
}
