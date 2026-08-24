using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 连续身体行为在单帧内的不可变解析结果。驱动只消费此对象，不重新解释输入来源。
    /// </summary>
    public readonly struct AvatarBehaviorFrame
    {
        public AvatarBehaviorFrame(float mouthOpen, Vector2 gazeTarget)
        {
            MouthOpen = mouthOpen;
            GazeTarget = gazeTarget;
        }

        public float MouthOpen { get; }
        public Vector2 GazeTarget { get; }
    }
}
