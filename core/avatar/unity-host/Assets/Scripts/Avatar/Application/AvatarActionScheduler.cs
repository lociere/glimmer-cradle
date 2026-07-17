using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 保持动作的唯一状态机。它只接受显式目标操作，并在执行前验证依赖关系。
    /// </summary>
    public sealed class AvatarActionScheduler
    {
        private readonly HashSet<string> activeActions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private AvatarActionManifest manifest;
        private IAvatarModelDriver driver;

        public void Initialize(AvatarActionManifest nextManifest, IAvatarModelDriver nextDriver)
        {
            manifest = nextManifest ?? new AvatarActionManifest();
            driver = nextDriver;
            activeActions.Clear();
            RestorePersistedState();
        }

        public AvatarActionStatePayload Apply(AvatarIntentPayload intent)
        {
            if (intent == null || string.IsNullOrWhiteSpace(intent.action_id) || driver == null)
            {
                return Snapshot(intent?.action_id, "rejected", "动作请求不完整");
            }
            if (!manifest.TryResolve(intent.action_id, out var action))
            {
                return Snapshot(intent.action_id, "rejected", $"模型未声明动作 {intent.action_id}");
            }
            if (action.manualOnly && !string.Equals(intent.source, "user", StringComparison.OrdinalIgnoreCase))
            {
                return Snapshot(action.id, "rejected", "该动作只允许用户手动控制");
            }

            var operation = intent.operation ?? string.Empty;
            if (!action.toggle)
            {
                if (!string.Equals(operation, "trigger", StringComparison.OrdinalIgnoreCase))
                {
                    return Snapshot(action.id, "rejected", "一次性动作只接受 trigger 操作");
                }
                if (!TryValidateRequirements(action, out var missingRequirement))
                {
                    return Snapshot(action.id, "rejected", $"需先开启 {missingRequirement}");
                }
                return Trigger(action, intent.priority);
            }

            if (string.Equals(operation, "activate", StringComparison.OrdinalIgnoreCase))
            {
                if (activeActions.Contains(action.id))
                {
                    return Snapshot(action.id, "active", null);
                }
                if (!TryValidateRequirements(action, out var missingRequirement))
                {
                    return Snapshot(action.id, "rejected", $"需先开启 {missingRequirement}");
                }
                var exclusiveAction = FindActiveExclusiveAction(action);
                if (exclusiveAction != null)
                {
                    return Snapshot(action.id, "rejected", $"请先关闭互斥动作 {exclusiveAction.label}");
                }
                if (!TryApplyToggle(action, true, out var error))
                {
                    return Snapshot(action.id, "rejected", error);
                }
                activeActions.Add(action.id);
                SavePersistedState();
                return Snapshot(action.id, "active", null);
            }

            if (string.Equals(operation, "deactivate", StringComparison.OrdinalIgnoreCase))
            {
                var dependent = manifest.All.FirstOrDefault(candidate =>
                    activeActions.Contains(candidate.id)
                    && (candidate.requires ?? Array.Empty<string>()).Any(requirement =>
                        string.Equals(requirement, action.id, StringComparison.OrdinalIgnoreCase)));
                if (dependent != null)
                {
                    return Snapshot(action.id, "rejected", $"请先关闭 {dependent.label}");
                }
                if (!activeActions.Contains(action.id))
                {
                    return Snapshot(action.id, "inactive", null);
                }
                if (!TryApplyToggle(action, false, out var error))
                {
                    return Snapshot(action.id, "rejected", error);
                }
                activeActions.Remove(action.id);
                SavePersistedState();
                return Snapshot(action.id, "inactive", null);
            }

            return Snapshot(action.id, "rejected", "保持动作必须明确 activate 或 deactivate");
        }

        public AvatarActionStatePayload Snapshot(string actionId = null, string state = null, string message = null)
        {
            return new AvatarActionStatePayload
            {
                action_id = actionId,
                state = state,
                active_action_ids = activeActions.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(),
                message = message,
            };
        }

        private bool TryValidateRequirements(AvatarActionDefinition action, out string missingRequirement)
        {
            missingRequirement = null;
            foreach (var requirement in action.requires ?? Array.Empty<string>())
            {
                if (!activeActions.Contains(requirement))
                {
                    missingRequirement = manifest.TryResolve(requirement, out var definition)
                        ? definition.label
                        : requirement;
                    return false;
                }
            }
            return true;
        }

        private AvatarActionDefinition FindActiveExclusiveAction(AvatarActionDefinition action)
        {
            if (string.IsNullOrWhiteSpace(action.exclusiveGroup))
            {
                return null;
            }
            return manifest.All.FirstOrDefault(candidate =>
                !string.Equals(candidate.id, action.id, StringComparison.OrdinalIgnoreCase)
                && activeActions.Contains(candidate.id)
                && !string.IsNullOrWhiteSpace(candidate.exclusiveGroup)
                && string.Equals(candidate.exclusiveGroup, action.exclusiveGroup, StringComparison.OrdinalIgnoreCase));
        }

        private AvatarActionStatePayload Trigger(AvatarActionDefinition action, int priority)
        {
            if (string.Equals(action.targetKind, "expression", StringComparison.OrdinalIgnoreCase))
            {
                if (!driver.TryTriggerExpression(action.targetId, out var error))
                {
                    return Snapshot(action.id, "rejected", error);
                }
                return Snapshot(action.id, "completed", null);
            }
            if (string.Equals(action.targetKind, "motion", StringComparison.OrdinalIgnoreCase))
            {
                if (!driver.TryPlayMotion(action.targetId, false, priority, out var error))
                {
                    return Snapshot(action.id, "rejected", error);
                }
                return Snapshot(action.id, "running", null);
            }
            return Snapshot(action.id, "rejected", $"不支持动作目标类型 {action.targetKind}");
        }

        private bool TryApplyToggle(AvatarActionDefinition action, bool active, out string error)
        {
            error = null;
            if (string.Equals(action.targetKind, "expression", StringComparison.OrdinalIgnoreCase))
            {
                return driver.TrySetActionExpression(action.id, action.targetId, active, out error);
            }
            error = $"保持动作不支持目标类型 {action.targetKind}";
            return false;
        }

        private void RestorePersistedState()
        {
            if (driver == null)
            {
                return;
            }

            var document = LoadPersistedState();
            if (document?.active_action_ids == null || document.active_action_ids.Length == 0)
            {
                return;
            }

            var wanted = new HashSet<string>(
                document.active_action_ids.Where(value => !string.IsNullOrWhiteSpace(value)),
                StringComparer.OrdinalIgnoreCase);
            foreach (var action in manifest.All)
            {
                if (!action.toggle || !wanted.Contains(action.id))
                {
                    continue;
                }
                if (!TryValidateRequirements(action, out _) || FindActiveExclusiveAction(action) != null)
                {
                    continue;
                }
                if (TryApplyToggle(action, true, out _))
                {
                    activeActions.Add(action.id);
                }
            }
        }

        private AvatarActionStateDocument LoadPersistedState()
        {
            try
            {
                var path = ResolveStatePath();
                return File.Exists(path)
                    ? JsonUtility.FromJson<AvatarActionStateDocument>(File.ReadAllText(path))
                    : null;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 读取动作状态失败: {ex.Message}");
                return null;
            }
        }

        private void SavePersistedState()
        {
            try
            {
                var path = ResolveStatePath();
                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                File.WriteAllText(path, JsonUtility.ToJson(new AvatarActionStateDocument
                {
                    active_action_ids = activeActions
                        .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                        .ToArray(),
                }, true));
            }
            catch (Exception ex)
            {
                // 当前动作不能因偏好写盘失败而中断，但必须留下可诊断证据。
                Debug.LogWarning($"[UnityAvatarHost] 保存动作状态失败: {ex.Message}");
            }
        }

        private static string ResolveStatePath()
        {
            var configured = Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_ACTION_STATE_PATH");
            return string.IsNullOrWhiteSpace(configured)
                ? Path.Combine(Application.persistentDataPath, "avatar-action-state.json")
                : configured;
        }

        [Serializable]
        private sealed class AvatarActionStateDocument
        {
            public string[] active_action_ids;
        }
    }
}
