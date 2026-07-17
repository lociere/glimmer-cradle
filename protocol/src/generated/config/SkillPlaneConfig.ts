/* 自动生成 — 从 SkillPlaneConfig.schema.json 生成，勿手动修改 */

/**
 * 能力来源可运行的产品组合；操作系统与架构由其实际发布方式另行约束。
 */
export type SkillProductTarget = 'any' | 'desktop' | 'personal-server';

/**
 * Skill Plane 配置 —— 外部 MCP Server Provider、用户技能入口与发现策略。
 */
export interface SkillPlaneConfig {
  /**
   * 外部 MCP server 列表。
   */
  mcp_servers: McpServerConfig[];
  user_skills: UserSkillConfig;
}
/**
 * 单个 MCP server 连接声明。
 */
export interface McpServerConfig {
  /**
   * MCP server 唯一 ID。
   */
  id: string;
  /**
   * 是否启用该 MCP server。
   */
  enabled: boolean;
  /**
   * 允许连接该 MCP server 的产品组合。扩展私有 MCP 不在这里声明，由扩展自行持有并按需重导出公开 Skill。
   *
   * @minItems 1
   */
  products: [SkillProductTarget, ...SkillProductTarget[]];
  /**
   * 连接方式。
   */
  transport: 'stdio' | 'http' | 'websocket';
  /**
   * stdio 模式下的启动命令。
   */
  command?: string;
  /**
   * stdio 模式下传给 command 的参数。
   */
  args: string[];
  /**
   * Streamable HTTP / websocket 模式下的服务地址。
   */
  url?: string;
  /**
   * 传给 MCP server 的环境变量。敏感值应通过 secrets 或系统环境变量注入。
   */
  env: {
    [k: string]: string;
  };
  /**
   * 映射到 Skill ID 时使用的能力前缀；缺省使用 server id。
   */
  capability_prefix?: string;
  /**
   * 连接与调用超时（ms）。
   */
  timeout_ms: number;
}
/**
 * 用户自定义技能 Provider 配置。
 */
export interface UserSkillConfig {
  /**
   * 是否启用用户技能 Provider。
   */
  enabled: boolean;
  /**
   * 用户技能根目录（相对项目根或用户数据目录）。
   */
  root_dir: string;
}
