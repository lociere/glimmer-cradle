import type { TurnSnapshot } from './turn-snapshot.js';

/** Host 只消费 Python Conversation 的确认结果，不自行推定持久 Turn 已提交。 */
export interface TurnSnapshotStorePort {
  load(turnId: string): Promise<TurnSnapshot | null>;
}

