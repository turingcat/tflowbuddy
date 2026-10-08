/** Desktop welcome presentation; the panel session and its credentials stay in the main process. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { formatDesktopMessage } from '../locale.ts'
import type { TFlowLoginBootstrap, TFlowLoginSettings, TFlowLoginView } from '../tflow/login-api.ts'
import type { TFlowWelcomeApi } from '../preload-tflow.ts'
import AliyunCaptcha, { type AliyunCaptchaHandle } from './AliyunCaptcha.tsx'

/** Which step the panel currently shows. */
type Step = 'credentials' | 'totp' | 'group' | 'authenticated'

/**
 * Render the TFlow sign-in flow using shell-owned operations. The renderer holds
 * only current submission fields, slider proof, and main-process reported state;
 * no token, model key, or raw panel response reaches it.
 * @param props.api - isolated preload API carrying shell copy and typed operations.
 * @returns greeting, the active step, and fixed bottom actions.
 */
export function Welcome({ api }: { api: TFlowWelcomeApi }) {
  const m = api.messages
  const [boot, setBoot] = useState<TFlowLoginBootstrap | undefined>(undefined)
  const [view, setView] = useState<TFlowLoginView>({ kind: 'starting' })
  const [draft, setDraft] = useState({ email: '', password: '', code: '' })
  const [captchaProof, setCaptchaProof] = useState('')
  const captchaRef = useRef<AliyunCaptchaHandle>(null)
  const [captchaError, setCaptchaError] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const emailInput = useRef<HTMLInputElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mounted.current = true
    document.title = m.welcomeTitle
    const stop = api.onView((next) => { setView(next) })
    void api.bootstrap().then((next) => {
      if (!mounted.current) return
      setBoot(next)
      setView(next.state)
    }).catch(() => {
      // The first sign-in attempt repeats the same request and reports why.
      if (mounted.current) setView({ kind: 'signed-out' })
    })
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  const settings: TFlowLoginSettings | undefined = boot?.settings
  const step: Step = view.kind === 'totp' ? 'totp'
    : view.kind === 'group' ? 'group'
      : view.kind === 'authenticated' ? 'authenticated'
        : 'credentials'

  useEffect(() => {
    if (step === 'totp') codeInput.current?.focus()
    else if (step === 'credentials') emailInput.current?.focus()
  }, [step, boot])

  // A stored session is already valid when the window opens; the shell is asked
  // to reveal the workspace rather than waiting for interaction.
  useEffect(() => {
    if (view.kind !== 'authenticated') return
    void api.enterWorkspace().catch(() => undefined)
  }, [api, view.kind])

  /**
   * Run one submission, clearing the drafts that must not outlive it. The
   * password and code exist only for the duration of the request.
   */
  async function submit(run: () => Promise<TFlowLoginView>, clear: Array<keyof typeof draft>): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const next = await run()
      if (!mounted.current) return
      setView(next)
      if (next.kind !== 'failure' && next.kind !== 'signed-out') setDraft(current => ({ ...current, ...Object.fromEntries(clear.map(key => [key, ''])) }))
    } catch {
      // A rejected invoke means the window's own bridge failed; the form stays
      // usable and the next attempt reports the panel's reason.
      if (mounted.current) setView({ kind: 'failure', message: m.welcomeActionFailed, retryable: true })
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function signIn(event: FormEvent) {
    event.preventDefault()
    void submit(async () => {
      try {
        return await api.start({ email: draft.email.trim(), password: draft.password, captchaProof })
      } finally {
        captchaRef.current?.reset()
        setCaptchaProof('')
      }
    }, ['password'])
  }

  function confirmCode(event: FormEvent) {
    event.preventDefault()
    void submit(() => api.complete(draft.code.trim()), ['code'])
  }

  const failure = view.kind === 'failure' ? view : undefined
  const captchaMissing = settings === undefined
  const captchaConfigComplete = settings?.captchaEnabled !== true || (
    Boolean(settings.captchaSceneId) && Boolean(settings.captchaPrefix) &&
    (settings.captchaRegion === 'cn' || settings.captchaRegion === 'sgp')
  )
  const incomplete = step === 'totp'
    ? !/^[0-9]{6}$/u.test(draft.code.trim())
    : draft.email.trim() === '' || draft.password === '' || (settings?.captchaEnabled === true &&
      (!captchaConfigComplete || captchaProof === ''))
  const totpHint = view.kind === 'totp' && view.maskedEmail !== undefined
    ? formatDesktopMessage(m.welcomeTotpHintFor, { email: view.maskedEmail })
    : m.welcomeTotpHint

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby="welcome-heading">
      <form className="key-form" id="credentials-form" hidden={step !== 'credentials'} noValidate onSubmit={signIn} aria-busy={busy}>
        <div className="auth-card">
          <h1 id="welcome-heading">{m.welcomeBrand}</h1>
          <p className="visually-hidden" id="welcome-description">{m.welcomeSignInIntro}</p>
          <div className="key-field">
            <label htmlFor="tflow-email">{m.welcomeEmail}</label>
            <input ref={emailInput} id="tflow-email" type="email" autoComplete="username" autoCapitalize="off" spellCheck={false}
              required value={draft.email} disabled={busy}
              onChange={(event) => { setDraft(current => ({ ...current, email: event.target.value })) }} />
          </div>
          <div className="key-field">
            <label htmlFor="tflow-password">{m.welcomePassword}</label>
            <input id="tflow-password" type="password" autoComplete="current-password" required
              value={draft.password} disabled={busy}
              onChange={(event) => { setDraft(current => ({ ...current, password: event.target.value })) }} />
          </div>
          {settings?.captchaEnabled === true && captchaConfigComplete && <>
            <AliyunCaptcha ref={captchaRef} sceneId={settings.captchaSceneId} prefix={settings.captchaPrefix}
              region={settings.captchaRegion === 'sgp' ? 'sgp' : 'cn'}
              labels={{ idle: m.welcomeCaptcha, verifying: m.welcomeCaptchaVerifying, verified: m.welcomeCaptchaVerified }}
              onError={() => { setCaptchaError(true); setCaptchaProof('') }} onVerify={(proof) => { setCaptchaError(false); setCaptchaProof(proof) }} />
            {captchaError && <p className="key-error" role="alert">{m.welcomeCaptchaFailed}</p>}
          </>}
          {captchaMissing && <p className="auth-hint">{m.welcomeCredentialsConnecting}</p>}
          <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
          <button className="auth-login" id="sign-in" type="submit" disabled={busy || captchaMissing || incomplete}>
            {m.welcomeSignIn}
          </button>
        </div>
      </form>

      <form className="key-form" id="totp-form" hidden={step !== 'totp'} noValidate onSubmit={confirmCode} aria-busy={busy}>
        <div className="auth-card">
          <h1>{m.welcomeBrand}</h1>
          <h2 id="totp-heading">{m.welcomeTotpTitle}</h2>
          <p className="auth-hint" id="totp-hint">{totpHint}</p>
          <div className="key-field">
            <label htmlFor="tflow-code">{m.welcomeCode}</label>
            <input ref={codeInput} id="tflow-code" className="code" type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} required value={draft.code} disabled={busy}
              onChange={(event) => { setDraft(current => ({ ...current, code: event.target.value })) }} />
          </div>
          <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
          <button className="auth-login" id="sign-in-totp" type="submit" disabled={busy || captchaMissing || incomplete}>
            {m.welcomeConfirm}
          </button>
        </div>
      </form>

      <section className="key-form" id="group-step" hidden={step !== 'group'} aria-live="polite">
        <div className="auth-card">
          <h1>{m.welcomeBrand}</h1>
          <h2 id="group-heading">{m.welcomeGroupTitle}</h2>
          <p className="auth-hint">{m.welcomeGroupHint}</p>
          <div className="group-list">
            {view.kind === 'group' && view.groups.map(group => (
              <button key={group.id} type="button" disabled={busy}
                onClick={() => { void submit(() => api.selectGroup(group.id), []) }}>
                {group.name}
              </button>
            ))}
          </div>
          <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
        </div>
      </section>

      <section className="key-form" id="status-step" hidden={step !== 'authenticated'} aria-live="polite">
        <div className="auth-card">
          <h1>{m.welcomeBrand}</h1>
          <h2 id="status-heading">{m.welcomeSignedIn}</h2>
          <p className="auth-hint">{m.welcomeOpeningWorkspace}</p>
        </div>
      </section>

    </main>
  </>
}
