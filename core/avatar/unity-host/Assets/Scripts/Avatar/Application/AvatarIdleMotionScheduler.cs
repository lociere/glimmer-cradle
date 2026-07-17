using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 作者 idle motion 的唯一生命周期入口。缺少 idle motion 时保留基线微行为，不伪造动作。
    /// </summary>
    public sealed class AvatarIdleMotionScheduler
    {
        private IAvatarModelDriver driver;
        private bool attempted;
        private bool running;

        public void Initialize(IAvatarModelDriver nextDriver)
        {
            driver = nextDriver;
            attempted = false;
            running = false;
            EnsureRunning();
        }

        public void EnsureRunning()
        {
            if (running || attempted || driver == null)
            {
                return;
            }
            attempted = true;
            if (driver.TryPlayMotion("idle", true, 0, out var error))
            {
                running = true;
                return;
            }
            Debug.Log($"[UnityAvatarHost] 模型未提供 idle motion，将仅使用身体基线: {error}");
        }
    }
}
