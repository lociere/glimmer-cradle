using System;
using System.Collections;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Process = System.Diagnostics.Process;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// Avatar 的通用合成边界。Unity 只渲染带 alpha 的 GPU 纹理；具体平台负责把纹理
    /// 合成到无边框身体窗口、透明区域命中穿透和窗口拖动中。
    /// </summary>
    public sealed class AvatarCompositionHost : MonoBehaviour
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct NativeHostConfig
        {
            public int width;
            public int height;
            public int always_on_top;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect
        {
            public int x;
            public int y;
            public int width;
            public int height;
        }

        private const int NativeSuccess = 0;
        private IntPtr nativeHost = IntPtr.Zero;
        private RenderTexture compositionTexture;
        private RenderTexture exportTexture;
        private Camera presentationCamera;
        private bool surfaceAttached;
        private Coroutine renderWorkerLoop;
        private bool unityContainerIsolated;
        private bool firstFrameLogged;
        private int submittedFrameCount;
        private IntPtr renderEventFunction = IntPtr.Zero;
        private IntPtr unityContainerWindow = IntPtr.Zero;
        private IntPtr originalUnityWindowStyle = IntPtr.Zero;
        private IntPtr originalUnityWindowExStyle = IntPtr.Zero;
        private int configuredWidth;
        private int configuredHeight;
        private int renderWidth;
        private int renderHeight;

        /// <summary>
        /// 原生 Composition Host 已把至少一帧带 alpha 的身体画面提交给桌面。
        /// 这是 Avatar 允许向 Kernel 报告 host_ready 的唯一呈现事实。
        /// </summary>
        public event Action PresentationReady;

        public bool IsReady
        {
            get
            {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
                return nativeHost != IntPtr.Zero
                    && surfaceAttached
                    && platform_native_composition_host_has_presented(nativeHost, out var presented) == NativeSuccess
                    && presented != 0;
#else
                return false;
#endif
            }
        }
        public bool IsSupported
        {
            get
            {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
                return true;
#else
                return false;
#endif
            }
        }

        public bool HasPresentedFirstFrame => firstFrameLogged;

        public string GetWorkerWindowState()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            return unityContainerIsolated ? "isolated" : "visible";
#else
            return "unknown";
#endif
        }

        public string GetCompositionSurfaceState()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero) return "unknown";
            return surfaceAttached ? "attached" : "failed";
#else
            return "unknown";
#endif
        }

        public string GetReadinessDiagnostic()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            return $"host_created={nativeHost != IntPtr.Zero} surface_attached={surfaceAttached} "
                + $"frames_submitted={submittedFrameCount} first_frame_presented={firstFrameLogged}";
#else
            return "platform_adapter_unavailable";
#endif
        }

        public bool Initialize(Camera camera, UnityAvatarHostConfig config)
        {
            if (IsReady)
            {
                return true;
            }
            if (camera == null || config == null)
            {
                Debug.LogWarning("[UnityAvatarHost] Composition Host 缺少相机或配置");
                return false;
            }

            presentationCamera = camera;
            ReportRenderPipelineAudit(camera);
            RefreshRendererFeatures();
            configuredWidth = Mathf.Max(1, config.windowWidth);
            configuredHeight = Mathf.Max(1, config.windowHeight);
            var renderScale = Mathf.Clamp(config.renderScale, 1f, 2f);
            renderWidth = Mathf.CeilToInt(configuredWidth * renderScale);
            renderHeight = Mathf.CeilToInt(configuredHeight * renderScale);
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            unityContainerWindow = Process.GetCurrentProcess().MainWindowHandle;
            if (unityContainerWindow == IntPtr.Zero)
            {
                unityContainerWindow = GetActiveWindow();
            }
#endif
            // 先隔离 Unity worker，再调整 Player 分辨率。否则 SetResolution 可能在
            // Native Composition 接管前短暂显示默认左上角窗口。
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            IsolateUnityContainerWindow();
#endif
            Screen.fullScreenMode = FullScreenMode.Windowed;
            Screen.SetResolution(configuredWidth, configuredHeight, FullScreenMode.Windowed);
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            IsolateUnityContainerWindow();
#endif
            ConfigureCameraTarget();

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            var nativeResult = platform_native_composition_host_create(
                new NativeHostConfig
                {
                    width = configuredWidth,
                    height = configuredHeight,
                    always_on_top = config.composition == null || config.composition.alwaysOnTop ? 1 : 0,
                },
                out nativeHost
            );
            if (nativeResult != NativeSuccess || nativeHost == IntPtr.Zero)
            {
                nativeHost = IntPtr.Zero;
                RestoreUnityContainerWindow();
                Debug.LogWarning($"[UnityAvatarHost] Composition Host 创建失败 result={nativeResult}");
                return false;
            }

            renderEventFunction = platform_native_composition_host_get_render_event_func();
            if (renderEventFunction == IntPtr.Zero)
            {
                platform_native_composition_host_destroy(nativeHost);
                nativeHost = IntPtr.Zero;
                RestoreUnityContainerWindow();
                Debug.LogWarning("[UnityAvatarHost] Composition Host 未提供 Unity 渲染线程回调");
                return false;
            }

            renderWorkerLoop = StartCoroutine(RunRenderWorker());
            return true;
#else
            Debug.LogWarning("[UnityAvatarHost] 当前平台尚未提供 Composition Host 适配器");
            return false;
#endif
        }

        public void SetInputHull(Rect viewportHull)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero)
            {
                return;
            }
            var left = Mathf.Clamp01(viewportHull.xMin);
            var bottom = Mathf.Clamp01(viewportHull.yMin);
            var right = Mathf.Clamp01(viewportHull.xMax);
            var top = Mathf.Clamp01(viewportHull.yMax);
            platform_native_composition_host_set_input_hull(
                nativeHost,
                new NativeRect
                {
                    x = Mathf.RoundToInt(left * configuredWidth),
                    y = Mathf.RoundToInt((1f - top) * configuredHeight),
                    width = Mathf.Max(1, Mathf.RoundToInt((right - left) * configuredWidth)),
                    height = Mathf.Max(1, Mathf.RoundToInt((top - bottom) * configuredHeight)),
                }
            );
#endif
        }

        public bool TryGetPointerNormalized(out Vector2 pointer)
        {
            pointer = Vector2.zero;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero)
            {
                return false;
            }
            if (platform_native_composition_host_get_pointer_normalized(nativeHost, out var x, out var y) != NativeSuccess)
            {
                return false;
            }
            pointer = new Vector2(x, y);
            return true;
#else
            return false;
#endif
        }

        public bool TryGetBounds(out RectInt bounds)
        {
            bounds = default;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero || platform_native_composition_host_get_bounds(nativeHost, out var nativeBounds) != NativeSuccess)
            {
                return false;
            }
            bounds = new RectInt(nativeBounds.x, nativeBounds.y, nativeBounds.width, nativeBounds.height);
            return true;
#else
            return false;
#endif
        }

        public void SetBounds(RectInt bounds)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero)
            {
                return;
            }
            platform_native_composition_host_set_bounds(nativeHost, new NativeRect
            {
                x = bounds.x,
                y = bounds.y,
                width = Mathf.Max(1, bounds.width),
                height = Mathf.Max(1, bounds.height),
            });
#endif
        }

        public void Dock(int visibleHeight, int rightInset, int bottomInset)
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero)
            {
                return;
            }
            platform_native_composition_host_dock(
                nativeHost,
                Mathf.Max(1, visibleHeight),
                Mathf.Max(0, rightInset),
                Mathf.Max(0, bottomInset)
            );
#endif
        }

        public bool TakePlacementDirty()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            return nativeHost != IntPtr.Zero
                && platform_native_composition_host_take_placement_dirty(nativeHost, out var dirty) == NativeSuccess
                && dirty != 0;
#else
            return false;
#endif
        }

        private void ConfigureCameraTarget()
        {
            var cameraData = presentationCamera.GetComponent<UniversalAdditionalCameraData>()
                ?? presentationCamera.gameObject.AddComponent<UniversalAdditionalCameraData>();
            cameraData.renderType = CameraRenderType.Base;
            cameraData.SetRenderer(0);
            if (compositionTexture != null)
            {
                compositionTexture.Release();
                Destroy(compositionTexture);
            }
            compositionTexture = new RenderTexture(renderWidth, renderHeight, 24, RenderTextureFormat.ARGB32)
            {
                name = "AvatarCompositionSurface",
                antiAliasing = 1,
                filterMode = FilterMode.Bilinear,
                useMipMap = false,
                autoGenerateMips = false,
            };
            compositionTexture.Create();
            exportTexture = new RenderTexture(renderWidth, renderHeight, 0, RenderTextureFormat.ARGB32)
            {
                name = "AvatarCompositionExport",
                antiAliasing = 1,
                filterMode = FilterMode.Bilinear,
                useMipMap = false,
                autoGenerateMips = false,
            };
            exportTexture.Create();
            presentationCamera.targetTexture = compositionTexture;
            presentationCamera.clearFlags = CameraClearFlags.SolidColor;
            presentationCamera.backgroundColor = new Color(0f, 0f, 0f, 0f);
        }

        private static void ReportRenderPipelineAudit(Camera camera)
        {
            if (!string.Equals(Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_RENDER_AUDIT"), "1", StringComparison.Ordinal))
            {
                return;
            }
            var pipeline = GraphicsSettings.currentRenderPipeline;
            var cameraData = camera == null ? null : camera.GetComponent<UniversalAdditionalCameraData>();
            var activeRenderer = cameraData?.scriptableRenderer;
            var rendererData = Resources.FindObjectsOfTypeAll<UniversalRendererData>();
            var description = string.Join(
                ";",
                Array.ConvertAll(
                    rendererData,
                    data => $"{data.name}[{string.Join(",", data.rendererFeatures.ConvertAll(feature => feature == null ? "missing" : $"{feature.GetType().Name}:{feature.isActive}"))}]"
                )
            );
            Debug.Log(
                $"[UnityAvatarHost] 渲染管线审计 pipeline={pipeline?.GetType().Name ?? "none"} "
                + $"camera_renderer={activeRenderer?.GetType().Name ?? "none"} renderer_data={description}"
            );
        }

        private static void RefreshRendererFeatures()
        {
            foreach (var rendererData in Resources.FindObjectsOfTypeAll<UniversalRendererData>())
            {
                if (rendererData.rendererFeatures.Exists(feature => feature != null && feature.GetType().Name == "CubismRenderPassFeature"))
                {
                    // Unity 在 Player 首帧可能先构造缓存 renderer、后恢复第三方 feature 子资产。
                    // 显式失效一次，使正式身体相机从首个有效帧起使用已声明的 Cubism pass。
                    rendererData.SetDirty();
                }
            }
        }

        private IEnumerator RunRenderWorker()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            // Render Worker 的帧生产不能依赖 OS 容器窗口是否可见。主动渲染到固定纹理，
            // 才能让平台合成窗口成为唯一 Desktop Surface，并避免 DWM 隐藏窗口时抑制相机更新。
            presentationCamera.enabled = false;
            yield return null;
            presentationCamera.Render();
            NormalizeCompositionFrame();
            if (nativeHost == IntPtr.Zero || exportTexture == null)
            {
                yield break;
            }
            firstFrameLogged = false;
            submittedFrameCount = 0;
            var result = platform_native_composition_host_attach_surface(nativeHost, exportTexture.GetNativeTexturePtr());
            if (result != NativeSuccess)
            {
                RestoreUnityContainerWindow();
                Debug.LogWarning($"[UnityAvatarHost] Composition Host 无法附着 Unity 渲染面 result={result} detail={ReadNativeError()}");
                yield break;
            }
            surfaceAttached = true;
            StartCoroutine(CaptureCompositionIfRequested());
            Debug.Log("[UnityAvatarHost] Composition Host 渲染面已附着，等待首个可见帧");
            while (nativeHost != IntPtr.Zero && surfaceAttached)
            {
                yield return new WaitForEndOfFrame();
                presentationCamera.Render();
                NormalizeCompositionFrame();
                var commandBuffer = CommandBufferPool.Get("Avatar Composition Present");
                commandBuffer.IssuePluginEventAndData(renderEventFunction, 1, nativeHost);
                Graphics.ExecuteCommandBuffer(commandBuffer);
                CommandBufferPool.Release(commandBuffer);
                submittedFrameCount++;
                if (!firstFrameLogged
                    && platform_native_composition_host_has_presented(nativeHost, out var presented) == NativeSuccess
                    && presented != 0)
                {
                    firstFrameLogged = true;
                    Debug.Log("[UnityAvatarHost] Composition Host 首个身体帧已呈现");
                    PresentationReady?.Invoke();
                }
                else if (!firstFrameLogged && submittedFrameCount == 120)
                {
                    Debug.LogWarning($"[UnityAvatarHost] Composition Host 尚未呈现首帧 detail={ReadNativeError()}");
                }
            }
#endif
            yield break;
        }

        private void NormalizeCompositionFrame()
        {
            if (compositionTexture == null || exportTexture == null)
            {
                return;
            }
            // Unity D3D RenderTexture 与 DXGI Composition Surface 的纵轴约定相反。
            // 在 GPU 导出边界统一坐标，模型与平台层都不感知平台特例。
            Graphics.Blit(
                compositionTexture,
                exportTexture,
                new Vector2(1f, -1f),
                new Vector2(0f, 1f)
            );
        }

        private void IsolateUnityContainerWindow()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (string.Equals(Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_SHOW_WORKER"), "1", StringComparison.Ordinal))
            {
                return;
            }
            if (unityContainerWindow == IntPtr.Zero)
            {
                return;
            }
            if (!unityContainerIsolated)
            {
                originalUnityWindowStyle = GetWindowLongPtr(unityContainerWindow, -16);
                originalUnityWindowExStyle = GetWindowLongPtr(unityContainerWindow, -20);
            }
            var workerStyle = new IntPtr(0x80000000L); // WS_POPUP
            var workerExStyle = new IntPtr(
                originalUnityWindowExStyle.ToInt64()
                | 0x00000080L // WS_EX_TOOLWINDOW
                | 0x08000000L // WS_EX_NOACTIVATE
                | 0x00080000L // WS_EX_LAYERED
            );
            SetWindowLongPtr(unityContainerWindow, -16, workerStyle);
            SetWindowLongPtr(unityContainerWindow, -20, workerExStyle);
            SetLayeredWindowAttributes(unityContainerWindow, 0, 0, 0x00000002); // LWA_ALPHA
            SetWindowPos(
                unityContainerWindow,
                new IntPtr(1), // HWND_BOTTOM
                0,
                0,
                configuredWidth,
                configuredHeight,
                0x0010 | 0x0020 | 0x0080 // NOACTIVATE | FRAMECHANGED | HIDEWINDOW
            );
            unityContainerIsolated = true;
#endif
        }

        private void RestoreUnityContainerWindow()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (!unityContainerIsolated || unityContainerWindow == IntPtr.Zero)
            {
                return;
            }
            SetLayeredWindowAttributes(unityContainerWindow, 0, 255, 0x00000002);
            SetWindowLongPtr(unityContainerWindow, -16, originalUnityWindowStyle);
            SetWindowLongPtr(unityContainerWindow, -20, originalUnityWindowExStyle);
            SetWindowPos(
                unityContainerWindow,
                IntPtr.Zero,
                80,
                80,
                configuredWidth,
                configuredHeight,
                0x0004 | 0x0010 | 0x0020 | 0x0040 // NOZORDER | NOACTIVATE | FRAMECHANGED | SHOWWINDOW
            );
            unityContainerIsolated = false;
#endif
        }

        private IEnumerator CaptureCompositionIfRequested()
        {
            var outputPath = Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_COMPOSITION_CAPTURE_PATH");
            if (string.IsNullOrWhiteSpace(outputPath) || compositionTexture == null)
            {
                yield break;
            }
            yield return new WaitForEndOfFrame();
            yield return new WaitForEndOfFrame();

            var previous = RenderTexture.active;
            var copy = new Texture2D(compositionTexture.width, compositionTexture.height, TextureFormat.RGBA32, false);
            try
            {
                RenderTexture.active = compositionTexture;
                copy.ReadPixels(new Rect(0, 0, compositionTexture.width, compositionTexture.height), 0, 0);
                copy.Apply(false, false);
                var directory = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                File.WriteAllBytes(outputPath, copy.EncodeToPNG());
                Debug.Log($"[UnityAvatarHost] 已写入 Composition Host 诊断帧: {outputPath}");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 写入 Composition Host 诊断帧失败: {ex.Message}");
            }
            finally
            {
                RenderTexture.active = previous;
                Destroy(copy);
            }
        }

        private void OnDestroy()
        {
            if (renderWorkerLoop != null)
            {
                StopCoroutine(renderWorkerLoop);
                renderWorkerLoop = null;
            }
            if (presentationCamera != null && presentationCamera.targetTexture == compositionTexture)
            {
                presentationCamera.targetTexture = null;
            }
            if (compositionTexture != null)
            {
                compositionTexture.Release();
                Destroy(compositionTexture);
            }
            if (exportTexture != null)
            {
                exportTexture.Release();
                Destroy(exportTexture);
            }
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost != IntPtr.Zero)
            {
                platform_native_composition_host_destroy(nativeHost);
                nativeHost = IntPtr.Zero;
            }
            RestoreUnityContainerWindow();
#endif
        }

        private string ReadNativeError()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (nativeHost == IntPtr.Zero)
            {
                return "host-unavailable";
            }
            var buffer = new StringBuilder(512);
            platform_native_composition_host_get_last_error(nativeHost, buffer, buffer.Capacity);
            return string.IsNullOrWhiteSpace(buffer.ToString()) ? "未提供平台错误详情" : buffer.ToString();
#else
            return "unsupported-platform";
#endif
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_create(NativeHostConfig config, out IntPtr host);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_attach_surface(IntPtr host, IntPtr nativeTexture);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr platform_native_composition_host_get_render_event_func();

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_has_presented(IntPtr host, out int presented);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_set_bounds(IntPtr host, NativeRect bounds);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_get_bounds(IntPtr host, out NativeRect bounds);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_dock(
            IntPtr host,
            int visibleHeight,
            int rightInset,
            int bottomInset
        );

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_set_input_hull(IntPtr host, NativeRect hull);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_take_placement_dirty(IntPtr host, out int dirty);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern int platform_native_composition_host_get_pointer_normalized(IntPtr host, out float x, out float y);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void platform_native_composition_host_get_last_error(IntPtr host, StringBuilder message, int messageMaxLength);

        [DllImport("platform_native", CallingConvention = CallingConvention.Cdecl)]
        private static extern void platform_native_composition_host_destroy(IntPtr host);

        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
        private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr window, uint colorKey, byte alpha, uint flags);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(
            IntPtr window,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags
        );
#endif
    }
}
