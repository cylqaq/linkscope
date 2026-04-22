import { Module } from '@nestjs/common'
import { HttpProbeService } from './http-probe.service'
import { BrowserProbeService } from './browser-probe.service'

@Module({
  providers: [HttpProbeService, BrowserProbeService],
  exports: [HttpProbeService, BrowserProbeService],
})
export class ProbeModule {}
