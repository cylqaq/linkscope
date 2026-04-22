import {
  Controller, Post, Get, Param, Query, Body, UploadedFile,
  UseInterceptors, ParseIntPipe, DefaultValuePipe, HttpCode,
  HttpStatus, Res,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { TasksService } from './tasks.service'
import { ExportService } from '../export/export.service'
import { extractUrlsFromText } from '@linkscope/shared'
import * as path from 'path'

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly exportService: ExportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTask(@Body() body: { urls?: string[]; text?: string; name?: string }) {
    if (body.urls?.length) {
      return this.tasksService.createTask(body.urls, body.name)
    }
    if (body.text) {
      return this.tasksService.createTaskFromText(body.text, body.name)
    }
    throw new Error('urls or text is required')
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { dest: './uploads' }))
  async createFromFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    const ext = path.extname(file.originalname).toLowerCase()
    let urls: string[] = []

    if (ext === '.txt' || ext === '.csv') {
      const content = file.buffer?.toString('utf-8') ?? require('fs').readFileSync(file.path, 'utf-8')
      urls = extractUrlsFromText(content)
    } else if (ext === '.json') {
      const content = file.buffer?.toString('utf-8') ?? require('fs').readFileSync(file.path, 'utf-8')
      const parsed = JSON.parse(content)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      urls = arr.flatMap((item: any) => {
        if (typeof item === 'string') return [item]
        return Object.values(item).filter(v => typeof v === 'string') as string[]
      })
    } else {
      // xlsx
      const ExcelJS = require('exceljs')
      const workbook = new ExcelJS.Workbook()
      if (file.path) await workbook.xlsx.readFile(file.path)
      else await workbook.xlsx.load(file.buffer)
      workbook.eachSheet((sheet: any) => {
        sheet.eachRow((row: any) => {
          row.eachCell((cell: any) => {
            const v = cell.text || String(cell.value || '')
            urls.push(...extractUrlsFromText(v))
          })
        })
      })
    }

    return this.tasksService.createTask(urls, name)
  }

  @Get()
  listTasks(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.tasksService.listTasks(page, pageSize)
  }

  @Get(':id')
  getTask(@Param('id') id: string) {
    return this.tasksService.getTaskById(id)
  }

  @Get(':id/results')
  getResults(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('finalStatus') finalStatus?: string,
    @Query('platform') platform?: string,
    @Query('reasonCode') reasonCode?: string,
  ) {
    return this.tasksService.getTaskResults(id, { page, pageSize, finalStatus, platform, reasonCode })
  }

  @Get(':id/export')
  async exportTask(
    @Param('id') id: string,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportTask(id, format)
    res.setHeader('Content-Type', result.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.send(result.data)
  }
}