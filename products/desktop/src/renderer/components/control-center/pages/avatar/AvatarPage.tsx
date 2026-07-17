import React from 'react';
import type { AvatarAppearanceState } from '../../../../store/appStore';
import { useAvatarPageViewModel } from '../../view-models';
import { InfoRows, PageHeader, SurfaceCard, StatusBadge } from '../../shared/ui';

type PresentationProjection = Awaited<ReturnType<Window['desktopHost']['getCharacterPresentationProjection']>>;
type ReadinessCatalog = Awaited<ReturnType<Window['desktopHost']['getRuntimeReadiness']>>;

interface AvatarPageProps {
  avatarLabel: string;
  currentAvatarModel: string;
  currentAvatarModelLabel: string;
  emotion: string;
  appearance: AvatarAppearanceState;
  presentationProjection: PresentationProjection | null;
  runtimeReadinessCatalog: ReadinessCatalog | null;
  activeSection: string;
  onAppearanceChange: (next: AvatarAppearanceState, mode?: 'commit' | 'preview') => void;
}

export const AvatarPage: React.FC<AvatarPageProps> = ({
  avatarLabel,
  currentAvatarModel,
  currentAvatarModelLabel,
  emotion,
  appearance,
  presentationProjection,
  runtimeReadinessCatalog,
  activeSection,
  onAppearanceChange,
}) => {
  const vm = useAvatarPageViewModel(currentAvatarModel, appearance, presentationProjection, runtimeReadinessCatalog);
  const title = activeSection === 'model' ? '模型与动作' : activeSection === 'placement' ? '桌面位置' : '形象状态';

  return (
    <div className="avatar-workbench">
      <PageHeader eyebrow="角色形象" title={title} summary="Avatar 是角色身体的一部分；模型、动作与桌面呈现都消费同一份权威投影。" status={{ label: avatarLabel, tone: vm.shellTone }} actions={<button type="button" className="secondary-action" onClick={vm.refreshDiagnostics}>刷新状态</button>} />
      <div className="avatar-layout">
        <section className="avatar-preview-card">
          <div className="avatar-preview-stage">
            {vm.avatarImage ? <img src={vm.avatarImage} alt={`${currentAvatarModelLabel || '当前角色'}形象预览`} /> : <span className="avatar-preview-empty">等待形象预览</span>}
          </div>
          <div className="avatar-presentation-summary">
            <div><span>当前模型</span><strong>{vm.selectedModel?.displayName || currentAvatarModelLabel || currentAvatarModel || '未选择'}</strong></div>
            <StatusBadge tone={vm.shellTone}>{vm.placementSummary}</StatusBadge>
          </div>
        </section>
        <aside className="avatar-side-stack">
          {activeSection === 'status' && <AvatarStatus vm={vm} emotion={emotion} projection={presentationProjection} />}
          {activeSection === 'model' && <AvatarActions vm={vm} />}
          {activeSection === 'placement' && <AvatarPlacement vm={vm} appearance={appearance} onAppearanceChange={onAppearanceChange} />}
        </aside>
      </div>
    </div>
  );
};

const AvatarStatus: React.FC<{ vm: ReturnType<typeof useAvatarPageViewModel>; emotion: string; projection: PresentationProjection | null }> = ({ vm, emotion, projection }) => (
  <>
    <SurfaceCard title="身体状态"><InfoRows rows={[
      ['承载状态', vm.avatarRuntime?.state ?? '等待投影'],
      ['首帧', projection?.lifecycle.first_frame_presented ? '已呈现' : '等待'],
      ['交互', projection?.lifecycle.interaction_ready ? '已就绪' : '等待'],
      ['当前情绪', emotionLabel(emotion)],
    ]} /></SurfaceCard>
    <SurfaceCard title="资源准备"><p className={vm.diagnosticsTone === 'error' ? 'error-copy' : 'muted-copy'}>{vm.diagnosticsSummary}</p><InfoRows rows={[
      ['模型包', vm.selectedModel?.displayName ?? '等待'],
      ['资源项', String(vm.avatarRuntime?.reconciler?.resources.length ?? vm.diagnostics?.requiredSdks.length ?? 0)],
    ]} /></SurfaceCard>
  </>
);

const AvatarActions: React.FC<{ vm: ReturnType<typeof useAvatarPageViewModel> }> = ({ vm }) => (
  <SurfaceCard title="模型动作" subtitle="动作状态以 Avatar Host 上报为准">
    {vm.actionGroups.length === 0 && <p className="muted-copy">当前模型没有可手动控制的动作。</p>}
    <div className="avatar-action-groups">{vm.actionGroups.map(([category, actions]) => (
      <section className="avatar-action-group" key={category}>
        <span>{actionCategoryLabel(category)}</span>
        <div className="avatar-action-list">{actions.map((action) => {
          const active = vm.activeActionIds.has(action.id);
          const pending = vm.pendingActionId === action.id;
          return <button type="button" className={`avatar-action-row ${active ? 'is-active' : ''}`} key={action.id} disabled={pending} onClick={() => {
            vm.setPendingActionId(action.id);
            vm.setActionError('');
            void window.desktopHost.setAvatarAction({ id: action.id, operation: action.toggle ? (active ? 'deactivate' : 'activate') : 'trigger' }).catch((error: unknown) => {
              vm.setPendingActionId('');
              vm.setActionError(error instanceof Error ? error.message : '动作执行失败');
            });
          }}><span className="avatar-action-copy"><strong>{action.label}</strong><span>{action.requires.length ? `需要 ${action.requires.map((id) => vm.actionLabels.get(id) ?? id).join('、')}` : action.toggle ? '保持动作' : '单次动作'}</span></span><StatusBadge tone={active ? 'ready' : 'neutral'}>{pending ? '处理中' : active ? '已开启' : '关闭'}</StatusBadge></button>;
        })}</div>
      </section>
    ))}</div>
    {vm.actionError && <p className="error-copy">{vm.actionError}</p>}
  </SurfaceCard>
);

const AvatarPlacement: React.FC<{ vm: ReturnType<typeof useAvatarPageViewModel>; appearance: AvatarAppearanceState; onAppearanceChange: AvatarPageProps['onAppearanceChange'] }> = ({ vm, appearance, onAppearanceChange }) => (
  <>
    <SurfaceCard title="显示比例">
      <div className="avatar-scale-control"><div className="avatar-scale-head"><span>比例</span><strong>{Math.round(appearance.displayScale * 100)}%</strong></div><input type="range" min="0.5" max="1.8" step="0.05" value={appearance.displayScale} onChange={(event) => onAppearanceChange({ ...appearance, displayScale: Number(event.target.value) }, 'preview')} onPointerUp={() => onAppearanceChange(appearance, 'commit')} /></div>
    </SurfaceCard>
    <SurfaceCard title="构图位置">
      <div className="avatar-placement-actions">{Object.keys(vm.placementPresets).map((placementId) => <button type="button" className={vm.activePlacementId === placementId ? 'primary-action' : 'secondary-action'} key={placementId} onClick={() => onAppearanceChange({ ...appearance, placementId }, 'commit')}>{placementLabel(placementId)}</button>)}</div>
      <button type="button" className="secondary-action" disabled={vm.placementResetState === 'pending'} onClick={() => { vm.setPlacementResetState('pending'); void window.desktopHost.resetAvatarPlacement().then(() => vm.setPlacementResetState('success')).catch(() => vm.setPlacementResetState('error')); }}>重置桌面位置</button>
    </SurfaceCard>
  </>
);

function emotionLabel(value: string): string { return ({ neutral: '平静', happy: '愉快', sad: '低落', angry: '不悦', surprised: '惊讶' } as Record<string, string>)[value] ?? value; }
function actionCategoryLabel(value: string): string { return ({ appearance: '外观', expression: '表情', pose: '姿态', accessory: '配饰', motion: '动作' } as Record<string, string>)[value] ?? value; }
function placementLabel(value: string): string { return ({ bust: '半身', 'three-quarter': '大半身', 'full-body': '完整形象' } as Record<string, string>)[value] ?? value; }
