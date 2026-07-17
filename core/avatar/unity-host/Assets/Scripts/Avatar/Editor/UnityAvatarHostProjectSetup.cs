using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace GlimmerCradle.Avatar.Editor
{
    /// <summary>
    /// 由工程唯一入口创建并绑定 URP 资产，避免场景或机器各自保存一份渲染管线事实。
    /// </summary>
    [InitializeOnLoad]
    public static class UnityAvatarHostProjectSetup
    {
        private const string SettingsDirectory = "Assets/Settings";
        private const string CubismRendererAssetPath = "Assets/Live2D/Cubism/Rendering/URP/CubismURPRenderer.asset";
        private const string PipelineAssetPath = SettingsDirectory + "/UnityAvatarHostURP.asset";

        static UnityAvatarHostProjectSetup()
        {
            EditorApplication.delayCall += EnsureConfigured;
        }

        public static void EnsureConfigured()
        {
            PlayerSettings.companyName = "Glimmer Cradle";
            PlayerSettings.productName = "UnityAvatarHost";
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.defaultScreenWidth = 420;
            PlayerSettings.defaultScreenHeight = 760;
            PlayerSettings.resizableWindow = false;
            PlayerSettings.runInBackground = true;
            PlayerSettings.SplashScreen.show = false;
            // Windows 桌面透明呈现依赖 DWM 合成 alpha；D3D11 flip model 会丢失该路径。
            PlayerSettings.useFlipModelSwapchain = false;

            Directory.CreateDirectory(SettingsDirectory);
            var rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(CubismRendererAssetPath);
            if (rendererData == null)
            {
                throw new FileNotFoundException(
                    "Cubism SDK 的 URP Renderer 不存在，请先通过统一构建入口导入 Cubism SDK",
                    CubismRendererAssetPath
                );
            }

            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelineAssetPath);
            if (pipeline == null
                || pipeline.rendererDataList.Length == 0
                || pipeline.rendererDataList[0] != rendererData)
            {
                if (pipeline != null)
                {
                    AssetDatabase.DeleteAsset(PipelineAssetPath);
                }

                pipeline = UniversalRenderPipelineAsset.Create(rendererData);
                AssetDatabase.CreateAsset(pipeline, PipelineAssetPath);
            }

            var changed = false;

            // Renderer Feature 的内部映射由 Cubism SDK 维护。项目只引用它，不复制或重建第三方
            // RendererData，避免序列化版本变化造成“模型已实例化但从未进入颜色缓冲”的假就绪。
            rendererData.SetDirty();

            if (GraphicsSettings.defaultRenderPipeline != pipeline)
            {
                GraphicsSettings.defaultRenderPipeline = pipeline;
                changed = true;
            }
            if (QualitySettings.renderPipeline != pipeline)
            {
                QualitySettings.renderPipeline = pipeline;
                changed = true;
            }

            if (changed)
            {
                Debug.Log("[UnityAvatarHost] 已绑定 URP 渲染管线资产");
            }
            AssetDatabase.SaveAssets();
        }
    }
}
