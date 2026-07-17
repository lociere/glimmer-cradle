using System;
using System.Collections.Generic;
using Live2D.Cubism.Core;
using Live2D.Cubism.Framework;
using Live2D.Cubism.Framework.Expression;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 将模型声明的可切换动作以可组合参数层应用到 Cubism。
    /// 这与瞬时表情分开：前者保留用户已打开的外观状态，后者仍由 SDK 的 ExpressionController 负责淡入淡出。
    /// </summary>
    public sealed class CubismActionOverlayController : MonoBehaviour, ICubismUpdatable
    {
        private readonly Dictionary<string, CubismExpressionData> expressions = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, CubismParameter> parameters = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> activeActionExpressions = new(StringComparer.OrdinalIgnoreCase);

        public int ExecutionOrder => 850;
        public bool NeedsUpdateOnEditing => false;
        public bool HasUpdateController { get; set; }

        public void Refresh()
        {
            HasUpdateController = GetComponent<Live2D.Cubism.Framework.CubismUpdateController>() != null;
        }

        public void Configure(
            IEnumerable<CubismExpressionData> availableExpressions,
            IReadOnlyDictionary<string, CubismParameter> availableParameters
        )
        {
            expressions.Clear();
            parameters.Clear();
            activeActionExpressions.Clear();

            foreach (var expression in availableExpressions ?? Array.Empty<CubismExpressionData>())
            {
                if (expression != null && !string.IsNullOrWhiteSpace(expression.name))
                {
                    expressions[NormalizeExpressionId(expression.name)] = expression;
                }
            }
            foreach (var parameter in availableParameters ?? new Dictionary<string, CubismParameter>())
            {
                if (!string.IsNullOrWhiteSpace(parameter.Key) && parameter.Value != null)
                {
                    parameters[parameter.Key] = parameter.Value;
                }
            }
        }

        public bool TrySetActionState(string actionId, string expressionId, bool active, out string error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(actionId) || string.IsNullOrWhiteSpace(expressionId))
            {
                error = "动作缺少 ID 或表达资源";
                return false;
            }

            var normalizedExpressionId = NormalizeExpressionId(expressionId);
            if (!expressions.ContainsKey(normalizedExpressionId))
            {
                error = $"模型未声明表达资源 {expressionId}";
                return false;
            }

            if (active)
            {
                activeActionExpressions[actionId] = normalizedExpressionId;
            }
            else
            {
                activeActionExpressions.Remove(actionId);
            }
            return true;
        }

        public void OnLateUpdate()
        {
            if (!enabled || !HasUpdateController)
            {
                return;
            }
            // 放在物理之后、渲染之前执行：每一帧以 Cubism 当前参数为基线叠加，
            // 不会把动作、物理、嘴型或视线的中间值永久写死。
            foreach (var action in activeActionExpressions)
            {
                if (!expressions.TryGetValue(action.Value, out var expression) || expression.Parameters == null)
                {
                    continue;
                }
                foreach (var item in expression.Parameters)
                {
                    if (!parameters.TryGetValue(item.Id, out var parameter))
                    {
                        continue;
                    }
                    switch (item.Blend)
                    {
                        case CubismParameterBlendMode.Additive:
                            parameter.AddToValue(item.Value);
                            break;
                        case CubismParameterBlendMode.Multiply:
                            parameter.MultiplyValueBy(item.Value);
                            break;
                        case CubismParameterBlendMode.Override:
                            parameter.OverrideValue(item.Value);
                            break;
                    }
                }
            }
        }

        private static string NormalizeExpressionId(string value)
        {
            return System.IO.Path.GetFileNameWithoutExtension(value ?? string.Empty)
                .Replace(".exp3", string.Empty, StringComparison.OrdinalIgnoreCase);
        }
    }
}
