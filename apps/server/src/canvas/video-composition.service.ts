import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import type {
  VideoCompositionExportRequest,
  VideoCompositionExportTrack,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { UploadService } from '../upload/upload.service'

const execFileAsync = promisify(execFile)

const OUTPUT_WIDTH = 1280
const OUTPUT_HEIGHT = 720
const OUTPUT_FPS = 25

@Injectable()
export class VideoCompositionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UploadService) private readonly uploadService: UploadService,
  ) {}

  async exportComposition(userId: string, dto: VideoCompositionExportRequest) {
    await this.assertSession(dto.sessionId)
    const tracks = (dto.tracks ?? []).filter((track) => track.url?.trim())
    if (!tracks.length) {
      throw new BadRequestException('没有可合成的媒体轨，请先连接 video / audio 节点')
    }

    const workDir = join(tmpdir(), `lnkpi-compose-${randomUUID()}`)
    await mkdir(workDir, { recursive: true })

    try {
      const segments: string[] = []
      let timelineCursor = 0

      for (const [index, track] of tracks.entries()) {
        const durationSec = this.normalizeDuration(track.durationSec)
        const startSec = track.startSec && track.startSec > 0 ? track.startSec : timelineCursor
        if (startSec > timelineCursor) {
          segments.push(await this.createGapSegment(workDir, startSec - timelineCursor, index))
        }

        const sourcePath = await this.downloadTrack(workDir, track, index)
        segments.push(await this.buildSegment(workDir, track, sourcePath, durationSec, index))
        timelineCursor = startSec + durationSec
      }

      const outputPath = join(workDir, 'composed.mp4')
      await this.concatSegments(workDir, segments, outputPath)
      const outputBuffer = await readFile(outputPath)
      const saved = await this.uploadService.saveUserFile(
        userId,
        outputBuffer,
        `${dto.title?.trim() || 'composition'}.mp4`,
        'video/mp4',
      )

      return {
        compositionNodeId: dto.compositionNodeId,
        url: saved.url,
        durationSec: Math.round(timelineCursor * 10) / 10,
        status: 'completed' as const,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '合成失败'
      if (message.includes('ENOENT') && message.includes('ffmpeg')) {
        throw new InternalServerErrorException('服务器未安装 ffmpeg，暂无法导出合成视频')
      }
      throw new InternalServerErrorException(message)
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async assertSession(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('画布不存在')
    return session
  }

  private normalizeDuration(value: number | undefined) {
    const sec = Number(value)
    if (!Number.isFinite(sec) || sec <= 0) return 3
    return Math.min(120, Math.max(0.5, sec))
  }

  private resolveMediaUrl(url: string) {
    const trimmed = url.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
    const base = process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:3001'
    if (trimmed.startsWith('/')) return `${base}${trimmed}`
    return trimmed
  }

  private extFromUrl(url: string, fallback: string) {
    const clean = url.split('?')[0] ?? url
    const match = clean.match(/\.([a-z0-9]{2,5})$/i)
    return match ? `.${match[1].toLowerCase()}` : fallback
  }

  private async downloadTrack(workDir: string, track: VideoCompositionExportTrack, index: number) {
    const resolved = this.resolveMediaUrl(track.url)
    const response = await fetch(resolved)
    if (!response.ok) {
      throw new BadRequestException(`无法下载素材：${track.title || track.nodeId}`)
    }
    const ext = this.extFromUrl(resolved, track.type === 'audio' ? '.mp3' : '.mp4')
    const dest = join(workDir, `source-${index}${ext}`)
    await writeFile(dest, Buffer.from(await response.arrayBuffer()))
    return dest
  }

  private async buildSegment(
    workDir: string,
    track: VideoCompositionExportTrack,
    sourcePath: string,
    durationSec: number,
    index: number,
  ) {
    const outputPath = join(workDir, `segment-${index}.mp4`)
    if (track.type === 'audio') {
      await this.runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=${OUTPUT_FPS}`,
        '-i',
        sourcePath,
        '-t',
        String(durationSec),
        '-vf',
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-shortest',
        outputPath,
      ])
      return outputPath
    }

    await this.runFfmpeg([
      '-y',
      '-i',
      sourcePath,
      '-t',
      String(durationSec),
      '-vf',
      `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUTPUT_FPS}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-ar',
      '44100',
      '-ac',
      '2',
      outputPath,
    ])
    return outputPath
  }

  private async createGapSegment(workDir: string, durationSec: number, index: number) {
    const outputPath = join(workDir, `gap-${index}.mp4`)
    await this.runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=${OUTPUT_FPS}`,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      String(durationSec),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-shortest',
      outputPath,
    ])
    return outputPath
  }

  private async concatSegments(workDir: string, segments: string[], outputPath: string) {
    const listPath = join(workDir, 'concat.txt')
    const listBody = segments.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join('\n')
    await writeFile(listPath, listBody, 'utf8')
    await this.runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputPath,
    ])
  }

  private async runFfmpeg(args: string[]) {
    await execFileAsync('ffmpeg', args, { maxBuffer: 20 * 1024 * 1024 })
  }
}
