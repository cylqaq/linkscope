import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { ProbeModule } from '../probe/probe.module'

@Module({
  imports: [ProbeModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
