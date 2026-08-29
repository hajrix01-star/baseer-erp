import "./backup-recovery-workspace.css";

import { BaseerCard } from "./baseer-card";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { backupRecoveryText } from "./backup-recovery-copy";

type Language = "ar" | "en";

/**
 * This workspace intentionally has no mocked job data and no download action.
 * The server owns archive truth; a future connection may enable a download
 * only from an artifact receipt validated against the contracts
 * package. The current archive coverage remains partial and non-restorable.
 */
export function BackupRecoveryWorkspace({ language }: { language: Language }) {
  const text = backupRecoveryText(language);
  const healthMetrics = [
    text.lastVerifiedBackup,
    text.recoveryPoint,
    text.storage,
    text.restoreTest,
  ];
  const qualityChecks = [
    text.qualityCheckArchive,
    text.qualityCheckChecksums,
    text.qualityCheckConsistency,
    text.qualityCheckRecoverability,
  ];
  const restoreStages = [
    text.restoreUpload,
    text.restoreVerify,
    text.restoreDiscover,
    text.restoreStage,
    text.restoreValidate,
    text.restoreApply,
  ];

  return <BaseerWorkspace className="backup-recovery-workspace">
    <BaseerSectionHeader
      eyebrow={text.eyebrow}
      title={text.title}
      description={text.description}
      actions={<BaseerStatusBadge tone="info">{text.gate}: {text.gateStatus}</BaseerStatusBadge>}
    />

    <BaseerNotice tone="warning" title={text.noApiTitle}>{text.noApiDescription}</BaseerNotice>

    <section className="backup-recovery-workspace__section" aria-labelledby="backup-health-heading">
      <header className="backup-recovery-workspace__section-header">
        <div><h3 id="backup-health-heading">{text.healthTitle}</h3><p>{text.healthDescription}</p></div>
        <BaseerStatusBadge tone="neutral">{text.waitingForApi}</BaseerStatusBadge>
      </header>
      <BaseerSummaryMetricGrid role="list" ariaLabel={text.healthTitle}>
        {healthMetrics.map((label) => <BaseerSummaryMetric key={label} role="listitem" label={label} value={text.unavailable} tone="muted" />)}
      </BaseerSummaryMetricGrid>
    </section>

    <div className="backup-recovery-workspace__grid">
      <section className="backup-recovery-workspace__section" aria-labelledby="backup-archives-heading">
        <header className="backup-recovery-workspace__section-header">
          <div><h3 id="backup-archives-heading">{text.backupTitle}</h3><p>{text.backupDescription}</p></div>
        </header>
        <BaseerEmptyState title={text.noBackupsTitle} description={text.noBackupsDescription} />
      </section>

      <BaseerCard className="backup-recovery-quality" aria-labelledby="backup-quality-heading">
        <header><h3 id="backup-quality-heading">{text.qualityTitle}</h3><p>{text.qualityDescription}</p></header>
        <ol aria-label={text.qualityTitle}>
          {qualityChecks.map((check, index) => <li key={check}><span aria-hidden="true">{index + 1}</span><span>{check}</span><BaseerStatusBadge tone="neutral">{text.waitingForApi}</BaseerStatusBadge></li>)}
        </ol>
      </BaseerCard>
    </div>

    <section className="backup-recovery-workspace__section" aria-labelledby="backup-restore-heading">
      <header className="backup-recovery-workspace__section-header">
        <div><h3 id="backup-restore-heading">{text.restoreTitle}</h3><p>{text.restoreDescription}</p></div>
        <BaseerStatusBadge tone="neutral">{text.restorePending}</BaseerStatusBadge>
      </header>
      <ol className="backup-recovery-progress" aria-label={text.restoreTitle}>
        {restoreStages.map((stage, index) => <li key={stage}><span className="backup-recovery-progress__number" aria-hidden="true">{index + 1}</span><div><strong>{stage}</strong><small>{text.waitingForApi}</small></div><span className="backup-recovery-progress__track" aria-hidden="true"><span /></span></li>)}
      </ol>
    </section>

    <div className="backup-recovery-workspace__grid">
      <section className="backup-recovery-workspace__section" aria-labelledby="backup-audit-heading">
        <header className="backup-recovery-workspace__section-header"><div><h3 id="backup-audit-heading">{text.auditTitle}</h3><p>{text.auditDescription}</p></div></header>
        <BaseerEmptyState title={text.noAuditTitle} description={text.noAuditDescription} />
      </section>
      <BaseerNotice tone="info" title={text.dataBoundaryTitle}>{text.dataBoundaryDescription}</BaseerNotice>
    </div>
  </BaseerWorkspace>;
}
