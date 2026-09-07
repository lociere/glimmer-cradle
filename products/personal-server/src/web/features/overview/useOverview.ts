import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PersonalServerAppController } from '../../app/PersonalServerAppController';
import type { OverviewProps } from './Overview';

export function useOverview(controller: PersonalServerAppController): OverviewProps {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  const [configurationRead, setConfigurationRead] = useState<OverviewProps['configurationRead']>({ state: 'loading' });

  useEffect(() => {
    if (snapshot.connection !== 'online') return;
    const abort = new AbortController();
    setConfigurationRead({ state: 'loading' });
    void controller.readConfiguration(abort.signal).then(
      () => { if (!abort.signal.aborted) setConfigurationRead({ state: 'success' }); },
      (error: unknown) => {
        if (!abort.signal.aborted) setConfigurationRead({ state: 'error', message: error instanceof Error ? error.message : '无法读取模型配置。' });
      },
    );
    // 会话持有有超时边界的请求；离开的页面取消消费，迟到结果不得写回投影。
    return () => abort.abort();
  }, [controller, snapshot.connection, attempt]);

  return { snapshot, configurationRead, onRetryConfiguration: () => setAttempt((value) => value + 1) };
}
