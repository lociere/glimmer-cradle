using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace GlimmerCradle.Avatar
{
    public static class UnityAvatarHostBootstrap
    {
        private const string PresentationCameraName = "Avatar Presentation Camera";
        private static Camera presentationCamera;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void EnsureAvatarHost()
        {
            EnsurePresentationCamera();
            if (Object.FindFirstObjectByType<AvatarProtocolClient>() != null)
            {
                return;
            }

            var root = new GameObject("UnityAvatarHost");
            root.AddComponent<AvatarCompositionHost>();
            root.AddComponent<AvatarPresentationController>();
            root.AddComponent<AvatarBehaviorController>();
            root.AddComponent<AvatarLive2DController>();
            root.AddComponent<AvatarProtocolClient>();
        }

        public static Camera GetPresentationCamera()
        {
            return presentationCamera != null ? presentationCamera : EnsurePresentationCamera();
        }

        private static Camera EnsurePresentationCamera()
        {
            if (presentationCamera != null)
            {
                return presentationCamera;
            }

            var existing = GameObject.Find(PresentationCameraName);
            var cameraObject = existing ?? new GameObject(PresentationCameraName);
            presentationCamera = cameraObject.GetComponent<Camera>() ?? cameraObject.AddComponent<Camera>();
            presentationCamera.orthographic = true;
            presentationCamera.orthographicSize = 2.2f;
            presentationCamera.clearFlags = CameraClearFlags.SolidColor;
            presentationCamera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            var cameraData = cameraObject.GetComponent<UniversalAdditionalCameraData>()
                ?? cameraObject.AddComponent<UniversalAdditionalCameraData>();
            cameraData.SetRenderer(0);
            presentationCamera.transform.position = new Vector3(0f, 1.0f, -10f);
            return presentationCamera;
        }
    }
}
