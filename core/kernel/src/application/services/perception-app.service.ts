import { ConversationDirectory } from "../capabilities/conversation/conversation-directory";

import { AudioService } from "../capabilities/audio/audio-service";

import { ChannelStateStore } from "../channel/channel-state-store";

import { getLogger } from "../../foundation/logger/logger";

import { TTSSynthesizeRequest, TTSSynthesizeResponse, ASRRecognizeRequest, ASRRecognizeResponse, PerceptionEvent, AudioStatusPayload } from '@glimmer-cradle/protocol';
import { AttentionSessionManager } from "../../domain/attention/attention-session-manager";

import { IngressGateManager } from "../../foundation/ingress-gate/ingress-gate-manager";



const logger = getLogger("perception-gateway");



export class PerceptionAppService {

  constructor(

    private conversationDirectory: ConversationDirectory,

    private audioService: AudioService,

    private channelStateStore: ChannelStateStore,

    private attentionMgr: AttentionSessionManager) {}



  public async processIngress(event: PerceptionEvent): Promise<void> {

    // ── 入站防护（速率限制 / 熔断 / 就绪守卫）──

    const gate = IngressGateManager.instance;

    const gateResult = gate.admit(event.source);

    if (!gateResult.admitted) {

      logger.debug('感知输入被入站防护拒绝', {

        trace_id: event.id,

        source: event.source,

        rejection: gateResult.rejection?.type,

      });

      return;

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

    logger.info('感知输入', {

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

      const channelState = await this.channelStateStore.handleInboundMessage(request);

      logger.debug('通道状态刷新完成', {

        source: channelState.source,

        message_count: channelState.messageCount,

        last_trace_id: channelState.lastTraceId,

      });



      // 通过 AttentionSessionManager 注入，启用防抖、批处理与生成中断机制

      await this.attentionMgr.ingest(request);

      gate.complete(true);

      // 回复唯一出口是 Cognition Loop 的 Act → ActionCommand。
      // PERCEPTION_MESSAGE RPC 在这里仅表示投递成功。

    } catch (e) {

      gate.complete(false);

      logger.error('感知处理失败', {

        trace_id: event.id,

        source: event.source,

        error: e instanceof Error ? e.message : String(e),

        stack: e instanceof Error ? e.stack : undefined,

      });

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



  public async getAudioStatus(): Promise<AudioStatusPayload> {

    return this.audioService.getStatus();

  }

}



