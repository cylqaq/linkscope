import * as path from 'path'

/** L2 截图落盘目录；与读取接口共用，避免相对路径在不同调用点解析不一致（D-017）。 */
export function resolveScreenshotStorageDir(): string {
  const raw = process.env.SCREENSHOT_DIR?.trim()
  if (!raw) return path.resolve(process.cwd(), 'screenshots')
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw)
}
