import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { isScreenHintPlatformSlug } from '@linkscope/shared'

const PHRASE_MIN = 2
const PHRASE_MAX = 400
const CACHE_MS = 30_000

export type ScreenHintRow = {
  id: string
  platform: string
  phrase: string
  note: string | null
  enabled: boolean
  caseSensitive: boolean
  hitCount: number
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class ScreenHintsService {
  private cache: { rows: ScreenHintRow[]; until: number } = { rows: [], until: 0 }

  constructor(private readonly prisma: PrismaService) {}

  invalidateCache() {
    this.cache.until = 0
  }

  /** L2 探测用：仅启用的规则，按 phrase 长度降序（优先匹配更长提示） */
  async getHintsForProbe(platformKey: string): Promise<{ id: string; phrase: string; caseSensitive: boolean }[]> {
    const rows = await this.loadEnabledCached()
    return rows
      .filter(h => h.platform === platformKey || h.platform === 'generic')
      .sort((a, b) => b.phrase.length - a.phrase.length)
      .map(h => ({ id: h.id, phrase: h.phrase, caseSensitive: h.caseSensitive }))
  }

  async list(platform?: string) {
    return this.prisma.screenHint.findMany({
      where: platform ? { platform } : {},
      orderBy: [{ platform: 'asc' }, { updatedAt: 'desc' }],
    })
  }

  async create(input: { platform: string; phrase: string; note?: string | null; caseSensitive?: boolean }) {
    const platform = input.platform.trim()
    if (!isScreenHintPlatformSlug(platform)) {
      throw new BadRequestException(`无效的平台标识: ${platform}`)
    }
    const phrase = input.phrase.trim()
    if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) {
      throw new BadRequestException(`提示文案长度须在 ${PHRASE_MIN}-${PHRASE_MAX} 字符之间`)
    }
    const row = await this.prisma.screenHint.create({
      data: {
        platform,
        phrase,
        note: input.note?.trim() || null,
        caseSensitive: !!input.caseSensitive,
      },
    })
    this.invalidateCache()
    return row
  }

  async update(
    id: string,
    patch: Partial<{ phrase: string; note: string | null; enabled: boolean; caseSensitive: boolean; platform: string }>,
  ) {
    const existing = await this.prisma.screenHint.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('规则不存在')

    if (patch.platform !== undefined) {
      const p = patch.platform.trim()
      if (!isScreenHintPlatformSlug(p)) throw new BadRequestException(`无效的平台标识: ${p}`)
    }
    if (patch.phrase !== undefined) {
      const phrase = patch.phrase.trim()
      if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) {
        throw new BadRequestException(`提示文案长度须在 ${PHRASE_MIN}-${PHRASE_MAX} 字符之间`)
      }
    }

    const row = await this.prisma.screenHint.update({
      where: { id },
      data: {
        ...(patch.platform !== undefined ? { platform: patch.platform.trim() } : {}),
        ...(patch.phrase !== undefined ? { phrase: patch.phrase.trim() } : {}),
        ...(patch.note !== undefined ? { note: patch.note === null ? null : patch.note.trim() || null } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.caseSensitive !== undefined ? { caseSensitive: patch.caseSensitive } : {}),
      },
    })
    this.invalidateCache()
    return row
  }

  async remove(id: string) {
    try {
      await this.prisma.screenHint.delete({ where: { id } })
    } catch {
      throw new NotFoundException('规则不存在')
    }
    this.invalidateCache()
  }

  /**
   * 批量导入：跳过非法行、与库内 (platform, phrase) 完全重复的行。
   * 支持 body 为 `{ items: [...] }` 或导出格式 `{ hints: [...] }`。
   */
  async importMany(raw: unknown[]): Promise<{ created: number; skipped: number }> {
    if (!Array.isArray(raw)) {
      throw new BadRequestException('items 须为数组')
    }
    let created = 0
    let skipped = 0

    for (const row of raw) {
      const normalized = this.tryNormalizeImportRow(row)
      if (!normalized) {
        skipped++
        continue
      }
      const dup = await this.prisma.screenHint.findFirst({
        where: { platform: normalized.platform, phrase: normalized.phrase },
      })
      if (dup) {
        skipped++
        continue
      }
      try {
        await this.prisma.screenHint.create({ data: normalized })
        created++
      } catch {
        skipped++
      }
    }

    this.invalidateCache()
    return { created, skipped }
  }

  private tryNormalizeImportRow(
    row: unknown,
  ): { platform: string; phrase: string; note: string | null; caseSensitive: boolean } | null {
    if (!row || typeof row !== 'object') return null
    const o = row as Record<string, unknown>
    if (typeof o.platform !== 'string' || typeof o.phrase !== 'string') return null
    const platform = o.platform.trim()
    if (!isScreenHintPlatformSlug(platform)) return null
    const phrase = o.phrase.trim()
    if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) return null
    const note =
      typeof o.note === 'string' ? (o.note.trim() || null) : null
    return {
      platform,
      phrase,
      note,
      caseSensitive: !!o.caseSensitive,
    }
  }

  private async loadEnabledCached(): Promise<ScreenHintRow[]> {
    const now = Date.now()
    if (now < this.cache.until) {
      return this.cache.rows
    }
    const rows = await this.prisma.screenHint.findMany({
      where: { enabled: true },
    })
    this.cache = { rows: rows as ScreenHintRow[], until: now + CACHE_MS }
    return this.cache.rows
  }
}
