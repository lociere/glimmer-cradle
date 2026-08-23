/**
 * Avatar 相关事件(阶段 8.2)。
 *
 * Avatar 是当前角色的“脸/身体”渲染层（Unity / placeholder）。
 * 本文件管 shell 生命周期 / 状态变化等事件,kernel 内各 Consumer 订阅以做出反应。
 *
 * 阶段 8.2 起把 setInterval 轮询 `AvatarController.isRendererConnected`
 * 改成事件驱动 —— 状态变化时直接 publish，ControlSurfaceGateway 等订阅方立即响应，
 * 无 1500ms 抖动延迟、无 polling 浪费。后续(8.7+ Avatar Registry)可在此
 * 加 host_hello / scene_loaded 等更多事件类型。
 */
import { DomainEvent } from './domain-events';
import type { PresentationUpstreamFrame } from '@glimmer-cradle/protocol';

/** Kernel 视角下可观察的 shell 状态。 */
export type AvatarPresence = 'unity' | 'offline';

export interface AvatarStatusChangedPayload {
  /** 现在 kernel 看到的 shell 状态。 */
  hostKind: AvatarPresence;
  /** 状态变化原因(connected / disconnected / heartbeat_timeout)— 仅观测用 */
  reason?: 'connected' | 'disconnected' | 'heartbeat_timeout' | 'init' | 'host_hello' | 'host_ready';
}

/**
 * Avatar 状态变化事件。
 *
 * 当外部 shell (Unity) 连入 / 断开 / 心跳超时 →  AvatarController 发布。
 * 订阅方典型例：ControlSurfaceGateway 将事件转发到产品控制表面，供 Avatar
 * 在 unity 接管时让位、断开时复位。
 */
export class AvatarStatusChangedEvent extends DomainEvent {
  public readonly event_type = 'AvatarStatusChangedEvent' as const;
  public readonly payload: AvatarStatusChangedPayload;

  constructor(payload: AvatarStatusChangedPayload) {
    super();
    this.payload = payload;
  }
}

export type AvatarActionStatePayload = NonNullable<PresentationUpstreamFrame['avatar_action_state']>;

/** Avatar 对保持动作的权威状态投影。 */
export class AvatarActionStateChangedEvent extends DomainEvent {
  public readonly event_type = 'AvatarActionStateChangedEvent' as const;

  constructor(public readonly payload: AvatarActionStatePayload) {
    super();
  }
}
