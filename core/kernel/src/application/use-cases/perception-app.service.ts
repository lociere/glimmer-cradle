import {
  ConversationDirectory,
  InteractionController,
  type InteractionInput,
} from '@glimmer-cradle/conversation';

import type { AudioApplicationPort, AudioStatusSnapshot } from '../../ports/runtime-capabilities.port';

import { ChannelStateStore } from "../channel/channel-state-store";

import type { Logger as KernelLoggerPort } from '@glimmer-cradle/platform/observability';

import type {
  ASRRecognizeRequest,
  ASRRecognizeResponse,
  PerceptionEvent,
  TTSSynthesizeRequest,
  TTSSynthesizeResponse,
} from '../../ports/application-models';
import { AttentionSessionManager } from "../../application/attention/attention-session-manager";

import { IngressGateManager } from "../../application/ingress/ingress-gate-manager";



export class PerceptionAppService {

  private readonly interactions: InteractionController<PerceptionEvent>;

  constructor(

    private conversationDirectory: ConversationDirectory,

    private audioService: AudioApplicationPort,

    private channelStateStore: ChannelStateStore,

    private attentionMgr: AttentionSessionManager,
    private ingressGate: IngressGateManager,
    private logger: KernelLoggerPort,
    private readonly digestContent?: (content: string) => string,
  ) {
    this.interactions = new InteractionController({
      process: async (input: InteractionInput<PerceptionEvent>, generation, signal) => {
        signal.throwIfAborted();
        const channelState = await this.channelStateStore.handleInboundMessage(input.payload);
        this.logger.debug('通道状态刷新完成', {
          source: channelState.source,
          message_count: channelState.messageCount,
          last_trace_id: channelState.lastTraceId,
        });
        signal.throwIfAborted();
        await this.attentionMgr.ingest(input.payload);
        signal.throwIfAborted();
        return {
          turn_id: input.conversation.interaction_id,
          generation,
          status: 'accepted',
        };
      },
    });
  }



  public async processIngress(event: PerceptionEvent): Promise<void> {

    // ── 入站防护（速率限制 / 熔断 / 就绪守卫）──

    const gate = this.ingressGate;

    const gateResult = gate.admit(event.source);

    if (!gateResult.admitted) {

      this.logger.debug('感知输入被入站防护拒绝', {

        trace_id: event.id,

        source: event.source,

        rejection: gateResult.rejection?.type,

      });
      throw new Error(`感知输入被入站防护拒绝: ${gateResult.rejection?.type ?? 'unknown'}`);

    }



    const contentText = String(event.content?.text || '');

    const modality = event.content?.modality ?? ['text'];

    const familiarity = event.familiarity ?? 0;

    const addressMode = event.address_mode ?? 'direct';
    const responsePolicy = event.response_policy ?? 'reply_allowed';

    const items = event.content?.items ?? undefined;
    const actorId = event.content?.actor_id ?? undefined;
    const actorName = event.content?.actor_name ?? undefined;



    // ── 统一感知入口日志（所有外部输入的唯一可见点）──

    this.logger.info('感知输入', {

      trace_id: event.id,

      source: event.source,

      sensory_type: event.sensoryType,

      modality,

      familiarity,
      address_mode: addressMode,
      response_policy: responsePolicy,

      content_preview: contentText.slice(0, 100) || '[非文本]',

    });



    const request: PerceptionEvent = {
      ...event,
      familiarity,
      address_mode: addressMode,
      response_policy: responsePolicy,
      content: {
        ...event.content,
        text: contentText || undefined,
        modality,
        actor_id: actorId || undefined,
        actor_name: actorName || undefined,
        items,
      },
    };

    try {

      const payloadDigest = event.origin.content_hash?.trim()
        || this.digestContent?.(JSON.stringify(request))
        || request.id;
      const admission = await this.interactions.accept({
        input_id: request.id,
        deduplication_key: `${event.origin.provider_id}:${event.origin.source_event_id}`,
        payload_digest: payloadDigest,
        conversation: request.conversation,
        received_at: new Date(request.timestamp).toISOString(),
        payload: request,
      });
      if (!admission.accepted) {
        throw new Error(`Interaction 接纳失败: ${admission.reason ?? 'unknown'}`);
      }

      gate.complete(true);

      // 回复唯一出口是 Cognition Loop 的 Act → ActionCommand。
      // PERCEPTION_MESSAGE RPC 在这里仅表示投递成功。

    } catch (e) {

      gate.complete(false);

      this.logger.error('感知处理失败', {

        trace_id: event.id,

        source: event.source,

        error: e instanceof Error ? e.message : String(e),

        stack: e instanceof Error ? e.stack : undefined,

      });
      throw e;

    }

  }



  public getConversationDirectory(): ConversationDirectory {
    return this.conversationDirectory;
  }



  public async synthesizeSpeech(request: TTSSynthesizeRequest): Promise<TTSSynthesizeResponse> {

    return this.audioService.synthesizeSpeech(request);

  }



  public async recognizeSpeech(request: ASRRecognizeRequest): Promise<ASRRecognizeResponse> {

    return this.audioService.recognizeSpeech(request);

  }



  public async getAudioStatus(): Promise<AudioStatusSnapshot> {

    return this.audioService.getStatus();

  }

}
