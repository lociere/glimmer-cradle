using System;
using System.Collections.Generic;

namespace GlimmerCradle.Avatar
{
    [Serializable]
    public sealed class AvatarActionDefinition
    {
        public string id = "";
        public string label = "";
        public string category = "expression";
        public string targetKind = "expression";
        public string targetId = "";
        public bool toggle;
        public bool manualOnly;
        public string[] requires = Array.Empty<string>();
        public string exclusiveGroup = "";
    }

    [Serializable]
    public sealed class AvatarActionDocument
    {
        public int version = 1;
        public AvatarActionDefinition[] actions = Array.Empty<AvatarActionDefinition>();
    }

    public sealed class AvatarActionManifest
    {
        private readonly Dictionary<string, AvatarActionDefinition> actions =
            new Dictionary<string, AvatarActionDefinition>(StringComparer.OrdinalIgnoreCase);

        public static AvatarActionManifest FromDocument(AvatarActionDocument document)
        {
            var manifest = new AvatarActionManifest();
            foreach (var action in document?.actions ?? Array.Empty<AvatarActionDefinition>())
            {
                if (action == null || string.IsNullOrWhiteSpace(action.id) || string.IsNullOrWhiteSpace(action.targetId))
                {
                    continue;
                }
                manifest.actions[action.id] = action;
            }
            return manifest;
        }

        public bool TryResolve(string actionId, out AvatarActionDefinition action)
        {
            return actions.TryGetValue(actionId ?? "", out action);
        }

        public IEnumerable<AvatarActionDefinition> All => actions.Values;
    }
}
