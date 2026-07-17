import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore, type ChatMessage } from '../../../../store/appStore';
import { VoiceRecorder } from '../../../../audio/voice-recorder';

const ASR_RECOGNITION_TIMEOUT_MS = 180000;

type MemoryArchitectureSnapshot = Awaited<ReturnType<Window['desktopHost']['getMemoryPreview']>>;

export const ConversationPage: React.FC<{ activeSection?: string }> = ({ activeSection = 'session' }) => {
  const messages = useAppStore((s) => s.messages);
  const addUserMessage = useAppStore((s) => s.addUserMessage);
  const clearChat = useAppStore((s) => s.clearChat);
  const systemStatus = useAppStore((s) => s.systemStatus);
  const thought = useAppStore((s) => s.thought);
  const audioStatus = useAppStore((s) => s.audioStatus);
  const audioInput = useAppStore((s) => s.audioInput);
  const setAudioInput = useAppStore((s) => s.setAudioInput);

  const [input, setInput] = useState('');
  const [memoryPreview, setMemoryPreview] = useState<MemoryArchitectureSnapshot | null>(null);
  const [memoryState, setMemoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [contextOpen, setContextOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const recognitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, thought.active]);

  useEffect(() => () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    clearRecognitionTimer();
  }, []);

  useEffect(() => {
    if (audioInput.status !== 'recognizing') {
      clearRecognitionTimer();
    }
  }, [audioInput.status]);

  useEffect(() => {
    if ((activeSection !== 'context' && !contextOpen) || memoryState !== 'idle') return undefined;
    let cancelled = false;
    setMemoryState('loading');
    void window.desktopHost.getMemoryPreview()
      .then((snapshot) => {
        if (cancelled) return;
        setMemoryPreview(snapshot);
        setMemoryState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setMemoryPreview(null);
        setMemoryState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection, contextOpen, memoryState]);

  const handleSend = (override?: string): void => {
    const text = (override ?? input).trim();
    if (!text || systemStatus !== 'online') return;

    addUserMessage(text);
    setInput('');
    window.desktopHost?.sendPerception({ content: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isOnline = systemStatus === 'online';
  const placeholder = isOnline ? '和当前角色说点什么...' : '核心未连接，暂时无法发送';
  const showEmpty = messages.length === 0;
  const asrReady = audioStatus.asr.enabled && audioStatus.asr.providers.some((provider) => provider.status === 'ready');
  const canRecord = isOnline && asrReady && audioInput.status !== 'recognizing';
  const voiceLabel = audioInput.status === 'recording'
    ? '停止'
    : audioInput.status === 'recognizing'
      ? '识别中'
      : audioInput.status === 'error'
        ? '重试'
        : '语音';
  const sectionCopy = activeSection === 'input'
    ? ['输入方式', '文字与语音输入']
    : activeSection === 'context'
      ? ['上下文', 'Conversation 状态与召回来源']
      : ['对话', '当前会话'];

  const clearRecognitionTimer = (): void => {
    if (recognitionTimerRef.current !== null) {
      window.clearTimeout(recognitionTimerRef.current);
      recognitionTimerRef.current = null;
    }
  };

  const armRecognitionTimeout = (): void => {
    clearRecognitionTimer();
    recognitionTimerRef.current = window.setTimeout(() => {
      const current = useAppStore.getState().audioInput;
      if (current.status === 'recognizing') {
        setAudioInput({
          status: 'error',
          error: '语音识别超时。FunASR 可能仍在初始化或下载模型，请稍后重试。',
        });
      }
    }, ASR_RECOGNITION_TIMEOUT_MS);
  };

  const handleVoiceInput = async (): Promise<void> => {
    if (!window.desktopHost || !canRecord) return;

    if (audioInput.status === 'recording') {
      try {
        const recorder = recorderRef.current;
        if (!recorder) return;
        recorderRef.current = null;
        const result = await recorder.stop();
        const audioId = `voice-${Date.now()}`;
        setAudioInput({ status: 'recognizing' });
        armRecognitionTimeout();
        await window.desktopHost.sendAudioInput({
          trace_id: `ui_audio_${Date.now()}`,
          audio_id: audioId,
          audio_data: result.audioData,
          mime_type: result.mimeType,
          duration_ms: result.durationMs,
          sample_rate: result.sampleRate,
        });
      } catch (error) {
        recorderRef.current?.cancel();
        recorderRef.current = null;
        setAudioInput({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setAudioInput({ status: 'recording', startedAt: Date.now() });
    } catch (error) {
      setAudioInput({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const renderComposer = (variant: 'bar' | 'panel' = 'bar'): React.ReactNode => (
    <div className={`chat-input-row ${variant === 'panel' ? 'chat-input-row-panel' : ''}`}>
      <div className="chat-input-shell">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="chat-input"
          rows={variant === 'panel' ? 5 : 1}
        />
      </div>
      <button
        type="button"
        onClick={() => handleSend()}
        className="send-btn"
        disabled={!input.trim() || !isOnline}
      >
        发送
      </button>
    </div>
  );

  return (
    <div className={`chat-panel chat-panel-${activeSection}`}>
      <div className="chat-toolbar">
        <div>
          <h1 className="chat-toolbar-title">{sectionCopy[0]}</h1>
          <div className="chat-toolbar-subtitle">{sectionCopy[1]}</div>
        </div>
        <div className="chat-toolbar-actions">
          <button
            type="button"
            className={`chat-tool-btn ${audioInput.status === 'recording' ? 'chat-tool-btn-active' : ''}`}
            disabled={!canRecord}
            title={asrReady ? '语音输入入口' : 'FunASR 尚未就绪'}
            onClick={() => { void handleVoiceInput(); }}
          >
            {voiceLabel}
          </button>
          <button
            type="button"
            className="chat-tool-btn"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((value) => !value)}
          >
            上下文
          </button>
          <button
            type="button"
            className="chat-tool-btn"
            onClick={clearChat}
            disabled={messages.length === 0}
          >
            清空
          </button>
        </div>
      </div>

      {activeSection === 'context' ? (
        <ChatContextWorkspace
          messages={messages}
          thought={thought}
          audioInputStatus={audioInput.status}
          memoryPreview={memoryPreview}
          memoryState={memoryState}
        />
      ) : activeSection === 'input' ? (
        <div className="chat-input-workspace">
          <section className="chat-mode-card chat-mode-card-primary">
            <div className="chat-mode-card-head">
              <div>
                <h2>文字输入</h2>
                <p>{isOnline ? '回车发送，Shift + Enter 换行。' : '核心未连接，输入暂不可发送。'}</p>
              </div>
              <span className={`chat-state-pill chat-state-${systemStatus}`}>{isOnline ? '可发送' : '只读'}</span>
            </div>
            {renderComposer('panel')}
          </section>

          <section className="chat-mode-card">
            <div className="chat-mode-card-head">
              <div>
                <h2>语音输入</h2>
                <p>录音识别后进入当前会话。</p>
              </div>
              <button
                type="button"
                className={`chat-tool-btn ${audioInput.status === 'recording' ? 'chat-tool-btn-active' : ''}`}
                disabled={!canRecord}
                onClick={() => { void handleVoiceInput(); }}
              >
                {voiceLabel}
              </button>
            </div>
            <div className="chat-mode-info">
              <div><span>语音识别</span><strong>{asrReady ? '就绪' : audioStatus.asr.enabled ? '等待' : '已关闭'}</strong></div>
              <div><span>输入状态</span><strong>{audioInputStatusLabel(audioInput.status)}</strong></div>
              <div><span>活跃 Provider</span><strong>{audioStatus.asr.activeProvider ?? '未选择'}</strong></div>
            </div>
            {audioInput.status === 'error' && audioInput.error && (
              <div className="audio-input-error" role="status">
                {audioInput.error}
              </div>
            )}
          </section>
        </div>
      ) : (
        <>
          <CollapsibleChatContext
            open={contextOpen}
            messages={messages}
            thought={thought}
            audioInputStatus={audioInput.status}
            memoryPreview={memoryPreview}
            memoryState={memoryState}
          />
          <div className="chat-list" ref={listRef}>
            {showEmpty ? (
              <ChatEmptyState status={systemStatus} onSendSuggestion={handleSend} />
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
            )}
            {thought.active && (
              <ThoughtIndicator hint={thought.hint ?? '正在思考...'} />
            )}
            {audioInput.status === 'error' && audioInput.error && (
              <div className="audio-input-error" role="status">
                {audioInput.error}
              </div>
            )}
          </div>
          {renderComposer()}
        </>
      )}
    </div>
  );
};

const CollapsibleChatContext: React.FC<{
  open: boolean;
  messages: ChatMessage[];
  thought: { active: boolean; hint?: string; updatedAt?: number };
  audioInputStatus: string;
  memoryPreview: MemoryArchitectureSnapshot | null;
  memoryState: 'idle' | 'loading' | 'ready' | 'error';
}> = ({ open, messages, thought, audioInputStatus, memoryPreview, memoryState }) => {
  if (!open) return null;
  return (
    <section className="chat-context-drawer" aria-label="可折叠上下文">
      <div>
        <span>上下文</span>
        <strong>会话上下文</strong>
      </div>
      <div className="chat-context-drawer-grid">
        <div><span>消息</span><strong>{messages.length}</strong></div>
        <div><span>思考态</span><strong>{thought.active ? '进行中' : '空闲'}</strong></div>
        <div><span>语音输入</span><strong>{audioInputStatusLabel(audioInputStatus)}</strong></div>
        <div><span>窗口内条目</span><strong>{memoryState === 'loading' ? '读取中' : `${memoryPreview?.items.length ?? 0} 条`}</strong></div>
      </div>
      <p>{memoryPreview?.items[0] ? memoryPreviewBody(memoryPreview.items[0]) : '当前没有展开的活动上下文。'}</p>
    </section>
  );
};

const audioInputStatusLabel = (status: string): string => {
  if (status === 'recording') return '录音中';
  if (status === 'recognizing') return '识别中';
  if (status === 'error') return '异常';
  return '空闲';
};

const ChatContextWorkspace: React.FC<{
  messages: ChatMessage[];
  thought: { active: boolean; hint?: string; updatedAt?: number };
  audioInputStatus: string;
  memoryPreview: MemoryArchitectureSnapshot | null;
  memoryState: 'idle' | 'loading' | 'ready' | 'error';
}> = ({ messages, thought, audioInputStatus, memoryPreview, memoryState }) => {
  const recentMessages = messages.slice(-5).reverse();
  const memoryItems = memoryPreview?.items.slice(0, 5) ?? [];
  const durableRecordCount = memoryPreview?.metrics.durableRecords ?? 0;
  const previewItems = memoryPreview?.metrics.previewItems ?? 0;
  const conversationMessages = memoryPreview?.metrics.conversationMessages ?? 0;
  const previewedMemories = memoryPreview?.metrics.previewedMemories ?? 0;
  return (
    <div className="chat-context-workspace">
      <section className="chat-mode-card">
        <div className="chat-mode-card-head">
          <div>
            <h2>上下文投影</h2>
            <p>当前请求可见的会话、思考态和输入状态。</p>
          </div>
        </div>
        <div className="chat-context-metrics">
          <div><span>会话消息</span><strong>{messages.length}</strong></div>
          <div><span>思考态</span><strong>{thought.active ? '进行中' : '空闲'}</strong></div>
          <div><span>语音输入</span><strong>{audioInputStatusLabel(audioInputStatus)}</strong></div>
          <div><span>预览条目</span><strong>{memoryState === 'loading' ? '读取中' : `${previewItems}`}</strong></div>
        </div>
        {thought.active && (
          <ThoughtIndicator hint={thought.hint ?? '正在思考...'} />
        )}
      </section>

      <section className="chat-mode-card">
        <div className="chat-mode-card-head">
          <div>
            <h2>活动上下文</h2>
            <p>
              {memoryState === 'error'
                ? '读取失败，请稍后重试或前往诊断。'
                : memoryState === 'loading'
                  ? '正在读取活动上下文投影。'
                  : `${previewItems} 条预览 · ${conversationMessages} 条会话记录 · ${durableRecordCount} 条持久事实 · ${previewedMemories} 条长期记忆`}
            </p>
          </div>
        </div>
        <div className="chat-context-list">
          {memoryItems.map((item) => (
            <div className="chat-context-row" key={`${item.source}-${item.id}`}>
              <span>{memorySourceLabel(item.source)}</span>
              <strong>{memoryPreviewBody(item)}</strong>
              <em>{item.timestamp ? item.timestamp.slice(0, 10) : item.title}</em>
            </div>
          ))}
          {memoryItems.length === 0 && (
            <p className="muted-copy">{memoryState === 'loading' ? '正在读取...' : '暂无可展示上下文。'}</p>
          )}
        </div>
      </section>

      <section className="chat-mode-card">
        <div className="chat-mode-card-head">
          <div>
            <h2>会话摘要</h2>
            <p>最近消息用于判断当前对话是否已经进入认知链路。</p>
          </div>
        </div>
        <div className="chat-context-list">
          {recentMessages.map((message) => (
            <div className="chat-context-row" key={message.id}>
              <span>{message.role === 'user' ? '用户' : '角色'}</span>
              <strong>{message.content}</strong>
              <em>{new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</em>
            </div>
          ))}
          {recentMessages.length === 0 && (
            <p className="muted-copy">当前会话还没有消息。</p>
          )}
        </div>
      </section>
    </div>
  );
};

function memorySourceLabel(source: MemoryArchitectureSnapshot['items'][number]['source']): string {
  if (source === 'conversation_message') return '会话记录';
  if (source === 'experience_moment') return '经历 Moment';
  if (source === 'role_knowledge') return '角色知识';
  return '记忆修订';
}

function memoryPreviewBody(item: MemoryArchitectureSnapshot['items'][number]): string {
  if (/[/\\][\w.-]+\.ya?ml$/i.test(item.body) || /^[\w.-]+[/\\][\w.-]+\.ya?ml$/i.test(item.body)) {
    return item.source === 'role_knowledge' ? '角色资料库索引。' : '已归档条目。';
  }
  return item.body || item.title;
}

const ThoughtIndicator: React.FC<{ hint: string }> = ({ hint }) => (
  <div className="thought-indicator" aria-live="polite">
    <span className="thought-dot" />
    <span>{hint}</span>
  </div>
);

const ChatEmptyState: React.FC<{
  status: string;
  onSendSuggestion: (text: string) => void;
}> = ({ status, onSendSuggestion }) => {
  const online = status === 'online';
  const connecting = status === 'connecting';

  return (
    <div className="chat-empty">
      <div className="chat-empty-symbol" aria-hidden><Sparkles size={22} /></div>
      <div className="chat-empty-title">
        {online ? '开始一段对话' : connecting ? '正在连接核心' : '核心未连接'}
      </div>
      <div className="chat-empty-hint">
        {online
          ? '输入第一句话，语音、动作和上下文会随会话自动更新。'
          : connecting
            ? '正在建立桌面连接。'
            : '请先启动核心服务，或前往日志查看状态。'}
      </div>
      <div className="chat-empty-state-grid" aria-label="对话状态">
        <div><span>输入</span><strong>{online ? '可发送' : '只读'}</strong></div>
        <div><span>上下文</span><strong>待建立</strong></div>
        <div><span>语音</span><strong>{online ? '可检查' : '等待连接'}</strong></div>
      </div>
      {online && (
        <div className="chat-empty-suggestions">
          {['你今天感觉怎么样？', '介绍一下你自己', '帮我检查当前状态'].map((text) => (
            <button
              className="suggestion-chip"
              type="button"
              onClick={() => onSendSuggestion(text)}
              key={text}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const MessageBubble: React.FC<{
  message: ChatMessage;
}> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className={`bubble-row ${isUser ? 'bubble-row-user' : 'bubble-row-assistant'}`}>
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        <MessageContent message={message} />
      </div>
    </div>
  );
};

type MessageSegment =
  | { kind: 'text'; content: string }
  | { kind: 'code'; language?: string; content: string };

const FENCED_CODE_BLOCK_RE = /```([a-zA-Z0-9_-]+)?[ \t]*(?:\r?\n)?([\s\S]*?)```/g;

const parseMessageContent = (content: string): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = FENCED_CODE_BLOCK_RE.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', content: content.slice(cursor, match.index) });
    }

    segments.push({
      kind: 'code',
      language: match[1],
      content: match[2].replace(/^\r?\n|\r?\n$/g, ''),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ kind: 'text', content: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', content }];
};

const MessageContent: React.FC<{ message: ChatMessage }> = ({ message }) => {
  if (message.contentType === 'code') {
    return (
      <div className="message-content">
        <figure className="message-code">
          {message.language && (
            <figcaption className="message-code-language">{message.language}</figcaption>
          )}
          <pre className="message-code-block">
            <code>{message.content}</code>
          </pre>
        </figure>
      </div>
    );
  }

  return (
    <div className="message-content">
      {parseMessageContent(message.content).map((segment, index) => {
        if (segment.kind === 'code') {
          return (
            <figure className="message-code" key={`code-${index}`}>
              {segment.language && (
                <figcaption className="message-code-language">{segment.language}</figcaption>
              )}
              <pre className="message-code-block">
                <code>{segment.content}</code>
              </pre>
            </figure>
          );
        }

        return (
          <span className="message-text" key={`text-${index}`}>
            {segment.content}
          </span>
        );
      })}
    </div>
  );
};
