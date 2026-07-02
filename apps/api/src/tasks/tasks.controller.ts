import {
  Controller, Post, Get, Param, Query, Body, UploadedFile,
  UseInterceptors, ParseIntPipe, DefaultValuePipe, HttpCode,
  HttpStatus, Res, NotFoundException, Sse, MessageEvent,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { Observable, Subject } from 'rxjs'
import { TasksService } from './tasks.service'
import { ExportService } from '../export/export.service'
import { extractUrlsFromText } from '@linkscope/shared'
import { TaskCreationProgress } from './tasks.service'
import * as fs from 'fs'
import * as path from 'path'

@Controller('tasks')
export class TasksController {
  // 用于SSE进度推送的Subject
  private progressSubjects = new Map<string, Subject<MessageEvent>>()

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
  @UseInterceptors(FileInterceptor('file', { 
    dest: './uploads',
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB限制
    },
  }))
  async createFromFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    if (!file) {
      throw new Error('请上传文件')
    }

    // 生成进度ID
    const progressId = `progress-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    
    // 创建SSE Subject
    const subject = new Subject<MessageEvent>()
    this.progressSubjects.set(progressId, subject)

    // 异步处理文件
    this.processFileAsync(file, name, progressId, subject)

    // 立即返回进度ID
    return {
      progressId,
      message: '文件已接收，正在处理...',
      statusUrl: `/api/tasks/progress/${progressId}`,
    }
  }

  /**
   * 异步处理文件
   */
  private async processFileAsync(
    file: Express.Multer.File,
    name: string | undefined,
    progressId: string,
    subject: Subject<MessageEvent>,
  ) {
    try {
      const result = await this.tasksService.createTaskFromFile(file, name, (progress) => {
        // 推送进度事件
        subject.next({
          data: JSON.stringify(progress),
          type: 'progress',
        })
      })

      // 推送完成事件
      subject.next({
        data: JSON.stringify({
          phase: 'completed',
          task: result.task,
          parseStats: result.parseStats,
        }),
        type: 'completed',
      })
    } catch (error) {
      // 推送错误事件
      subject.next({
        data: JSON.stringify({
          phase: 'error',
          message: error instanceof Error ? error.message : '处理失败',
        }),
        type: 'error',
      })
    } finally {
      subject.complete()
      // 清理资源
      this.progressSubjects.delete(progressId)
      // 清理上传的文件
      if (file.path) {
        fs.unlink(file.path, () => {})
      }
    }
  }

  /**
   * SSE进度推送端点
   */
  @Sse('progress/:progressId')
  getProgress(@Param('progressId') progressId: string): Observable<MessageEvent> {
    const subject = this.progressSubjects.get(progressId)
    if (!subject) {
      throw new NotFoundException('进度ID不存在或已过期')
    }
    return subject.asObservable()
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

  @Get(':id/stats')
  getTaskStats(@Param('id') id: string) {
    return this.tasksService.getTaskStats(id)
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

  /** L2 截图 JPEG（须属于该任务；路径由服务端按 taskUrlId 解析，见 D-017） */
  @Get(':id/urls/:urlId/screenshot')
  async getUrlScreenshot(
    @Param('id') taskId: string,
    @Param('urlId') taskUrlId: string,
    @Res() res: Response,
  ) {
    const abs = await this.tasksService.getScreenshotAbsolutePath(taskId, taskUrlId)
    if (!abs) throw new NotFoundException('截图不存在或未采集')
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=120')
    fs.createReadStream(abs).pipe(res)
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
