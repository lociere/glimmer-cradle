import { getLogger } from "../../foundation/logger/logger";
import { PerceptionEvent } from "@glimmer-cradle/protocol";

const logger = getLogger("channel-state");

export interface ChannelStateSnapshot {
  source: string;
  firstSeenAt: number;
  lastSeenAt: number;
  messageCount: number;
  lastTraceId: string;
  lastSensoryType: PerceptionEvent['sensoryType'];
  lastAddressMode: string;
  lastFamiliarity: number;
  lastTextPreview: string | null;
}

interface ChannelState extends ChannelStateSnapshot {}

export class ChannelStateStore {
  private static _instance: ChannelStateStore | null = null;
  private readonly _channels = new Map<string, ChannelState>();
  
  private constructor() {}

  public static get instance(): ChannelStateStore {
    if (!this._instance) {
      this._instance = new ChannelStateStore();
    }
    return this._instance;
  }

  public async handleInboundMessage(req: PerceptionEvent): Promise<ChannelStateSnapshot> {
    const now = Date.now();
    const existing = this._channels.get(req.source);
    const nextState: ChannelState = {
      source: req.source,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      messageCount: (existing?.messageCount ?? 0) + 1,
      lastTraceId: req.id,
      lastSensoryType: req.sensoryType,
      lastAddressMode: req.address_mode,
      lastFamiliarity: req.familiarity,
      lastTextPreview: req.content.text?.slice(0, 120) ?? null,
    };

    this._channels.set(req.source, nextState);

    logger.debug("通道状态已更新", {
      source: nextState.source,
      message_count: nextState.messageCount,
      last_trace_id: nextState.lastTraceId,
      last_sensory_type: nextState.lastSensoryType,
    });

    return { ...nextState };
  }

  public getSnapshot(source: string): ChannelStateSnapshot | null {
    const state = this._channels.get(source);
    return state ? { ...state } : null;
  }

  public listSnapshots(): ChannelStateSnapshot[] {
    return Array.from(this._channels.values()).map((state) => ({ ...state }));
  }
}
