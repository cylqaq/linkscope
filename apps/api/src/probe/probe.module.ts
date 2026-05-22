import { Module } from '@nestjs/common'
import { HttpProbeService } from './http-probe.service'
import { BrowserProbeService } from './browser-probe.service'
import { ScreenHintsModule } from '../screen-hints/screen-hints.module'

@Module({
  imports: [ScreenHintsModule],
  providers: [HttpProbeService, BrowserProbeService],
  exports: [HttpProbeService, BrowserProbeService],
})
export class ProbeModule {}
