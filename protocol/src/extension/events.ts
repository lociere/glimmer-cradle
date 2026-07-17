import type { ChannelReplyPayload, VisualCommand } from '../generated';

export const ExtensionSystemEventTopic = {
  ACTION_CHANNEL_REPLY: 'action.channel.reply',
  ACTION_STREAM_STARTED: 'ActionStreamStartedEvent',
  ACTION_STREAM_COMPLETED: 'ActionStreamCompletedEvent',
  ACTION_STREAM_CANCELLED: 'ActionStreamCancelledEvent',
  VISUAL_COMMAND_DISPATCH: 'VisualCommandDispatchEvent',
  EXTENSION_LOADED: 'ExtensionLoadedEvent',
  EXTENSION_STARTED: 'ExtensionStartedEvent',
  EXTENSION_STOPPED: 'ExtensionStoppedEvent',
  EXTENSION_ERROR: 'ExtensionErrorEvent',
} as const;

export type ExtensionSystemEventTopic =
  typeof ExtensionSystemEventTopic[keyof typeof ExtensionSystemEventTopic];
export type ExtensionScopedEventTopic<TExtensionId extends string = string> =
  `extension.${TExtensionId}.${string}`;

export interface ExtensionStreamBasePayload { channelId: string; streamId: string }
export interface ExtensionStreamStartedPayload extends ExtensionStreamBasePayload {}
export interface ExtensionStreamCompletedPayload extends ExtensionStreamBasePayload { fullText: string }
export interface ExtensionStreamCancelledPayload extends ExtensionStreamBasePayload { reason?: string }
export interface ExtensionLifecyclePayload { extensionId: string; name?: string; version?: string }
export interface ExtensionErrorPayload extends ExtensionLifecyclePayload { error: string; stack?: string }

export interface ExtensionEventPayloadMap {
  'action.channel.reply': ChannelReplyPayload;
  'ActionStreamStartedEvent': ExtensionStreamStartedPayload;
  'ActionStreamCompletedEvent': ExtensionStreamCompletedPayload;
  'ActionStreamCancelledEvent': ExtensionStreamCancelledPayload;
  'VisualCommandDispatchEvent': VisualCommand;
  'ExtensionLoadedEvent': ExtensionLifecyclePayload;
  'ExtensionStartedEvent': ExtensionLifecyclePayload;
  'ExtensionStoppedEvent': ExtensionLifecyclePayload;
  'ExtensionErrorEvent': ExtensionErrorPayload;
}
