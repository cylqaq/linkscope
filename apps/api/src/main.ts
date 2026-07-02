import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

function isPrivateLanHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const webUrl = process.env.WEB_URL || 'http://localhost:3000'
  const corsExtra = (process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const staticAllow = new Set([
    webUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    ...corsExtra,
  ])

  const dev = process.env.NODE_ENV !== 'production'

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (staticAllow.has(origin)) return cb(null, true)
      if (dev) {
        try {
          const { hostname, protocol } = new URL(origin)
          if ((protocol === 'http:' || protocol === 'https:') && isPrivateLanHostname(hostname)) {
            return cb(null, true)
          }
        } catch {
          /* ignore */
        }
      }
      return cb(null, false)
    },
    credentials: true,
  })
  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
  )

  const port = process.env.PORT || 3001
  await app.listen(port)
  console.log(`LinkScope API running on http://localhost:${port}/api`)
}

bootstrap()