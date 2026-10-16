import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { chicagoTodayIso } from '../time.js'
import { supabase } from '../supabase.js'
import { useBell } from '../store.jsx'
import { canUseVault } from './access.js'
import { wipe } from './bytes.js'
import { decryptJson, openVault, setupVault } from './crypto.js'
import { shouldLock } from './lock.js'
import { registerPasskey } from './passkey.js'
import { safeReminders } from './reminders.js'
import { appendAudit, readAudit, readSealed, writeSealed } from './sealedStore.js'
import { secretsFromRecord } from './secrets.js'
import { auditEvent, sealRecord, sendAudit, sendSealedRecord, sendWrappedKey } from './transport.js'

const VaultContext = createContext(null)

function storage() {
  return window.localStorage
}

export function VaultProvider({ children }) {
  const { state } = useBell()
  const [vaultParent, setVaultParent] = useState(false)
  const canUse = canUseVault({
    demo: Boolean(state.session?.demo),
    memberRole: state.memberRole,
    vaultParent,
  })
  const [status, setStatus] = useState('locked')
  const [records, setRecords] = useState([])
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')
  const [hasVault, setHasVault] = useState(false)
  const [busy, setBusy] = useState(false)
  const keyRef = useRef(null)
  const rawRef = useRef(null)
  const lastActivity = useRef(Date.now())

  const dropKeys = useCallback(() => {
    wipe(rawRef.current)
    rawRef.current = null
    keyRef.current = null
  }, [])

  const remember = useCallback((opened) => {
    dropKeys()
    keyRef.current = opened.key
    rawRef.current = opened.rawDek
  }, [dropKeys])

  useEffect(() => {
    const envelope = readSealed(storage())
    setHasVault(Boolean(envelope))
    setStatus(envelope ? 'locked' : 'setup')
    setAudit(readAudit(storage()))
  }, [])

  useEffect(() => {
    if (!supabase || state.backend !== 'live' || !state.session?.userId) return undefined
    let cancelled = false
    supabase
      .from('vault_parents')
      .select('user_id')
      .eq('user_id', state.session.userId)
      .then(({ data }) => {
        if (!cancelled) setVaultParent(Boolean(data?.length))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state.backend, state.session])

  const lock = useCallback((reason = 'lock') => {
    dropKeys()
    setRecords([])
    setStatus(readSealed(storage()) ? 'locked' : 'setup')
    if (reason) {
      const event = auditEvent({
        action: 'lock',
        actorId: state.session?.userId || null,
        householdId: state.householdId,
      })
      setAudit(appendAudit(storage(), { ...event, actor: state.session?.name || 'parent' }))
    }
  }, [dropKeys, state.householdId, state.session])

  useEffect(() => {
    if (status !== 'unlocked') return undefined
    lastActivity.current = Date.now()
    const mark = () => {
      lastActivity.current = Date.now()
    }
    const onHide = () => {
      if (document.hidden) lock('lock')
    }
    const tick = () => {
      if (shouldLock({ lastActivity: lastActivity.current, now: Date.now(), hidden: document.hidden })) lock('lock')
    }
    window.addEventListener('pointerdown', mark)
    window.addEventListener('keydown', mark)
    document.addEventListener('visibilitychange', onHide)
    const timer = window.setInterval(tick, 15000)
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', mark)
      document.removeEventListener('visibilitychange', onHide)
      window.clearInterval(timer)
    }
  }, [status, lock])

  const decryptEnvelope = useCallback(async (key, envelope) => {
    const next = []
    for (const row of envelope.records || []) {
      const record = await decryptJson(key, row)
      next.push({ ...record, id: row.id, fileIv: row.fileIv, fileCiphertext: row.fileCiphertext })
    }
    return next
  }, [])

  const finishUnlock = useCallback(async (opened) => {
    const envelope = readSealed(storage())
    remember(opened)
    const next = await decryptEnvelope(opened.key, envelope)
    setRecords(next)
    setStatus('unlocked')
    const event = auditEvent({
      action: 'unlock',
      householdId: state.householdId,
      actorId: state.session?.userId || null,
    })
    setAudit(appendAudit(storage(), { ...event, actor: state.session?.name || 'parent' }))
    if (supabase && state.backend === 'live' && state.householdId && state.session?.userId) {
      await sendAudit(supabase, event).catch(() => {})
    }
  }, [decryptEnvelope, remember, state.backend, state.householdId, state.session])

  const setup = useCallback(async (passphrase) => {
    setBusy(true)
    setError('')
    try {
      const created = await setupVault(passphrase)
      writeSealed(storage(), created.envelope, [])
      setHasVault(true)
      if (supabase && state.backend === 'live' && state.householdId) {
        await sendWrappedKey(supabase, { householdId: state.householdId, envelope: created.envelope }).catch(() => {})
      }
      await finishUnlock(created)
    } catch (err) {
      setError(err.message || 'Could not create the vault')
    } finally {
      setBusy(false)
    }
  }, [finishUnlock, state.backend, state.householdId])

  const unlock = useCallback(async (passphrase) => {
    setBusy(true)
    setError('')
    try {
      const envelope = readSealed(storage())
      if (!envelope) throw new Error('Set up the vault first')
      const opened = await openVault(passphrase, envelope)
      await finishUnlock(opened)
    } catch {
      setError('That passphrase does not open the vault.')
    } finally {
      setBusy(false)
    }
  }, [finishUnlock])

  const addRecord = useCallback(async (record, fileBytes) => {
    const key = keyRef.current
    if (!key) throw new Error('Unlock the vault first')
    const secrets = secretsFromRecord(record, fileBytes ? new TextDecoder().decode(fileBytes) : '')
    const envelope = readSealed(storage())
    const sealed = await sealRecord(key, record, fileBytes)
    if (supabase && state.backend === 'live' && state.householdId) {
      await sendSealedRecord(supabase, { householdId: state.householdId, sealed, secrets }).catch((err) => {
        if (!/schema cache|does not exist|404|42P01/i.test(err.message || '')) throw err
      })
    }
    const nextEnvelope = { ...envelope, records: [...(envelope.records || []), sealed] }
    writeSealed(storage(), nextEnvelope, secrets)
    setRecords((prev) => [...prev, { ...record, fileIv: sealed.fileIv, fileCiphertext: sealed.fileCiphertext }])
    const event = auditEvent({
      action: 'add',
      recordId: record.id,
      householdId: state.householdId,
      actorId: state.session?.userId || null,
    })
    setAudit(appendAudit(storage(), { ...event, actor: state.session?.name || 'parent' }, secrets))
    if (supabase && state.backend === 'live' && state.session?.userId) {
      await sendAudit(supabase, event, secrets).catch(() => {})
    }
  }, [state.backend, state.householdId, state.session])

  const deleteRecord = useCallback(async (id) => {
    const envelope = readSealed(storage())
    const nextEnvelope = { ...envelope, records: (envelope.records || []).filter((row) => row.id !== id) }
    writeSealed(storage(), nextEnvelope, [])
    setRecords((prev) => prev.filter((row) => row.id !== id))
    const event = auditEvent({
      action: 'delete',
      recordId: id,
      householdId: state.householdId,
      actorId: state.session?.userId || null,
    })
    setAudit(appendAudit(storage(), { ...event, actor: state.session?.name || 'parent' }))
    if (supabase && state.backend === 'live' && state.householdId) {
      await Promise.resolve(supabase.from('vault_records').delete().eq('id', id)).catch(() => {})
      await Promise.resolve(supabase.storage.from('vault').remove([`${state.householdId}/${id}`])).catch(() => {})
      if (state.session?.userId) await sendAudit(supabase, event).catch(() => {})
    }
  }, [state.backend, state.householdId, state.session])

  const note = useCallback((action, recordId) => {
    const event = auditEvent({
      action,
      recordId,
      householdId: state.householdId,
      actorId: state.session?.userId || null,
    })
    setAudit(appendAudit(storage(), { ...event, actor: state.session?.name || 'parent' }))
    if (supabase && state.backend === 'live' && state.session?.userId) {
      sendAudit(supabase, event).catch(() => {})
    }
  }, [state.backend, state.householdId, state.session])

  const addPasskey = useCallback(async () => {
    if (!rawRef.current) throw new Error('Unlock the vault again before adding a passkey')
    const passkey = await registerPasskey(rawRef.current)
    const envelope = readSealed(storage())
    writeSealed(storage(), { ...envelope, passkeys: [...(envelope.passkeys || []), passkey] }, [])
    if (supabase && state.backend === 'live' && state.householdId && state.session?.userId) {
      await supabase.from('vault_passkeys').insert({
        household_id: state.householdId,
        user_id: state.session.userId,
        credential_id: passkey.credentialId,
        wrapped_dek: passkey.wrappedDek,
        wrap_iv: passkey.wrapIv,
      })
    }
  }, [state.backend, state.householdId, state.session])

  const reminders = useMemo(
    () => (status === 'unlocked' ? safeReminders(records, chicagoTodayIso()) : []),
    [records, status],
  )

  const value = {
    canUse,
    status: hasVault ? status : 'setup',
    busy,
    error,
    records: status === 'unlocked' ? records : [],
    reminders,
    audit,
    lock,
    setup,
    unlock,
    addRecord,
    deleteRecord,
    noteView: (id) => note('view', id),
    noteReveal: (id) => note('reveal', id),
    addPasskey,
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault() {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault outside provider')
  return ctx
}
