import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LinkScope - 链接有效性检测',
  description: '批量检测链接是否仍然有效，支持全平台内容识别',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#0f1117] text-white antialiased">{children}</body>
    </html>
  )
}
