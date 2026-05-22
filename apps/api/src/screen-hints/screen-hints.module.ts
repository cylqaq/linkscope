import { Module } from '@nestjs/common'
import { ScreenHintsController } from './screen-hints.controller'
import { ScreenHintsService } from './screen-hints.service'

@Module({
  controllers: [ScreenHintsController],
  providers: [ScreenHintsService],
  exports: [ScreenHintsService],
})
export class ScreenHintsModule {}
