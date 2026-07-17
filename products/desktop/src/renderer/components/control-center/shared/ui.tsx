import { Check, ChevronDown } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { DiagnosticLocationKey, Tone } from '../model';

export const SectionTitle: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="section-title"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
);

export const PageHeader: React.FC<{
  eyebrow: string;
  title: string;
  summary: string;
  status?: { label: string; tone: Tone };
  actions?: React.ReactNode;
  className?: string;
  actionsClassName?: string;
}> = ({ eyebrow, title, summary, status, actions, className, actionsClassName }) => (
  <section className={className ? `${className} page-hero` : 'page-hero'}>
    <div className="page-hero-copy">
      <span>{eyebrow}</span>
      <div className="page-hero-title-row"><h1>{title}</h1>{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</div>
      <p>{summary}</p>
    </div>
    {actions && <div className={actionsClassName ? `${actionsClassName} page-hero-actions` : 'page-hero-actions'}>{actions}</div>}
  </section>
);

export const StatusBadge: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`status-badge status-badge-${tone}`}>{children}</span>
);

export const SurfaceCard: React.FC<{ title?: string; subtitle?: string; className?: string; children: React.ReactNode }> = ({ title, subtitle, className = '', children }) => (
  <section className={`surface-card ${className}`.trim()}>{title && <SectionTitle title={title} subtitle={subtitle} />}{children}</section>
);

export const MetricCard: React.FC<{ label: string; value: string; tone: Tone }> = ({ label, value, tone }) => (
  <div className={`metric-card metric-card-${tone}`}><span>{label}</span><strong>{value}</strong></div>
);

export const InfoRows: React.FC<{ rows: Array<[string, string]> }> = ({ rows }) => (
  <div className="info-rows">{rows.map(([label, value]) => <div className="status-row" key={label}><span className="status-row-label">{label}</span><span className="status-row-value">{value}</span></div>)}</div>
);

export const QuickAction: React.FC<{ title: string; body: string; onClick: () => void }> = ({ title, body, onClick }) => (
  <button type="button" className="quick-action" onClick={onClick}><strong>{title}</strong><span>{body}</span></button>
);

export const DiagnosticButton: React.FC<{ label: string; location: DiagnosticLocationKey }> = ({ label, location }) => (
  <button type="button" className="button button-secondary button-compact" onClick={() => { void window.desktopHost.openDiagnosticLocation(location); }}>{label}</button>
);

export const TextField: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <label className="settings-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>
);

export const TextAreaField: React.FC<{ label: string; value: string; rows: number; onChange: (value: string) => void }> = ({ label, value, rows, onChange }) => (
  <label className="settings-field settings-field-wide"><span>{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></label>
);

export const NumberField: React.FC<{ label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }> = ({ label, min, max, step, value, onChange }) => (
  <label className="settings-field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
);

export type SelectFieldOption = string | { value: string; label: string };

export const SelectControl: React.FC<{
  value: string;
  options: SelectFieldOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}> = ({ value, options, onChange, ariaLabel, className = '' }) => {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedOptions = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const selectedIndex = Math.max(0, normalizedOptions.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, selectedIndex]);

  const selectAt = (index: number) => {
    const option = normalizedOptions[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveActive = (direction: 1 | -1) => {
    if (normalizedOptions.length === 0) return;
    const next = (activeIndex + direction + normalizedOptions.length) % normalizedOptions.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const selected = normalizedOptions[selectedIndex];
  return (
    <div className={`select-control ${open ? 'is-open' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="select-control-trigger"
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, normalizedOptions.length - 1));
          }
        }}
      >
        <span>{selected?.label ?? '请选择'}</span><ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <div
          id={`${id}-listbox`}
          className="select-control-list"
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
            if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAt(activeIndex); }
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {normalizedOptions.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              key={option.value}
              ref={(node) => { optionRefs.current[index] = node; }}
              onFocus={() => setActiveIndex(index)}
              onClick={() => selectAt(index)}
            >
              <span>{option.label}</span>{option.value === value && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const SelectField: React.FC<{ label: string; value: string; options: SelectFieldOption[]; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => (
  <div className="settings-field"><span>{label}</span><SelectControl ariaLabel={label} value={value} options={options} onChange={onChange} /></div>
);
