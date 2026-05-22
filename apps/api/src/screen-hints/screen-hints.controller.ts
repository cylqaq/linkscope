import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ScreenHintsService } from './screen-hints.service'

@Controller('screen-hints')
export class ScreenHintsController {
  constructor(private readonly screenHints: ScreenHintsService) {}

  @Get()
  list(@Query('platform') platform?: string) {
    return this.screenHints.list(platform?.trim() || undefined)
  }

  @Post()
  create(
    @Body()
    body: {
      platform: string
      phrase: string
      note?: string
      caseSensitive?: boolean
    },
  ) {
    return this.screenHints.create(body)
  }

  /** 批量导入 JSON（items 或 hints 键，数组元素同单条 create 字段） */
  @Post('import')
  importBatch(
    @Body()
    body: {
      items?: unknown[]
      hints?: unknown[]
    },
  ) {
    const items = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.hints)
        ? body.hints
        : null
    if (!items) {
      throw new BadRequestException('请提供 items 或 hints 数组')
    }
    return this.screenHints.importMany(items)
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      phrase?: string
      note?: string | null
      enabled?: boolean
      caseSensitive?: boolean
      platform?: string
    },
  ) {
    return this.screenHints.update(id, body)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.screenHints.remove(id)
    return { ok: true }
  }
}
