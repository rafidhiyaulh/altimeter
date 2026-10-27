'use client'

import { ActionButton } from './Action'
import { useT } from './Lang'

export function PrivacyActions({ studentId, aiConsent, minor }: { studentId: number; aiConsent: boolean; minor: boolean }) {
  const { t } = useT()
  return (
    <div className="row" style={{ gap: 8 }}>
      {aiConsent
        ? <ActionButton small url="/api/privacy/consent" body={{ student_id: studentId, scope: 'ai_feedback', action: 'revoke' }} confirmText={t('Yakin cabut?', 'Revoke?')}>{t('Cabut izin AI', 'Revoke AI consent')}</ActionButton>
        : <ActionButton small url="/api/privacy/consent" body={{ student_id: studentId, scope: 'ai_feedback', action: 'grant', kind: minor ? 'guardian' : 'self' }}>
            {minor ? t('Catat izin wali', 'Record guardian consent') : t('Catat izin learner', 'Record learner consent')}</ActionButton>}
      <ActionButton small url="/api/privacy/dsr" body={{ student_id: studentId, kind: 'export' }}>{t('Minta ekspor data', 'Request data export')}</ActionButton>
      <ActionButton small url="/api/privacy/dsr" body={{ student_id: studentId, kind: 'erase' }} confirmText={t('Yakin minta penghapusan?', 'Request erasure?')}>{t('Minta penghapusan', 'Request erasure')}</ActionButton>
    </div>
  )
}
