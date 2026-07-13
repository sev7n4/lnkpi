import { onMounted, ref } from 'vue'
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS, type AIModel, type GenerationType } from '@lnkpi/shared'
import { capabilitiesApi } from '@/services/capabilities-api'

const cache = ref<Record<GenerationType, AIModel[]>>({
  text: [...TEXT_MODELS],
  image: [...IMAGE_MODELS],
  video: [...VIDEO_MODELS],
})

let loaded = false

export function useCapabilities() {
  const loading = ref(false)

  async function load() {
    if (loaded) return
    loading.value = true
    try {
      const { data } = await capabilitiesApi.list()
      cache.value = {
        text: data.data.text?.length ? data.data.text : TEXT_MODELS,
        image: data.data.image?.length ? data.data.image : IMAGE_MODELS,
        video: data.data.video?.length ? data.data.video : VIDEO_MODELS,
      }
      loaded = true
    } catch {
      // fallback to shared defaults
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    void load()
  })

  function modelsFor(type: GenerationType): AIModel[] {
    return cache.value[type]
  }

  return { loading, modelsFor, reload: load }
}
