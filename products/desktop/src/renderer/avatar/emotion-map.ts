/**
 * EmotionMap —— 单个形象模型的情绪到表情 / 动作 / 口型映射。
 *
 * 运行时从模型注册表声明的 emotionMapPath 读取。
 * 数据结构由 `assets/avatar/emotion-map.schema.json` 约束。
 *
 * 新增模型只需要加入源资产并登记路径，再由资产同步脚本生成 renderer 投影。
 */
import type { AvatarLive2DAvatarPackage } from './avatar-package-catalog';
import { resolvePublicAssetUrl } from './public-assets';

export interface EmotionMap {
  model: string;
  expressions: Record<string, string | null>;
  motions: Record<string, string>;
  mouth?: {
    param_id: string;
    intensity_scale: number;
  };
}

export interface ResolvedEmotionMap {
  /** 应用情绪并返回 expression id；null 表示不切换表情。 */
  expression(emotion: string): string | null;
  /** 应用情绪并返回 motion group；缺省为 idle。 */
  motion(emotion: string): string;
  /** Cubism 嘴部开合参数；模型没有口型目标时为 null。 */
  mouth: { paramId: string; intensityScale: number } | null;
}

/**
 * 安全兜底映射：emotion-map 缺失或加载失败时使用。
 *
 * 所有情绪都落到 idle / 无 expression，避免模型还能显示却不断刷错误。
 */
const FALLBACK_MAP: ResolvedEmotionMap = {
  expression: () => null,
  motion: () => 'idle',
  mouth: { paramId: 'ParamMouthOpenY', intensityScale: 0.3 },
};

export function resolveFallback(): ResolvedEmotionMap {
  return FALLBACK_MAP;
}

export function compileEmotionMap(raw: EmotionMap): ResolvedEmotionMap {
  return {
    expression: (emotion) => raw.expressions[emotion] ?? null,
    motion: (emotion) => raw.motions[emotion] ?? 'idle',
    mouth: raw.mouth
      ? { paramId: raw.mouth.param_id, intensityScale: raw.mouth.intensity_scale }
      : null,
  };
}

export async function loadEmotionMap(model: AvatarLive2DAvatarPackage): Promise<ResolvedEmotionMap> {
  if (!model.emotionMapPath) {
    return FALLBACK_MAP;
  }

  try {
    const res = await fetch(
      resolvePublicAssetUrl(model.emotionMapPath),
      { cache: 'no-cache' },
    );
    if (!res.ok) {
      console.warn(`[emotion-map] ${model.id}: HTTP ${res.status} — using fallback`);
      return FALLBACK_MAP;
    }
    const raw = (await res.json()) as EmotionMap;
    if (raw.model !== model.id) {
      console.warn(`[emotion-map] ${model.id}: file declares model="${raw.model}" — using anyway`);
    }
    return compileEmotionMap(raw);
  } catch (err) {
    console.warn(`[emotion-map] ${model.id}: load failed — using fallback`, err);
    return FALLBACK_MAP;
  }
}
