using System;
using System.Collections.Generic;
using Live2D.Cubism.Core;
using Live2D.Cubism.Framework;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 身体参数的唯一连续混合点。模型基线、空闲微动与短暂注意力在物理计算前汇合，
    /// 避免多个 Cubism controller 争夺头部、眼球和身体参数。
    /// </summary>
    public sealed class CubismParameterMixer : MonoBehaviour, ICubismUpdatable
    {
        private sealed class IdleChannel
        {
            public float amplitude;
            public float periodSeconds;
            public float phase;
        }

        private sealed class ParameterChannel
        {
            public CubismParameter parameter;
            public float pose;
            public float attentionX;
            public float attentionY;
            public readonly List<IdleChannel> idle = new List<IdleChannel>();
            public bool hasPreviousOutput;
            public float previousContribution;
            public float previousOutput;
        }

        private readonly Dictionary<string, ParameterChannel> channels =
            new Dictionary<string, ParameterChannel>(StringComparer.OrdinalIgnoreCase);
        private Vector2 attention;

        public int ExecutionOrder => 750;
        public bool NeedsUpdateOnEditing => false;
        public bool HasUpdateController { get; set; }

        public void Configure(
            AvatarBaselineProfile baseline,
            AvatarGazeProfile gaze,
            IReadOnlyDictionary<string, CubismParameter> parameters
        )
        {
            channels.Clear();
            attention = Vector2.zero;

            foreach (var item in baseline?.posture?.pose ?? Array.Empty<AvatarPoseParameter>())
            {
                if (TryGetChannel(item?.parameterId, parameters, out var channel))
                {
                    channel.pose += item.value;
                }
            }

            foreach (var item in baseline?.posture?.idle ?? Array.Empty<AvatarIdleParameter>())
            {
                if (TryGetChannel(item?.parameterId, parameters, out var channel))
                {
                    channel.idle.Add(new IdleChannel
                    {
                        amplitude = item.amplitude,
                        periodSeconds = Mathf.Clamp(item.periodSeconds, 1.5f, 60f),
                        phase = Mathf.Repeat(item.phase, 1f)
                    });
                }
            }

            foreach (var binding in gaze?.bindings ?? Array.Empty<AvatarGazeBinding>())
            {
                if (!TryGetChannel(binding?.parameterId, parameters, out var channel))
                {
                    continue;
                }

                if (string.Equals(binding.axis, "y", StringComparison.OrdinalIgnoreCase))
                {
                    channel.attentionY += binding.factor;
                }
                else
                {
                    channel.attentionX += binding.factor;
                }
            }

            HasUpdateController = GetComponent<CubismUpdateController>() != null;
        }

        public void SetAttention(Vector2 value)
        {
            attention = new Vector2(
                Mathf.Clamp(value.x, -1f, 1f),
                Mathf.Clamp(value.y, -1f, 1f)
            );
        }

        public void OnLateUpdate()
        {
            if (!enabled || !HasUpdateController)
            {
                return;
            }

            var now = Time.unscaledTime;
            foreach (var item in channels.Values)
            {
                var contribution = item.pose
                    + attention.x * item.attentionX
                    + attention.y * item.attentionY;
                foreach (var idle in item.idle)
                {
                    var cycle = now / idle.periodSeconds + idle.phase;
                    contribution += Mathf.Sin(cycle * Mathf.PI * 2f) * idle.amplitude;
                }

                // Animator 或 Motion 若已在本帧重写参数，就以它为新基线；否则移除上帧由本混合器
                // 写入的贡献后再计算，避免未被动画曲线覆盖的参数逐帧累积。
                var baseValue = item.parameter.Value;
                if (item.hasPreviousOutput && Mathf.Abs(baseValue - item.previousOutput) <= 0.001f)
                {
                    baseValue -= item.previousContribution;
                }

                item.parameter.OverrideValue(baseValue + contribution);
                item.previousContribution = contribution;
                item.previousOutput = item.parameter.Value;
                item.hasPreviousOutput = true;
            }
        }

        private bool TryGetChannel(
            string parameterId,
            IReadOnlyDictionary<string, CubismParameter> parameters,
            out ParameterChannel channel
        )
        {
            channel = null;
            if (string.IsNullOrWhiteSpace(parameterId)
                || parameters == null
                || !parameters.TryGetValue(parameterId, out var parameter)
                || parameter == null)
            {
                return false;
            }

            if (!channels.TryGetValue(parameterId, out channel))
            {
                channel = new ParameterChannel { parameter = parameter };
                channels[parameterId] = channel;
            }
            return true;
        }
    }
}
