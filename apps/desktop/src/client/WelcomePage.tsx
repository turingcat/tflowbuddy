/** Desktop welcome presentation; the panel session and its credentials stay in the main process. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { formatDesktopMessage } from '../locale.ts'
import type { TFlowLoginBootstrap, TFlowLoginSettings, TFlowLoginView } from '../tflow/login-api.ts'
import type { TFlowWelcomeApi } from '../preload-tflow.ts'

/** Which step the panel currently shows. */
type Step = 'credentials' | 'totp' | 'group' | 'authenticated'

/**
 * Render the TFlow sign-in flow using shell-owned operations. The renderer holds
 * only what the user typed for the current submission and what the main process
 * reported; no token, model key, or raw panel response reaches it.
 * @param props.api - isolated preload API carrying shell copy and typed operations.
 * @returns greeting, the active step, and fixed bottom actions.
 */
export function Welcome({ api }: { api: TFlowWelcomeApi }) {
  const m = api.messages
  const [boot, setBoot] = useState<TFlowLoginBootstrap | undefined>(undefined)
  const [view, setView] = useState<TFlowLoginView>({ kind: 'starting' })
  const [draft, setDraft] = useState({ email: '', password: '', captcha: '', code: '' })
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
      if (next.kind !== 'failure') setDraft(current => ({ ...current, ...Object.fromEntries(clear.map(key => [key, ''])) }))
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
    void submit(() => api.start({
      email: draft.email.trim(),
      password: draft.password,
      captchaProof: draft.captcha.trim(),
    }), ['password', 'captcha'])
  }

  function confirmCode(event: FormEvent) {
    event.preventDefault()
    void submit(() => api.complete(draft.code.trim()), ['code'])
  }

  /** Return to the credential step after a recoverable failure. */
  function restart() {
    setView({ kind: 'signed-out' })
    setDraft({ email: '', password: '', captcha: '', code: '' })
  }

  const failure = view.kind === 'failure' ? view : undefined
  const captchaMissing = settings === undefined
  const incomplete = step === 'totp'
    ? !/^[0-9]{6}$/u.test(draft.code.trim())
    : draft.email.trim() === '' || draft.password === ''
  const totpHint = view.kind === 'totp' && view.maskedEmail !== undefined
    ? formatDesktopMessage(m.welcomeTotpHintFor, { email: view.maskedEmail })
    : m.welcomeTotpHint

  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby="welcome-heading">
      <img className="brand" src="assets/welcome-brand.png" alt={m.welcomeBrand} width="40" height="40" />

      <div className="tagline" hidden={step !== 'credentials'}>
        <h1 id="welcome-heading">{m.welcomeSignInTitle}</h1>
        <p id="welcome-description">{m.welcomeSignInIntro}</p>
      </div>

      <form className="key-form" id="credentials-form" hidden={step !== 'credentials'} noValidate onSubmit={signIn} aria-busy={busy}>
        <header className="key-heading">
          <h1>{m.welcomeCredentialsTitle}</h1>
          <p>{captchaMissing ? m.welcomeCredentialsConnecting : m.welcomeCredentialsHint}</p>
        </header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="tflow-email">{m.welcomeEmail}</label>
          <input ref={emailInput} id="tflow-email" type="email" autoComplete="username" autoCapitalize="off" spellCheck={false}
            required placeholder={m.welcomeEmail} value={draft.email} disabled={busy}
            onChange={(event) => { setDraft(current => ({ ...current, email: event.target.value })) }} />
        </div>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="tflow-password">{m.welcomePassword}</label>
          <input id="tflow-password" type="password" autoComplete="current-password" required
            placeholder={m.welcomePassword} value={draft.password} disabled={busy}
            onChange={(event) => { setDraft(current => ({ ...current, password: event.target.value })) }} />
        </div>
        {settings?.captchaEnabled === true && <div className="key-field">
          <label className="visually-hidden" htmlFor="tflow-captcha">{m.welcomeCaptcha}</label>
          <input id="tflow-captcha" type="text" autoComplete="off" spellCheck={false}
            placeholder={m.welcomeCaptcha} value={draft.captcha} disabled={busy}
            onChange={(event) => { setDraft(current => ({ ...current, captcha: event.target.value })) }} />
        </div>}
        <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
      </form>

      <form className="key-form" id="totp-form" hidden={step !== 'totp'} noValidate onSubmit={confirmCode} aria-busy={busy}>
        <header className="key-heading">
          <h1 id="totp-heading">{m.welcomeTotpTitle}</h1>
          <p id="totp-hint">{totpHint}</p>
        </header>
        <div className="key-field">
          <label className="visually-hidden" htmlFor="tflow-code">{m.welcomeCode}</label>
          <input ref={codeInput} id="tflow-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} required placeholder={m.welcomeCode} value={draft.code} disabled={busy}
            onChange={(event) => { setDraft(current => ({ ...current, code: event.target.value })) }} />
        </div>
        <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
      </form>

      <section className="key-form" id="group-step" hidden={step !== 'group'} aria-live="polite">
        <header className="key-heading">
          <h1 id="group-heading">{m.welcomeGroupTitle}</h1>
          <p>{m.welcomeGroupHint}</p>
        </header>
        <div className="group-list">
          {view.kind === 'group' && view.groups.map(group => (
            <button key={group.id} type="button" className="secondary" disabled={busy}
              onClick={() => { void submit(() => api.selectGroup(group.id), []) }}>
              {group.name}
            </button>
          ))}
        </div>
        <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
      </section>

      <section className="key-heading" id="status-step" hidden={step !== 'authenticated'} aria-live="polite">
        <h1 id="status-heading">{m.welcomeSignedIn}</h1>
        <p>{m.welcomeOpeningWorkspace}</p>
      </section>

      <div className="actions" id="actions" hidden={step === 'group' || step === 'authenticated'}>
        <button id="sign-in" className="primary" type="button" disabled={busy || captchaMissing || incomplete}
          onClick={step === 'totp' ? (event) => { confirmCode(event) } : (event) => { signIn(event) }}>
          {step === 'totp' ? m.welcomeConfirm : m.welcomeSignIn}
        </button>
        <p className="key-error" role="alert" hidden={failure === undefined}>{failure?.message ?? ''}</p>
        <button id="retry" className="secondary" type="button" disabled={busy} hidden={failure?.retryable !== true}
          onClick={restart}>
          {m.welcomeRetry}
        </button>
      </div>
    </main>
  </>
}
