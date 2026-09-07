import { useEffect, useState } from 'react';
import type { ConfigurationDraftState } from './configuration-state';
import styles from './Configuration.module.css';

type Kind = 'text' | 'number' | 'checkbox' | 'csv' | 'lines' | 'env-lines';
type Field = readonly [path: string, label: string, kind?: Kind, fallback?: unknown, choices?: readonly (string | number)[]];
export const audioFields: readonly Field[] = [
  ['audio.tts.enabled', '启用语音合成', 'checkbox'], ['audio.asr.enabled', '启用语音识别', 'checkbox'],
  ['audio.tts.route.primary', 'TTS 主路由'], ['audio.tts.route.fallbacks', 'Fallbacks（逗号分隔）', 'csv'],
  ['audio.tts.route.circuit_breaker.failure_threshold', '失败阈值', 'number', 3], ['audio.tts.route.circuit_breaker.recovery_timeout_ms', '恢复时间（ms）', 'number', 30000],
  ['audio.tts.cache.enabled', '启用音频缓存', 'checkbox'], ['audio.tts.cache.max_age_days', '缓存保留天数', 'number', 30],
  ['audio.tts.providers.dashscope-cosyvoice.enabled', '启用 dashscope-cosyvoice', 'checkbox'], ['audio.asr.resource_id', 'ASR 资源'],
  ['audio.tts.providers.dashscope-cosyvoice.endpoint', 'TTS Endpoint'], ['audio.tts.providers.dashscope-cosyvoice.model', 'TTS 模型'],
  ['audio.tts.providers.dashscope-cosyvoice.sample_rate', '采样率', 'number', 24000, [8000, 16000, 22050, 24000, 44100, 48000]],
  ['audio.tts.providers.dashscope-cosyvoice.connect_timeout_ms', '连接超时（ms）', 'number', 5000], ['audio.tts.providers.dashscope-cosyvoice.receive_timeout_ms', '接收超时（ms）', 'number', 20000], ['audio.tts.providers.dashscope-cosyvoice.max_retries', '最大重试', 'number', 1],
];
export const embeddingFields: readonly Field[] = [
  ['embedding.enabled', '启用向量增强', 'checkbox'], ['embedding.route.provider', '默认路由', 'text', '', ['dashscope-text-embedding', 'local-sentence-transformers']],
  ['embedding.providers.dashscope-text-embedding.endpoint', 'DashScope Endpoint'], ['embedding.providers.dashscope-text-embedding.model', 'DashScope 模型'],
  ['embedding.providers.dashscope-text-embedding.dimensions', '向量维度', 'number', 1024, [64, 128, 256, 512, 768, 1024, 1536, 2048]],
  ['embedding.providers.dashscope-text-embedding.request_timeout_ms', '请求超时（ms）', 'number'], ['embedding.providers.dashscope-text-embedding.max_retries', '最大重试', 'number'],
  ['embedding.providers.local-sentence-transformers.model_path', '本地模型目录'], ['embedding.providers.local-sentence-transformers.model_id', '本地模型 ID'], ['embedding.providers.local-sentence-transformers.device', 'Device'],
  ['embedding.providers.local-sentence-transformers.batch_size', 'Batch Size', 'number'], ['embedding.providers.local-sentence-transformers.auto_download', '允许自动下载模型', 'checkbox'],
];
export const memoryFields: readonly Field[] = [
  ['memory.working.max_messages_per_conversation', '工作集上限', 'number', 32], ['memory.working.hydrate_recent_messages', '最近水合条数', 'number', 32], ['memory.working.context_message_limit', '上下文注入上限', 'number', 8],
  ['memory.retrieval.semantic_weight', '语义权重', 'number', 0.35], ['memory.experience.enabled', '启用经历归档', 'checkbox'], ['memory.consolidation.enabled', '启用记忆固化', 'checkbox'],
  ['memory.experience.pack_max_size_mb', 'Pack 上限（MB）', 'number', 256], ['memory.experience.flush_interval_ms', 'Flush 间隔（ms）', 'number', 500], ['memory.retrieval.candidate_limit', '检索候选数', 'number', 24], ['memory.retrieval.result_limit', '检索结果数', 'number', 6], ['memory.conversation.chapter_idle_minutes', '章节空闲分钟', 'number', 360], ['memory.retrieval.token_budget', '结果 token 预算', 'number', 800],
];
export const skillFields: readonly Field[] = [['skills.user_skills.enabled', '启用用户技能目录', 'checkbox'], ['skills.user_skills.root_dir', '根目录', 'text', 'skills']];
export const mcpFields = (index: number): readonly Field[] => [
  ['id', 'ID'], ['transport', 'Transport', 'text', 'stdio', ['stdio', 'http', 'websocket']], ['enabled', '参与 Skill Plane', 'checkbox'], ['products', 'Products（逗号分隔）', 'csv'], ['command', 'Command'], ['capability_prefix', 'Capability Prefix'], ['url', 'URL'], ['args', 'Args（每行一个）', 'lines'], ['env', 'Env（每行 KEY=VALUE）', 'env-lines'], ['timeout_ms', 'Timeout（ms）', 'number', 30000],
].map(row => [`skills.mcp_servers.${index}.${row[0]}`, ...row.slice(1)] as unknown as Field);

function getPath(draft: ConfigurationDraftState, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, draft);
}
export function setConfigurationPath(draft: ConfigurationDraftState, path: string, value: unknown) {
  const keys = path.split('.'); let cursor = draft as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) { cursor[key] ??= {}; cursor = cursor[key] as Record<string, unknown>; }
  cursor[keys[keys.length - 1]] = value;
}
function format(value: unknown, kind: Kind) {
  if (kind === 'csv' || kind === 'lines') return Array.isArray(value) ? value.join(kind === 'csv' ? ', ' : '\n') : '';
  if (kind === 'env-lines') return Object.entries(value && typeof value === 'object' ? value : {}).map(([key, item]) => `${key}=${item}`).join('\n');
  return String(value ?? '');
}
function DraftField({ field: [path, label, kind = 'text', fallback = '', choices], draft, edit }: { field: Field; draft: ConfigurationDraftState; edit: (path: string, value: unknown) => void }) {
  const value = getPath(draft, path) ?? fallback;
  const formatted = format(value, kind);
  const [raw, setRaw] = useState(formatted);
  // 保留用户正在输入的分隔符；服务端新快照和丢弃修改仍同步到字段。
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setRaw(formatted); }, [formatted, focused]);
  const update = (text: string) => {
    setRaw(text);
    let parsed: unknown = text;
    if (kind === 'number') parsed = text.trim() && Number.isFinite(Number(text)) ? Number(text) : text;
    if (kind === 'csv' || kind === 'lines') parsed = text.split(kind === 'csv' ? ',' : /\r?\n/).map(item => item.trim()).filter(Boolean);
    if (kind === 'env-lines') parsed = Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1)]));
    edit(path, parsed);
  };
  return <label className={styles.field}><span>{label}</span>{kind === 'checkbox'
    ? <input type="checkbox" data-path={path} checked={!!value} onChange={event => edit(path, event.target.checked)} />
    : choices ? <select data-path={path} value={String(value)} onChange={event => update(event.target.value)}>{!choices.some(choice => String(choice) === String(value)) && <option value={String(value)}>{String(value) || '未选择'}</option>}{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>
    : kind === 'lines' || kind === 'env-lines' ? <textarea data-path={path} value={raw} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => update(event.target.value)} />
    : <input type={kind === 'number' ? 'number' : 'text'} step="any" data-path={path} value={raw} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => update(event.target.value)} />}</label>;
}
export function ConfigurationFields({ fields, draft, edit }: { fields: readonly Field[]; draft: ConfigurationDraftState; edit: (path: string, value: unknown) => void }) {
  return <div className={styles.fields}>{fields.map(field => <DraftField key={field[0]} field={field} draft={draft} edit={edit} />)}</div>;
}
