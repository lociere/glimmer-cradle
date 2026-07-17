using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering.Universal;

namespace GlimmerCradle.Avatar.Editor
{
    public static class UnityAvatarHostBuild
    {
        private const string ScenePath = "Assets/Scenes/UnityAvatarHost.unity";

        public static void BuildWindows()
        {
            UnityAvatarHostProjectSetup.EnsureConfigured();
            EnsureBuildScene();

            var outputPath = ResolveOutputPath();
            PrepareOutputDirectory(outputPath);

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = outputPath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None,
            };

            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
            {
                throw new System.Exception($"Avatar 构建失败: {report.summary.result}");
            }

            Debug.Log($"[UnityAvatarHost] 构建完成: {outputPath}");
        }

        private static void EnsureBuildScene()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            var scene = File.Exists(ScenePath)
                ? EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single)
                : EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var changed = false;

            var camera = Camera.main;
            if (camera == null)
            {
                var cameraObject = new GameObject("Main Camera");
                camera = cameraObject.AddComponent<Camera>();
                camera.tag = "MainCamera";
                changed = true;
            }
            changed |= ConfigureCamera(camera);

            var host = GameObject.Find("UnityAvatarHost");
            if (host == null)
            {
                host = new GameObject("UnityAvatarHost");
                changed = true;
            }
            changed |= EnsureComponent<global::GlimmerCradle.Avatar.AvatarCompositionHost>(host);
            changed |= EnsureComponent<global::GlimmerCradle.Avatar.AvatarPresentationController>(host);
            changed |= EnsureComponent<global::GlimmerCradle.Avatar.AvatarBehaviorController>(host);
            changed |= EnsureComponent<global::GlimmerCradle.Avatar.AvatarLive2DController>(host);
            changed |= EnsureComponent<global::GlimmerCradle.Avatar.AvatarProtocolClient>(host);

            if (changed || !File.Exists(ScenePath))
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
        }

        private static bool ConfigureCamera(Camera camera)
        {
            var changed = false;
            if (!camera.orthographic)
            {
                camera.orthographic = true;
                changed = true;
            }
            if (!Mathf.Approximately(camera.orthographicSize, 2.2f))
            {
                camera.orthographicSize = 2.2f;
                changed = true;
            }
            if (camera.clearFlags != CameraClearFlags.SolidColor)
            {
                camera.clearFlags = CameraClearFlags.SolidColor;
                changed = true;
            }
            if (camera.backgroundColor != new Color(0f, 0f, 0f, 0f))
            {
                camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                changed = true;
            }
            if (camera.GetComponent<UniversalAdditionalCameraData>() == null)
            {
                camera.gameObject.AddComponent<UniversalAdditionalCameraData>();
                changed = true;
            }
            var rendererData = camera.GetComponent<UniversalAdditionalCameraData>();
            rendererData.SetRenderer(0);
            var expectedPosition = new Vector3(0f, 1.0f, -10f);
            if (camera.transform.position != expectedPosition)
            {
                camera.transform.position = expectedPosition;
                changed = true;
            }
            return changed;
        }

        private static bool EnsureComponent<T>(GameObject gameObject) where T : Component
        {
            if (gameObject.GetComponent<T>() != null)
            {
                return false;
            }
            gameObject.AddComponent<T>();
            return true;
        }

        private static string ResolveOutputPath()
        {
            var fromEnv = System.Environment.GetEnvironmentVariable("GLIMMER_CRADLE_UNITY_AVATAR_HOST_OUTPUT");
            if (!string.IsNullOrWhiteSpace(fromEnv))
            {
                return Path.GetFullPath(fromEnv);
            }

            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var repoRoot = Path.GetFullPath(Path.Combine(projectRoot, "..", "..", ".."));
            return Path.Combine(repoRoot, "data", "packages", "avatar", "unity-host", "windows", "UnityAvatarHost.exe");
        }

        private static void PrepareOutputDirectory(string outputPath)
        {
            var outputDirectory = Path.GetDirectoryName(outputPath);
            if (string.IsNullOrWhiteSpace(outputDirectory))
            {
                throw new System.Exception("Avatar 输出路径缺少目录");
            }

            var fullOutputDirectory = Path.GetFullPath(outputDirectory);
            if (Path.GetPathRoot(fullOutputDirectory) == fullOutputDirectory)
            {
                throw new System.Exception($"拒绝清理磁盘根目录: {fullOutputDirectory}");
            }

            if (Directory.Exists(fullOutputDirectory))
            {
                Directory.Delete(fullOutputDirectory, true);
            }
            Directory.CreateDirectory(fullOutputDirectory);
        }
    }
}
