import { ref, onUnmounted } from 'vue'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition() {
  const supported = !!getSpeechRecognition()
  const listening = ref(false)
  let recognition: SpeechRecognitionLike | null = null

  function stop() {
    recognition?.stop()
    recognition = null
    listening.value = false
  }

  function start(onTranscript: (text: string, isFinal: boolean) => void) {
    const Ctor = getSpeechRecognition()
    if (!Ctor) return false

    stop()
    recognition = new Ctor()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += chunk
        else interim += chunk
      }
      if (finalText) onTranscript(finalText, true)
      else if (interim) onTranscript(interim, false)
    }

    recognition.onerror = () => stop()
    recognition.onend = () => { listening.value = false }

    recognition.start()
    listening.value = true
    return true
  }

  onUnmounted(stop)

  return { supported, listening, start, stop }
}
