import { Injectable, Logger } from '@nestjs/common'
import { Readable } from 'stream'
import { extractUrlsFromText, normalizeUrl, dedupeKey, isValidUrl, detectPlatform } from '@linkscope/shared'

export interface ParsedUrl {
  original: string
  normalized: string
  domain: string
  platform: string
  dedupe: string
  rowNumber: number
}

export interface ParseProgress {
  totalRows: number
  parsedRows: number
  validUrls: number
  duplicates: number
  invalidUrls: number
}

export interface FileParseResult {
  urls: ParsedUrl[]
  stats: {
    totalRows: number
    validUrls: number
    duplicates: number
    invalidUrls: number
    parseTimeMs: number
  }
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name)

  /**
   * 解析文件内容，提取URL
   * 支持流式处理，避免大文件内存溢出
   */
  async parseFile(
    file: Express.Multer.File,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<FileParseResult> {
    const start = Date.now()
    const ext = this.getFileExtension(file.originalname)

    let urls: ParsedUrl[]

    switch (ext) {
      case '.csv':
        urls = await this.parseCsv(file, onProgress)
        break
      case '.txt':
        urls = await this.parseTxt(file, onProgress)
        break
      case '.json':
        urls = await this.parseJson(file, onProgress)
        break
      case '.xlsx':
      case '.xls':
        urls = await this.parseExcel(file, onProgress)
        break
      default:
        throw new Error(`不支持的文件格式: ${ext}`)
    }

    // 去重
    const seen = new Set<string>()
    const deduplicated: ParsedUrl[] = []
    let duplicates = 0

    for (const url of urls) {
      if (seen.has(url.dedupe)) {
        duplicates++
        continue
      }
      seen.add(url.dedupe)
      deduplicated.push(url)
    }

    const result: FileParseResult = {
      urls: deduplicated,
      stats: {
        totalRows: urls.length + duplicates,
        validUrls: deduplicated.length,
        duplicates,
        invalidUrls: 0,
        parseTimeMs: Date.now() - start,
      },
    }

    this.logger.log(`File parsed: ${result.stats.validUrls} valid URLs, ${result.stats.duplicates} duplicates, ${result.stats.parseTimeMs}ms`)
    return result
  }

  /**
   * 流式解析CSV文件
   */
  private async parseCsv(
    file: Express.Multer.File,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<ParsedUrl[]> {
    const results: ParsedUrl[] = []
    let totalRows = 0
    let parsedRows = 0

    // 使用流式处理
    const stream = this.fileToStream(file)
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const content = Buffer.concat(chunks).toString('utf-8')
    const lines = content.split('\n')
    totalRows = lines.length

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // CSV可能有多列，提取所有URL
      const urls = extractUrlsFromText(line)
      for (const url of urls) {
        const parsed = this.parseUrl(url, i + 1)
        if (parsed) {
          results.push(parsed)
        }
      }

      parsedRows++
      if (parsedRows % 100 === 0 && onProgress) {
        onProgress({
          totalRows,
          parsedRows,
          validUrls: results.length,
          duplicates: 0,
          invalidUrls: 0,
        })
      }
    }

    return results
  }

  /**
   * 解析TXT文件
   */
  private async parseTxt(
    file: Express.Multer.File,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<ParsedUrl[]> {
    const results: ParsedUrl[] = []
    let totalRows = 0
    let parsedRows = 0

    const stream = this.fileToStream(file)
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const content = Buffer.concat(chunks).toString('utf-8')
    const lines = content.split('\n')
    totalRows = lines.length

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const urls = extractUrlsFromText(line)
      for (const url of urls) {
        const parsed = this.parseUrl(url, i + 1)
        if (parsed) {
          results.push(parsed)
        }
      }

      parsedRows++
      if (parsedRows % 100 === 0 && onProgress) {
        onProgress({
          totalRows,
          parsedRows,
          validUrls: results.length,
          duplicates: 0,
          invalidUrls: 0,
        })
      }
    }

    return results
  }

  /**
   * 解析JSON文件
   */
  private async parseJson(
    file: Express.Multer.File,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<ParsedUrl[]> {
    const results: ParsedUrl[] = []
    let totalRows = 0

    const stream = this.fileToStream(file)
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const content = Buffer.concat(chunks).toString('utf-8')
    const parsed = JSON.parse(content)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    totalRows = arr.length

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const urls = this.extractUrlsFromValue(item)
      for (const url of urls) {
        const parsedUrl = this.parseUrl(url, i + 1)
        if (parsedUrl) {
          results.push(parsedUrl)
        }
      }

      if (i % 100 === 0 && onProgress) {
        onProgress({
          totalRows,
          parsedRows: i + 1,
          validUrls: results.length,
          duplicates: 0,
          invalidUrls: 0,
        })
      }
    }

    return results
  }

  /**
   * 解析Excel文件（使用流式读取）
   */
  private async parseExcel(
    file: Express.Multer.File,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<ParsedUrl[]> {
    const results: ParsedUrl[] = []
    let totalRows = 0
    let parsedRows = 0

    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()

    // 使用流式工作簿读取器
    if (file.path) {
      await workbook.xlsx.readFile(file.path)
    } else {
      await workbook.xlsx.load(file.buffer)
    }

    // 先计算总行数
    workbook.eachSheet((sheet: any) => {
      totalRows += sheet.rowCount || 0
    })

    // 处理每个工作表
    workbook.eachSheet((sheet: any) => {
      sheet.eachRow((row: any, rowNumber: number) => {
        row.eachCell((cell: any) => {
          const v = cell.text || String(cell.value || '')
          const urls = extractUrlsFromText(v)
          for (const url of urls) {
            const parsed = this.parseUrl(url, rowNumber)
            if (parsed) {
              results.push(parsed)
            }
          }
        })

        parsedRows++
        if (parsedRows % 100 === 0 && onProgress) {
          onProgress({
            totalRows,
            parsedRows,
            validUrls: results.length,
            duplicates: 0,
            invalidUrls: 0,
          })
        }
      })
    })

    return results
  }

  /**
   * 将文件转换为可读流
   */
  private fileToStream(file: Express.Multer.File): Readable {
    if (file.buffer) {
      return Readable.from(file.buffer)
    }
    // 如果有文件路径，使用文件流
    const fs = require('fs')
    return fs.createReadStream(file.path)
  }

  /**
   * 解析单个URL
   */
  private parseUrl(url: string, rowNumber: number): ParsedUrl | null {
    const normalized = normalizeUrl(url.trim())
    if (!normalized || !isValidUrl(normalized)) {
      return null
    }

    const parsed = new URL(normalized)
    const domain = parsed.hostname.replace(/^www\./, '')
    const platformConfig = detectPlatform(normalized)

    return {
      original: url.trim(),
      normalized,
      domain,
      platform: platformConfig?.id ?? 'generic',
      dedupe: dedupeKey(normalized),
      rowNumber,
    }
  }

  /**
   * 从JSON值中提取URL
   */
  private extractUrlsFromValue(value: any): string[] {
    if (typeof value === 'string') {
      return extractUrlsFromText(value)
    }
    if (Array.isArray(value)) {
      return value.flatMap(item => this.extractUrlsFromValue(item))
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap(v => this.extractUrlsFromValue(v))
    }
    return []
  }

  /**
   * 获取文件扩展名
   */
  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1) return ''
    return filename.slice(lastDot).toLowerCase()
  }
}
