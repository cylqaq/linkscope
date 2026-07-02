import { Module } from '@nestjs/common'
import { HttpProbeService } from './http-probe.service'
import { BrowserProbeService } from './browser-probe.service'
import { SmartWaitService } from './smart-wait.service'
import { AntiDetectionService } from './anti-detection.service'
import { RateLimiterService } from './rate-limiter.service'
import { ScreenHintsModule } from '../screen-hints/screen-hints.module'

@Module({
  imports: [ScreenHintsModule],
  providers: [
    HttpProbeService,
    BrowserProbeService,
    SmartWaitService,
    AntiDetectionService,
    RateLimiterService,
  ],
  exports: [
    HttpProbeService,
    BrowserProbeService,
    SmartWaitService,
    AntiDetectionService,
    RateLimiterService,
  ],
})
export class ProbeModule {}
