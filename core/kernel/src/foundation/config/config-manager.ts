import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { ErrorCode, EXTENSION_ID_PATTERN, EXTENSION_VERSION_PATTERN } from '@glimmer-cradle/protocol';
import type { KnowledgeBaseConfig, KnowledgeIndexConfig } from '@glimmer-cradle/protocol';
import { CoreException } from '../exceptions';
import { getLogger } from '../logger/logger';
import { resolveConfigDir, resolveConfigPath } from '../utils/path-utils';
import { GlobalConfig } from './config-schema';
import { validateConfig, normalizeSystemYamlNulls, type ConfigSchemaName } from '@glimmer-cradle/protocol';
import type { ActiveExtensionSelection } from '../ports';

const logger = getLogger('config-manager');

interface ExtensionConfigSchemaLike {
  safeParse(input: unknown): {
    success: boolean;
    data?: unknown;
  };
}

interface ProviderConfig {
  api_key?: string;
  models?: Record<string, string>;
}

interface LLMConfigLike {
  default_route?: {
    provider?: string;
    model_alias?: string;
  };
  api_type?: string;
  api_key?: string;
  providers?: Record<string, ProviderConfig>;
}

interface ActiveCharacterConfigLike {
  active_id?: string;
  profile_root?: string;
}

interface AudioSecretsLike {
  audio?: {
    dashscope?: {
      api_key?: string;
    };
  };
}

export class ConfigManager {
  private static _instance: ConfigManager | null = null;

  private _config: GlobalConfig | null = null;
  private _configDir = resolveConfigDir();
  private _isInitialized = false;
  private _isFrozen = false;

  public static get instance(): ConfigManager {
    if (!ConfigManager._instance) {
      ConfigManager._instance = new ConfigManager();
    }
    return ConfigManager._instance;
  }

  private constructor() {}

  public async init(): Promise<void> {
    if (this._isInitialized) {
      logger.warn('配置管理器已初始化，跳过重复初始化');
      return;
    }

    logger.info('开始初始化配置管理器', { config_dir: this._configDir });

    if (!(await fs.pathExists(this._configDir))) {
      throw new CoreException(`配置目录不存在: ${this._configDir}`, ErrorCode.CONFIG_ERROR);
    }

    try {
      // 阶段 P.4b：ajv 校验 + 填默认值（原地修改 data）
      // 1. YAML null 归一（observability.module_levels 等）
      const systemData = await this.loadSystemConfigData();
      normalizeSystemYamlNulls(systemData);

      // 2. configs/system/*.yaml 分段校验：AppConfig（identity/character/backup）+ Kernel 子块
      const appConfigData: Record<string, unknown> = {
        identity: systemData.identity,
        backup: systemData.backup,
        character: systemData.character,
      };
      this.validateSection('AppConfig', appConfigData);
      systemData.identity = appConfigData.identity;
      systemData.backup = appConfigData.backup;
      systemData.character = appConfigData.character;

      const activeCharacter = this.resolveActiveCharacter(systemData.character);
      await this.assertActiveCharacterPackage(activeCharacter);
      const characterData = await this.loadCharacterConfigData(activeCharacter);

      if (characterData.llm && typeof characterData.llm === 'object') {
        await this.injectLLMApiKeysFromSecrets(characterData.llm as LLMConfigLike);
      }
      const SYSTEM_SUB_SECTIONS: Array<[keyof typeof systemData, ConfigSchemaName]> = [
        ['ipc', 'IPCConfig'],
        ['lifecycle', 'LifecycleConfig'],
        ['extensions', 'ExtensionConfig'],
        ['avatar', 'AvatarConfig'],
        ['surfaces', 'SurfaceConfig'],
        ['skill_plane', 'SkillPlaneConfig'],
        ['ingress', 'IngressGateConfig'],
        ['memory', 'MemoryConfig'],
        ['observability', 'ObservabilityConfig'],
        ['audio', 'AudioConfig'],
        ['embedding', 'EmbeddingConfig'],
      ];
      for (const [key, schemaName] of SYSTEM_SUB_SECTIONS) {
        // YAML 中缺省子块 → 给空对象让 ajv 用默认值填满
        if (systemData[key] === undefined || systemData[key] === null) {
          systemData[key] = {};
        }
        this.validateSection(schemaName, systemData[key]);
      }

      // 3. character package 分段校验：manifest / profile / dialogue / safety / inference / llm
      if (characterData.manifest === undefined) characterData.manifest = {};
      this.validateSection('CharacterManifestConfig', characterData.manifest);
      if (characterData.profile === undefined) characterData.profile = {};
      this.validateSection('CharacterProfileConfig', characterData.profile);
      if (characterData.dialogue === undefined) characterData.dialogue = {};
      this.validateSection('DialoguePolicyConfig', characterData.dialogue);
      if (characterData.safety === undefined) characterData.safety = {};
      this.validateSection('SafetyConfig', characterData.safety);
      if (characterData.inference === undefined) characterData.inference = {};
      this.validateSection('InferenceConfig', characterData.inference);
      if (characterData.voice === undefined) characterData.voice = {};
      this.validateSection('VoiceConfig', characterData.voice);
      if (characterData.llm !== undefined && characterData.llm !== null) {
        this.validateSection('LLMConfig', characterData.llm);
      }

      this._config = {
        system: systemData as unknown as GlobalConfig['system'],
        character: characterData as unknown as GlobalConfig['character'],
      };
      this._isInitialized = true;

      logger.info('配置管理器初始化完成', {
        app_name: this._config.system.identity.app_name,
        app_version: this._config.system.identity.app_version,
        active_character: activeCharacter.id,
      });
    } catch (error) {
      logger.error('配置管理器初始化失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public getConfig(): Readonly<GlobalConfig> {
    if (!this._isInitialized || !this._config) {
      throw new CoreException('配置管理器未初始化', ErrorCode.CONFIG_ERROR);
    }
    return Object.freeze(this._config);
  }

  public freezeCoreConfig(): void {
    if (this._isFrozen) {
      return;
    }
    if (!this._config) {
      throw new CoreException('配置尚未加载，无法冻结', ErrorCode.CONFIG_ERROR);
    }

    Object.freeze(this._config.character);
    Object.freeze(this._config.character.manifest);
    Object.freeze(this._config.character.profile);
    Object.freeze(this._config.character.dialogue);
    Object.freeze(this._config.character.safety);
    Object.freeze(this._config.character.inference);
    Object.freeze(this._config.character.voice);
    this._isFrozen = true;

    logger.info('核心配置已冻结，运行时不再允许修改');
  }

  public async reloadConfig(): Promise<void> {
    logger.info('开始重载配置文件');
    const backup = this._config;
    const wasFrozen = this._isFrozen;

    this._config = null;
    this._isInitialized = false;
    this._isFrozen = false;

    try {
      await this.init();
      if (wasFrozen) {
        this.freezeCoreConfig();
      }
      logger.info('配置重载完成');
    } catch (error) {
      this._config = backup;
      this._isInitialized = backup !== null;
      this._isFrozen = wasFrozen;
      logger.error('配置重载失败，已回滚到旧配置', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async loadKnowledgeBaseConfig(): Promise<KnowledgeBaseConfig> {
    const activeCharacter = this.getLoadedActiveCharacter();
    const characterRoot = path.join(activeCharacter.root, activeCharacter.id);
    const knowledgeRoot = path.resolve(this._configDir, characterRoot, 'knowledge');
    const raw = await this.loadYaml(path.join(characterRoot, 'knowledge', 'index.yaml'));
    const indexResult = validateConfig<KnowledgeIndexConfig>('KnowledgeIndexConfig', raw);
    if (!indexResult.ok) {
      throw new CoreException(
        `知识索引配置校验失败: ${indexResult.errors.join('; ')}`,
        ErrorCode.CONFIG_ERROR,
      );
    }

    const index = indexResult.data!;
    const entries = [];
    for (const entry of index.entries) {
      if (entry.enabled === false) {
        continue;
      }
      const filePath = path.resolve(knowledgeRoot, entry.file);
      if (filePath !== knowledgeRoot && !filePath.startsWith(`${knowledgeRoot}${path.sep}`)) {
        throw new CoreException(
          `知识条目路径越界: ${entry.file}`,
          ErrorCode.CONFIG_ERROR,
        );
      }
      const content = await fs.readFile(filePath, 'utf-8');
      entries.push({
        entry_id: entry.entry_id,
        scope: 'knowledge' as const,
        content: content.trim(),
        priority: entry.priority,
        enabled: entry.enabled ?? true,
      });
    }

    const knowledgeConfig: KnowledgeBaseConfig = {
      version: index.version,
      retrieval: index.retrieval as KnowledgeBaseConfig['retrieval'],
      entries,
    };
    const result = validateConfig<KnowledgeBaseConfig>('KnowledgeBaseConfig', knowledgeConfig);
    if (!result.ok) {
      throw new CoreException(
        `知识库配置校验失败: ${result.errors.join('; ')}`,
        ErrorCode.CONFIG_ERROR,
      );
    }
    return result.data!;
  }

  /** 单段 ajv 校验帮手 —— 失败抛 CoreException。 */
  private validateSection(name: ConfigSchemaName, data: unknown): void {
    const result = validateConfig(name, data);
    if (!result.ok) {
      throw new CoreException(
        `配置校验失败 [${name}]: ${result.errors.join('; ')}`,
        ErrorCode.CONFIG_ERROR,
      );
    }
  }

  public async loadActiveExtensions(): Promise<ActiveExtensionSelection[]> {
    try {
      const filePath = resolveConfigPath(path.join('extensions', 'active.yaml'));
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = yaml.parse(content) as { active?: unknown } | null;
      if (!Array.isArray(parsed?.active)) {
        throw new CoreException('extensions/active.yaml 必须声明 active 数组', ErrorCode.CONFIG_ERROR);
      }
      const selections = parsed.active.map((item, index): ActiveExtensionSelection => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new CoreException(`extensions.active[${index}] 必须是对象`, ErrorCode.CONFIG_ERROR);
        }
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const version = typeof record.version === 'string' ? record.version.trim() : '';
        const profile = typeof record.profile === 'string' ? record.profile.trim() : '';
        if (!EXTENSION_ID_PATTERN.test(id) || !EXTENSION_VERSION_PATTERN.test(version) || !profile) {
          throw new CoreException(`extensions.active[${index}] 的 id/version/profile 非法`, ErrorCode.CONFIG_ERROR);
        }
        return { id, version, profile };
      });
      const ids = new Set<string>();
      for (const selection of selections) {
        if (ids.has(selection.id)) {
          throw new CoreException(`扩展激活配置重复: ${selection.id}`, ErrorCode.CONFIG_ERROR);
        }
        ids.add(selection.id);
      }
      return selections;
    } catch (error) {
      logger.error('启用扩展列表加载失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async saveActiveExtensions(selections: ActiveExtensionSelection[]): Promise<void> {
    const normalized = selections
      .map(({ id, version, profile }) => ({ id: id.trim(), version: version.trim(), profile: profile.trim() }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const ids = new Set<string>();
    for (const selection of normalized) {
      if (!EXTENSION_ID_PATTERN.test(selection.id) || !EXTENSION_VERSION_PATTERN.test(selection.version) || !selection.profile) {
        throw new CoreException(`扩展激活选择非法: ${selection.id}@${selection.version}#${selection.profile}`, ErrorCode.CONFIG_ERROR);
      }
      if (ids.has(selection.id)) {
        throw new CoreException(`扩展激活配置重复: ${selection.id}`, ErrorCode.CONFIG_ERROR);
      }
      ids.add(selection.id);
    }

    const filePath = resolveConfigPath(path.join('extensions', 'active.yaml'));
    const temporaryPath = `${filePath}.tmp`;
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(temporaryPath, yaml.stringify({ active: normalized }), 'utf8');
    await fs.move(temporaryPath, filePath, { overwrite: true });
  }

  public async generateExtensionDefaults(
    extensionId: string,
    schema: ExtensionConfigSchemaLike,
  ): Promise<boolean> {
    const filePath = resolveConfigPath(path.join('extensions', `${extensionId}.yaml`));
    await fs.ensureDir(path.dirname(filePath));

    if (await fs.pathExists(filePath)) {
      return false;
    }

    try {
      const result = schema.safeParse({});
      if (!result.success || result.data == null) {
        logger.warn('扩展默认配置生成失败，schema 可能包含必填字段', {
          extension_id: extensionId,
        });
        return false;
      }

      const header = [
        `# ${extensionId} extension config`,
        '# Auto-generated by ConfigManager.',
        '',
      ].join('\n');

      await fs.writeFile(filePath, header + yaml.stringify(result.data, { indent: 2 }), 'utf-8');
      logger.info('已为扩展生成默认配置', {
        extension_id: extensionId,
        file: filePath,
      });
      return true;
    } catch (error) {
      logger.warn('扩展默认配置生成失败', {
        extension_id: extensionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async loadYaml(relativePath: string): Promise<Record<string, unknown>> {
    const filePath = resolveConfigPath(relativePath);
    logger.debug('加载 YAML 配置文件', { file_path: filePath });

    if (!(await fs.pathExists(filePath))) {
      throw new CoreException(`配置文件不存在: ${filePath}`, ErrorCode.CONFIG_ERROR);
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return (yaml.parse(content) ?? {}) as Record<string, unknown>;
    } catch (error) {
      throw new CoreException(
        `配置文件解析失败: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.CONFIG_ERROR,
      );
    }
  }

  /** 把 DashScope 密钥投影为受管能力子进程环境；返回值不得进入日志。 */
  public async loadDashScopeSecretEnvironment(): Promise<Record<string, string>> {
    if (process.env.DASHSCOPE_API_KEY?.trim()) {
      return {};
    }
    const secretsPath = resolveConfigPath(path.join('secrets', 'secrets.yaml'));
    if (!(await fs.pathExists(secretsPath))) {
      return {};
    }
    try {
      const content = await fs.readFile(secretsPath, 'utf-8');
      const secrets = yaml.parse(content) as (
        AudioSecretsLike & { providers?: Record<string, ProviderConfig> }
      ) | null;
      const apiKey = (
        secrets?.providers?.dashscope?.api_key
        || secrets?.providers?.qwen?.api_key
        || secrets?.audio?.dashscope?.api_key
      )?.trim();
      return apiKey ? { DASHSCOPE_API_KEY: apiKey } : {};
    } catch (error) {
      logger.warn('读取 DashScope secrets 失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  private async loadSystemConfigData(): Promise<Record<string, unknown>> {
    const identityData = await this.loadYaml(path.join('system', 'identity.yaml'));
    const kernelData = await this.loadYaml(path.join('system', 'kernel.yaml'));
    const avatarData = await this.loadYaml(path.join('system', 'avatar.yaml'));
    const surfacesData = await this.loadYaml(path.join('system', 'surfaces.yaml'));
    const skillsData = await this.loadYaml(path.join('system', 'skills.yaml'));
    const memoryData = await this.loadYaml(path.join('system', 'memory.yaml'));
    const observabilityData = await this.loadYaml(path.join('system', 'observability.yaml'));
    const audioData = await this.loadYaml(path.join('system', 'audio.yaml'));
    const embeddingData = await this.loadYaml(path.join('system', 'embedding.yaml'));

    return {
      ...identityData,
      ipc: kernelData.ipc,
      lifecycle: kernelData.lifecycle,
      ingress: kernelData.ingress,
      avatar: avatarData,
      surfaces: surfacesData,
      skill_plane: skillsData,
      memory: memoryData,
      observability: observabilityData,
      audio: audioData,
      embedding: embeddingData,
    };
  }

  private async loadCharacterConfigData(
    character: { id: string; root: string },
  ): Promise<Record<string, unknown>> {
    const characterRoot = path.join(character.root, character.id);
    return {
      manifest: await this.loadYaml(path.join(characterRoot, 'character.manifest.yaml')),
      profile: await this.loadYaml(path.join(characterRoot, 'profile.yaml')),
      dialogue: await this.loadYaml(path.join(characterRoot, 'dialogue.yaml')),
      safety: await this.loadYaml(path.join(characterRoot, 'safety.yaml')),
      inference: await this.loadYaml(path.join(characterRoot, 'inference.yaml')),
      voice: await this.loadYaml(path.join(characterRoot, 'voice.yaml')),
      llm: await this.loadYaml(path.join(characterRoot, 'providers.yaml')),
    };
  }

  private resolveActiveCharacter(raw: unknown): { id: string; root: string } {
    const value = (raw && typeof raw === 'object' ? raw : {}) as ActiveCharacterConfigLike;
    if (typeof value.active_id !== 'string' || typeof value.profile_root !== 'string') {
      throw new CoreException(
        '当前角色选择不完整：character.active_id 与 character.profile_root 必须显式配置',
        ErrorCode.CONFIG_ERROR,
      );
    }
    return {
      id: value.active_id,
      root: value.profile_root,
    };
  }

  private getLoadedActiveCharacter(): { id: string; root: string } {
    if (!this._config) {
      throw new CoreException('配置管理器未初始化，无法解析当前角色', ErrorCode.CONFIG_ERROR);
    }
    return this.resolveActiveCharacter(this._config.system.character);
  }

  private async assertActiveCharacterPackage(character: { id: string; root: string }): Promise<void> {
    const requiredFiles = [
      'character.manifest.yaml',
      'profile.yaml',
      'dialogue.yaml',
      'safety.yaml',
      'inference.yaml',
      'voice.yaml',
      'providers.yaml',
      path.join('knowledge', 'index.yaml'),
    ] as const;

    for (const fileName of requiredFiles) {
      const target = path.join(this._configDir, character.root, character.id, fileName);
      if (await fs.pathExists(target)) {
        continue;
      }
      throw new CoreException(
        `Character Package 不完整，缺少文件: ${path.relative(this._configDir, target)}`,
        ErrorCode.CONFIG_ERROR,
      );
    }
  }

  private async injectLLMApiKeysFromSecrets(llmConfig: LLMConfigLike): Promise<void> {
    const secretsPath = resolveConfigPath(path.join('secrets', 'secrets.yaml'));
    if (!(await fs.pathExists(secretsPath))) {
      return;
    }

    try {
      const content = await fs.readFile(secretsPath, 'utf-8');
      const secrets = yaml.parse(content) as { providers?: Record<string, ProviderConfig> } | null;
      const providers = secrets?.providers ?? {};

      if (!llmConfig.api_key) {
        const routeProvider = typeof llmConfig.default_route?.provider === 'string'
          ? llmConfig.default_route.provider.toLowerCase()
          : '';
        const fallbackProvider = String(llmConfig.api_type ?? 'deepseek').toLowerCase();
        for (const providerName of [routeProvider, fallbackProvider]) {
          if (!providerName) continue;
          const provider = providers[providerName];
          if (!provider?.api_key) continue;
          llmConfig.api_key = provider.api_key;
          logger.info('已从 secrets.yaml 注入默认 LLM API Key', { provider: providerName });
          break;
        }
      }

      if (!llmConfig.providers) {
        return;
      }

      for (const [providerName, providerConfig] of Object.entries(llmConfig.providers)) {
        if (providerConfig.api_key) {
          continue;
        }

        const secret = providers[providerName.toLowerCase()];
        if (secret?.api_key) {
          providerConfig.api_key = secret.api_key;
          logger.info('已注入 provider API Key', { provider: providerName });
        }
      }
    } catch (error) {
      logger.warn('读取 secrets.yaml 失败，继续使用显式配置', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
