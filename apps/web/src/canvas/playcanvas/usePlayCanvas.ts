import * as pc from 'playcanvas'

export interface PlayCanvasNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
}

const TYPE_COLORS: Record<string, pc.Color> = {
  shot: new pc.Color(0.39, 0.4, 0.95),
  image: new pc.Color(0.2, 0.75, 0.55),
  video: new pc.Color(0.95, 0.45, 0.35),
  text: new pc.Color(0.55, 0.55, 0.65),
  prompt: new pc.Color(0.45, 0.45, 0.55),
}

function nodeColor(type?: string) {
  return TYPE_COLORS[type ?? 'prompt'] ?? TYPE_COLORS.prompt
}

export function createPlayCanvasScene(canvas: HTMLCanvasElement, nodes: PlayCanvasNode[]) {
  const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { alpha: false, antialias: true },
  })

  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW)
  app.setCanvasResolution(pc.RESOLUTION_AUTO)
  app.start()

  const camera = new pc.Entity('camera')
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.08, 0.08, 0.08),
    fov: 45,
  })
  camera.setPosition(0, 12, 18)
  camera.lookAt(0, 0, 0)
  app.root.addChild(camera)

  const light = new pc.Entity('light')
  light.addComponent('light', { type: 'directional', intensity: 1.2 })
  light.setEulerAngles(55, 35, 0)
  app.root.addChild(light)

  const ambient = new pc.Entity('ambient')
  ambient.addComponent('light', { type: 'ambient', intensity: 0.35 })
  app.root.addChild(ambient)

  const ground = new pc.Entity('ground')
  ground.addComponent('render', { type: 'plane' })
  ground.setLocalScale(40, 1, 40)
  const groundMat = new pc.StandardMaterial()
  groundMat.diffuse = new pc.Color(0.12, 0.12, 0.14)
  groundMat.update()
  ground.render!.meshInstances[0].material = groundMat
  app.root.addChild(ground)

  const nodeEntities = new Map<string, pc.Entity>()

  function syncNodes(nextNodes: PlayCanvasNode[]) {
    const seen = new Set<string>()
    for (const node of nextNodes) {
      seen.add(node.id)
      let entity = nodeEntities.get(node.id)
      if (!entity) {
        entity = new pc.Entity(node.id)
        entity.addComponent('render', { type: 'box' })
        const mat = new pc.StandardMaterial()
        mat.diffuse = nodeColor(node.type)
        mat.emissive = nodeColor(node.type).clone()
        mat.emissive.mulScalar(0.15)
        mat.update()
        entity.render!.meshInstances[0].material = mat
        app.root.addChild(entity)
        nodeEntities.set(node.id, entity)
      }
      const scale = node.type === 'shot' ? 1.2 : 0.8
      entity.setLocalScale(scale, scale * 0.6, scale)
      entity.setLocalPosition(node.position.x / 80, scale * 0.3, node.position.y / 80)
    }
    for (const [id, entity] of nodeEntities) {
      if (!seen.has(id)) {
        entity.destroy()
        nodeEntities.delete(id)
      }
    }
  }

  syncNodes(nodes)

  let dragging = false
  let lastX = 0
  let lastY = 0
  let orbitYaw = 35
  let orbitPitch = 25
  let orbitDist = 22

  function updateCamera() {
    const yawRad = orbitYaw * pc.math.DEG_TO_RAD
    const pitchRad = orbitPitch * pc.math.DEG_TO_RAD
    const x = Math.sin(yawRad) * Math.cos(pitchRad) * orbitDist
    const y = Math.sin(pitchRad) * orbitDist
    const z = Math.cos(yawRad) * Math.cos(pitchRad) * orbitDist
    camera.setPosition(x, y, z)
    camera.lookAt(0, 0, 0)
  }

  updateCamera()

  canvas.addEventListener('mousedown', (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
  })
  window.addEventListener('mouseup', () => { dragging = false })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    orbitYaw += (e.clientX - lastX) * 0.3
    orbitPitch = pc.math.clamp(orbitPitch + (e.clientY - lastY) * 0.3, 5, 80)
    lastX = e.clientX
    lastY = e.clientY
    updateCamera()
  })
  canvas.addEventListener('wheel', (e) => {
    orbitDist = pc.math.clamp(orbitDist + e.deltaY * 0.02, 8, 40)
    updateCamera()
  }, { passive: true })

  return { app, syncNodes, destroy: () => app.destroy() }
}
