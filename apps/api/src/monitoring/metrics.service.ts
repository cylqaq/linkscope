import { Injectable, Logger } from '@nestjs/common'

export interface Metric {
  name: string
  value: number
  labels: Record<string, string>
  timestamp: number
}

export interface HistogramMetric {
  name: string
  buckets: Map<number, number>
  sum: number
  count: number
  labels: Record<string, string>
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name)
  private readonly metrics: Map<string, Metric> = new Map()
  private readonly histograms: Map<string, HistogramMetric> = new Map()
  private readonly counters: Map<string, Map<string, number>> = new Map()

  /**
   * 设置 Gauge 指标
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels)
    this.metrics.set(key, {
      name,
      value,
      labels,
      timestamp: Date.now(),
    })
  }

  /**
   * 增加 Counter 指标
   */
  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels)
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map())
    }
    const counter = this.counters.get(name)!
    const currentValue = counter.get(key) || 0
    counter.set(key, currentValue + 1)
  }

  /**
   * 记录 Histogram 指标
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels)
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        name,
        buckets: new Map(),
        sum: 0,
        count: 0,
        labels,
      })
    }
    const histogram = this.histograms.get(key)!
    histogram.sum += value
    histogram.count++

    // 更新桶计数
    const buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]
    for (const bucket of buckets) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1)
      }
    }
  }

  /**
   * 获取所有指标（Prometheus 格式）
   */
  async getMetrics(): Promise<string> {
    const lines: string[] = []

    // Gauge 指标
    for (const [key, metric] of this.metrics) {
      lines.push(`# HELP ${metric.name} ${metric.name}`)
      lines.push(`# TYPE ${metric.name} gauge`)
      const labelsStr = Object.entries(metric.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      lines.push(`${metric.name}{${labelsStr}} ${metric.value}`)
    }

    // Counter 指标
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${name}`)
      lines.push(`# TYPE ${name} counter`)
      for (const [key, value] of counter) {
        const labels = this.parseMetricKey(key)
        const labelsStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')
        lines.push(`${name}{${labelsStr}} ${value}`)
      }
    }

    // Histogram 指标
    for (const [key, histogram] of this.histograms) {
      lines.push(`# HELP ${histogram.name} ${histogram.name}`)
      lines.push(`# TYPE ${histogram.name} histogram`)
      const labelsStr = Object.entries(histogram.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')

      for (const [bucket, count] of histogram.buckets) {
        lines.push(`${histogram.name}_bucket{${labelsStr},le="${bucket}"} ${count}`)
      }
      lines.push(`${histogram.name}_bucket{${labelsStr},le="+Inf"} ${histogram.count}`)
      lines.push(`${histogram.name}_sum{${labelsStr}} ${histogram.sum}`)
      lines.push(`${histogram.name}_count{${labelsStr}} ${histogram.count}`)
    }

    return lines.join('\n')
  }

  /**
   * 记录探测延迟
   */
  recordProbeLatency(layer: 'l1' | 'l2' | 'l3', latencyMs: number, platform?: string): void {
    this.observeHistogram('linkscope_probe_duration_ms', latencyMs, {
      layer,
      platform: platform || 'unknown',
    })
  }

  /**
   * 记录探测结果
   */
  recordProbeResult(status: 'success' | 'error' | 'timeout', platform?: string): void {
    this.incrementCounter('linkscope_probe_total', {
      status,
      platform: platform || 'unknown',
    })
  }

  /**
   * 记录任务状态
   */
  recordTaskStatus(status: 'pending' | 'processing' | 'completed' | 'failed'): void {
    this.incrementCounter('linkscope_tasks_total', { status })
  }

  /**
   * 更新队列状态
   */
  updateQueueStatus(waiting: number, active: number, completed: number, failed: number): void {
    this.setGauge('linkscope_queue_waiting', waiting)
    this.setGauge('linkscope_queue_active', active)
    this.setGauge('linkscope_queue_completed', completed)
    this.setGauge('linkscope_queue_failed', failed)
  }

  /**
   * 更新浏览器池状态
   */
  updateBrowserPoolStatus(totalBrowsers: number, totalContexts: number, availableBrowsers: number): void {
    this.setGauge('linkscope_browser_pool_browsers', totalBrowsers)
    this.setGauge('linkscope_browser_pool_contexts', totalContexts)
    this.setGauge('linkscope_browser_pool_available', availableBrowsers)
  }

  /**
   * 记录 AI 调用延迟
   */
  recordAiLatency(latencyMs: number, model?: string): void {
    this.observeHistogram('linkscope_ai_duration_ms', latencyMs, {
      model: model || 'unknown',
    })
  }

  /**
   * 记录 AI Token 使用
   */
  recordAiTokenUsage(promptTokens: number, completionTokens: number, model?: string): void {
    this.incrementCounter('linkscope_ai_tokens_total', {
      type: 'prompt',
      model: model || 'unknown',
    })
    this.incrementCounter('linkscope_ai_tokens_total', {
      type: 'completion',
      model: model || 'unknown',
    })
  }

  /**
   * 获取指标键
   */
  private getMetricKey(name: string, labels: Record<string, string>): string {
    const labelEntries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    return `${name}:${labelEntries.map(([k, v]) => `${k}=${v}`).join(',')}`
  }

  /**
   * 解析指标键
   */
  private parseMetricKey(key: string): Record<string, string> {
    const labels: Record<string, string> = {}
    const parts = key.split(':')
    if (parts.length > 1) {
      const labelPart = parts.slice(1).join(':')
      labelPart.split(',').forEach(pair => {
        const [k, v] = pair.split('=')
        if (k && v) {
          labels[k] = v
        }
      })
    }
    return labels
  }
}