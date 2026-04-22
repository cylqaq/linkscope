import { Module } from '@nestjs/common'
import { ClassifyService } from './classify.service'
import { AiModule } from '../ai/ai.module'

@Module({
  imports: [AiModule],
  providers: [ClassifyService],
  exports: [ClassifyService],
})
export class ClassifyModule {}
