export type SkillProductTarget = 'any' | 'desktop' | 'personal-server';
export interface SkillPlaneConfig { mcp_servers: McpServerConfig[]; user_skills: UserSkillConfig; }
export interface McpServerConfig { id: string; enabled: boolean; products: [SkillProductTarget, ...SkillProductTarget[]]; transport: 'stdio' | 'http' | 'websocket'; command?: string; args: string[]; url?: string; env: Record<string, string>; capability_prefix?: string; timeout_ms: number; }
export interface UserSkillConfig { enabled: boolean; root_dir: string; }
