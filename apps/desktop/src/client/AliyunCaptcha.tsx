import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

const SCRIPT_SRC = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const POPUP_ID = 'aliyunCaptcha-window-popup'
const MASK_ID = 'aliyunCaptcha-mask'
const POPUP_OPEN_TIMEOUT_MS = 8_000
const POPUP_WATCH_INTERVAL_MS = 300

let scriptPromise: Promise<void> | null = null
let activeOwnerId: string | null = null
let sdkConfig: { region: 'cn' | 'sgp'; prefix: string } | null = null

export type AliyunCaptchaState = 'idle' | 'verifying' | 'verified'

/** Controls one popup challenge and consumes its one-use proof. */
export interface AliyunCaptchaHandle {
  verify(): Promise<string | null>
  reset(): void
}

interface AliyunCaptchaProps {
  labels: { idle: string; verifying: string; verified: string }
  sceneId: string
  prefix: string
  region?: 'cn' | 'sgp'
  onVerify?: (proof: string) => void
  onError?: () => void
  onStateChange?: (state: AliyunCaptchaState) => void
}

function isCompatibleConfig(region: 'cn' | 'sgp', prefix: string): boolean {
  return sdkConfig === null || (sdkConfig.region === region && sdkConfig.prefix === prefix)
}

function loadScript(): Promise<void> {
  if (window.initAliyunCaptcha) {
    return Promise.resolve()
  }

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
  if (scriptPromise && existingScript) {
    return scriptPromise
  }
  scriptPromise = null

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = existingScript ?? document.createElement('script')
    const cleanupListeners = () => {
      script.removeEventListener('load', succeed)
      script.removeEventListener('error', fail)
    }
    const fail = () => {
      cleanupListeners()
      script.remove()
      scriptPromise = null
      reject(new Error('Failed to load Aliyun captcha script'))
    }
    const succeed = () => {
      if (window.initAliyunCaptcha) {
        cleanupListeners()
        resolve()
      } else {
        fail()
      }
    }

    script.addEventListener('load', succeed, { once: true })
    script.addEventListener('error', fail, { once: true })

    if (!existingScript) {
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

function isPopupVisible(): boolean {
  const popup = document.getElementById(POPUP_ID)
  return popup !== null && window.getComputedStyle(popup).display !== 'none'
}

/** Render the AIBuddy-style Aliyun popup slider in the isolated welcome window. */
const AliyunCaptcha = forwardRef<AliyunCaptchaHandle, AliyunCaptchaProps>(function AliyunCaptcha(
  { sceneId, prefix, region = 'cn', labels, onVerify, onError, onStateChange },
  ref,
) {
  const generatedId = useId().replace(/:/g, '')
  const buttonId = `aliyun-captcha-button-${generatedId}`
  const elementId = `aliyun-captcha-element-${generatedId}`
  const buttonRef = useRef<HTMLButtonElement>(null)
  const ownsCaptchaRef = useRef(false)
  const initializedRef = useRef(false)
  const initializationPromiseRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)
  const callbackGenerationRef = useRef(0)
  const cachedProofRef = useRef<string | null>(null)
  const pendingRef = useRef<{
    promise: Promise<string | null>
    resolve: (proof: string | null) => void
  } | null>(null)
  const popupWatchTimerRef = useRef<number | null>(null)
  const sdkClickRef = useRef(false)
  const popupSeenRef = useRef(false)
  const popupWatchStartedAtRef = useRef(0)
  const stateRef = useRef<AliyunCaptchaState>('idle')
  const [state, setState] = useState<AliyunCaptchaState>('idle')
  // Callers pass fresh callbacks each render; the mount effect must not tear down the SDK popup for that.
  const callbacksRef = useRef({ onVerify, onError, onStateChange })

  useLayoutEffect(() => {
    callbacksRef.current = { onVerify, onError, onStateChange }
  })

  const stateIcon = state === 'idle'
    ? <svg aria-hidden="true" className="captcha-icon" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg>
    : state === 'verifying'
      ? <svg aria-hidden="true" className="captcha-icon captcha-icon-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
      : <svg aria-hidden="true" className="captcha-icon" viewBox="0 0 24 24"><path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" /></svg>

  const updateState = useCallback(
    (nextState: AliyunCaptchaState) => {
      stateRef.current = nextState
      setState(nextState)
      callbacksRef.current.onStateChange?.(nextState)
    },
    [],
  )

  const acquireOwnership = useCallback(() => {
    if (ownsCaptchaRef.current) {
      return true
    }
    if (activeOwnerId !== null) {
      return false
    }
    if (!isCompatibleConfig(region, prefix)) {
      return false
    }

    activeOwnerId = generatedId
    ownsCaptchaRef.current = true
    return true
  }, [generatedId, prefix, region])

  const releaseOwnership = useCallback(() => {
    if (!ownsCaptchaRef.current) {
      return false
    }

    ownsCaptchaRef.current = false
    if (activeOwnerId === generatedId) {
      activeOwnerId = null
    }
    return true
  }, [generatedId])

  const stopPopupWatch = useCallback(() => {
    if (popupWatchTimerRef.current !== null) {
      window.clearInterval(popupWatchTimerRef.current)
      popupWatchTimerRef.current = null
    }
  }, [])

  const settlePending = useCallback((proof: string | null) => {
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.resolve(proof)
  }, [])

  const handleInitializationFailure = useCallback(() => {
    if (!mountedRef.current) {
      return
    }

    stopPopupWatch()
    settlePending(null)
    updateState('idle')
    callbacksRef.current.onError?.()
  }, [settlePending, stopPopupWatch, updateState])

  const clickSdkButton = useCallback(() => {
    sdkClickRef.current = true
    buttonRef.current?.click()
    sdkClickRef.current = false
  }, [])

  const startPopupWatch = useCallback(() => {
    stopPopupWatch()
    popupSeenRef.current = false
    popupWatchStartedAtRef.current = Date.now()
    popupWatchTimerRef.current = window.setInterval(() => {
      if (isPopupVisible()) {
        popupSeenRef.current = true
        return
      }

      if (
        popupSeenRef.current ||
        Date.now() - popupWatchStartedAtRef.current >= POPUP_OPEN_TIMEOUT_MS
      ) {
        stopPopupWatch()
        updateState('idle')
        settlePending(null)
        return
      }

      clickSdkButton()
    }, POPUP_WATCH_INTERVAL_MS)
  }, [clickSdkButton, settlePending, stopPopupWatch, updateState])

  const completeVerification = useCallback(
    (proof: string) => {
      if (!mountedRef.current) {
        return
      }

      stopPopupWatch()
      cachedProofRef.current = proof
      updateState('verified')
      callbacksRef.current.onVerify?.(proof)
      settlePending(proof)
    },
    [settlePending, stopPopupWatch, updateState],
  )

  const initialize = useCallback((): Promise<void> => {
    if (initializationPromiseRef.current) {
      return initializationPromiseRef.current
    }

    if (
      !ownsCaptchaRef.current ||
      initializedRef.current ||
      !sceneId ||
      !prefix ||
      !isCompatibleConfig(region, prefix)
    ) {
      return Promise.resolve()
    }

    const reservesConfig = sdkConfig === null
    if (reservesConfig) {
      sdkConfig = { region, prefix }
    }
    window.AliyunCaptchaConfig = { region, prefix }

    // eslint-disable-next-line prefer-const -- finally reads the promise assigned after the async function is declared.
    let initialization!: Promise<void>
    const runInitialization = async () => {
      try {
        try {
          await loadScript()
        } catch (error) {
          if (reservesConfig && isCompatibleConfig(region, prefix)) {
            sdkConfig = null
          }
          throw error
        }

        if (
          !mountedRef.current ||
          !ownsCaptchaRef.current ||
          initializedRef.current ||
          !window.initAliyunCaptcha
        ) {
          return
        }

        const callbackGeneration = callbackGenerationRef.current

        window.initAliyunCaptcha({
          SceneId: sceneId,
          prefix,
          mode: 'popup',
          element: `#${elementId}`,
          button: `#${buttonId}`,
          captchaVerifyCallback: (proof) => {
            if (callbackGeneration === callbackGenerationRef.current) {
              completeVerification(proof)
            }
            return { captchaResult: true }
          },
          onBizResultCallback: () => {},
          getInstance: () => {},
          slideStyle: { width: 360, height: 40 },
        })
        initializedRef.current = true
      } finally {
        if (initializationPromiseRef.current === initialization) {
          initializationPromiseRef.current = null
        }
      }
    }

    initialization = runInitialization().catch(handleInitializationFailure)
    initializationPromiseRef.current = initialization
    return initialization
  }, [
    buttonId,
    completeVerification,
    elementId,
    handleInitializationFailure,
    prefix,
    region,
    sceneId,
  ])

  const beginVerification = useCallback(() => {
    if (cachedProofRef.current || stateRef.current === 'verifying') {
      return
    }

    updateState('verifying')
    startPopupWatch()
  }, [startPopupWatch, updateState])

  const handleTriggerClick = useCallback(() => {
    if (sdkClickRef.current) {
      return
    }
    if (!acquireOwnership()) {
      callbacksRef.current.onError?.()
      return
    }

    void (async () => {
      await initialize()
      if (!mountedRef.current || !initializedRef.current) {
        return
      }
      beginVerification()
      clickSdkButton()
    })()
  }, [acquireOwnership, beginVerification, clickSdkButton, initialize])

  useImperativeHandle(
    ref,
    () => ({
      verify: () => {
        if (!acquireOwnership()) {
          return Promise.resolve(null)
        }
        if (cachedProofRef.current) {
          return Promise.resolve(cachedProofRef.current)
        }
        if (pendingRef.current) {
          return pendingRef.current.promise
        }

        let resolvePending: (proof: string | null) => void = () => {}
        const promise = new Promise<string | null>((resolve) => {
          resolvePending = resolve
        })
        pendingRef.current = { promise, resolve: resolvePending }
        beginVerification()
        void initialize().then(() => {
          if (mountedRef.current && initializedRef.current) {
            clickSdkButton()
          }
        })
        return promise
      },
      reset: () => {
        stopPopupWatch()
        settlePending(null)
        cachedProofRef.current = null
        callbackGenerationRef.current += 1
        initializedRef.current = false
        updateState('idle')
        if (ownsCaptchaRef.current) {
          void initialize()
        }
      },
    }),
    [
      acquireOwnership,
      beginVerification,
      initialize,
      settlePending,
      stopPopupWatch,
      updateState,
    ],
  )

  useEffect(() => {
    mountedRef.current = true
    if (acquireOwnership()) {
      void initialize()
    }

    return () => {
      mountedRef.current = false
      stopPopupWatch()
      settlePending(null)
      if (releaseOwnership()) {
        document.getElementById(MASK_ID)?.remove()
        document.getElementById(POPUP_ID)?.remove()
      }
    }
  }, [acquireOwnership, initialize, releaseOwnership, settlePending, stopPopupWatch])

  const stateContent = {
    idle: (
      <>
        {stateIcon}{labels.idle}
      </>
    ),
    verifying: (
      <>
        {stateIcon}{labels.verifying}
      </>
    ),
    verified: (
      <>
        {stateIcon}{labels.verified}
      </>
    ),
  }[state]

  return (
    <div className="key-field" data-state={state}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        onClick={handleTriggerClick}
        disabled={state === 'verified'}
        data-state={state}
        data-aliyun-captcha=""
      >
        {stateContent}
      </button>
      <div id={elementId} />
    </div>
  )
})

export default AliyunCaptcha
