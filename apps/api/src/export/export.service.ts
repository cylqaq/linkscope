import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const STATUS_LABEL: Record<string, string> = {
  accessible: '正常可访问',
  dead_link: '失效链接',
  review_required: '需复核',
}

const REASON_LABEL: Record<string, string> = {
  http_200_ok: 'HTTP 200 正常',
  http_404: '404 页面不存在',
  http_410: '410 已永久删除',
  http_451: '451 法律限制',
  auth_401: '需要登录',
  auth_403: '无权限',
  soft_404_text: '软 404（文本）',
  soft_404_ai: '软 404（AI）',
  user_screen_hint: '自定义屏幕提示（下架/失效）',
  network_json_removed: '接口节选（下架/删除）',
  removed_pattern: '平台下架',
  video_removed: '视频已删除',
  account_private: '账号私密',
  account_banned: '账号封禁',
  region_restricted: '地区限制',
  content_deleted: '内容删除',
  timeout: '连接超时',
  dns_failed: 'DNS 解析失败',
  ssl_error: 'SSL 错误',
  connection_refused: '服务器拒绝连接',
  connection_reset: '连接被重置',
  connection_closed: '连接被关闭',
  unreachable: '主机不可达',
  blocked_by_waf: 'WAF 拦截',
  redirect_to_home: '跳转到首页',
  redirect_to_error: '跳转到错误页',
  platform_detected: '平台校验',
  unknown: '未知',
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportTask(
    taskId: string,
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const rows = await this.fetchRows(taskId)
    if (format === 'csv') return this.toCsv(rows, taskId)
    return this.toXlsx(rows, taskId)
  }

  private async fetchRows(taskId: string) {
    return this.prisma.taskUrl.findMany({
      where: { taskId },
      include: {
        classification: {
          select: {
            finalStatus: true,
            reasonCode: true,
            confidence: true,
            sourceOfTruth: true,
            evidence: true,
          },
        },
        httpProbe: { select: { statusCode: true, finalUrl: true, latencyMs: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  private displayFinalUrl(r: any): string {
    const ev = r.classification?.evidence
    if (ev && typeof ev === 'object' && typeof ev.finalUrl === 'string' && ev.finalUrl.length > 0) {
      return ev.finalUrl
    }
    return r.httpProbe?.finalUrl ?? '-'
  }

  private displayVerifiedBy(r: any): string {
    const ev = r.classification?.evidence
    const v = ev && typeof ev === 'object' ? ev.verifiedBy : null
    const map: Record<string, string> = {
      http: '直连校验',
      browser: '浏览器渲染校验',
      ai: 'AI 复核',
      rule: '规则判定',
    }
    return v ? map[v] ?? v : '-'
  }

  private toCsv(rows: any[], taskId: string) {
    const headers = [
      '序号', '原始URL', '结果', '原因', '置信度', 'HTTP状态码', '最终URL', '校验方式', '响应时间(ms)', '判定来源',
    ]
    const lines = [headers.join(',')]

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const c = r.classification
      const h = r.httpProbe
      const cells = [
        i + 1,
        '"' + r.originalUrl.replace(/"/g, '""') + '"',
        STATUS_LABEL[c?.finalStatus] ?? c?.finalStatus ?? '-',
        REASON_LABEL[c?.reasonCode] ?? c?.reasonCode ?? '-',
        c ? Math.round(c.confidence * 100) + '%' : '-',
        h?.statusCode ?? '-',
        '"' + this.displayFinalUrl(r).replace(/"/g, '""') + '"',
        this.displayVerifiedBy(r),
        h?.latencyMs ?? '-',
        c?.sourceOfTruth ?? '-',
      ]
      lines.push(cells.join(','))
    }

    const bom = '\uFEFF'
    const data = Buffer.from(bom + lines.join('\n'), 'utf-8')
    return { data, filename: 'linkscope-' + taskId + '.csv', mimeType: 'text/csv;charset=utf-8' }
  }

  private async toXlsx(rows: any[], taskId: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('检测结果')

    sheet.columns = [
      { header: '序号', key: 'index', width: 6 },
      { header: '原始URL', key: 'url', width: 50 },
      { header: '结果', key: 'status', width: 14 },
      { header: '原因', key: 'reason', width: 24 },
      { header: '置信度', key: 'confidence', width: 8 },
      { header: 'HTTP状态码', key: 'statusCode', width: 12 },
      { header: '最终URL', key: 'finalUrl', width: 50 },
      { header: '校验方式', key: 'verifiedBy', width: 18 },
      { header: '响应时间(ms)', key: 'latency', width: 14 },
      { header: '判定来源', key: 'source', width: 14 },
    ]

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const c = r.classification
      const h = r.httpProbe
      const row = sheet.addRow({
        index: i + 1,
        url: r.originalUrl,
        status: STATUS_LABEL[c?.finalStatus] ?? c?.finalStatus ?? '-',
        reason: REASON_LABEL[c?.reasonCode] ?? c?.reasonCode ?? '-',
        confidence: c ? Math.round(c.confidence * 100) + '%' : '-',
        statusCode: h?.statusCode ?? '-',
        finalUrl: this.displayFinalUrl(r),
        verifiedBy: this.displayVerifiedBy(r),
        latency: h?.latencyMs ?? '-',
        source: c?.sourceOfTruth ?? '-',
      })

      if (c?.finalStatus === 'dead_link') {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } }
        row.getCell('status').font = { color: { argb: 'FFDC2626' } }
      } else if (c?.finalStatus === 'accessible') {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } }
        row.getCell('status').font = { color: { argb: 'FF16A34A' } }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return {
      data: Buffer.from(buffer as ArrayBuffer),
      filename: 'linkscope-' + taskId + '.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  }
}
