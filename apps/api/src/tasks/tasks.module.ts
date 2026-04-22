import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { MulterModule } from '@nestjs/platform-express'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'
import { ProbeWorker } from '../workers/probe.worker'
import { ProbeModule } from '../probe/probe.module'
import { ClassifyModule } from '../classify/classify.module'
import { ExportModule } from '../export/export.module'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'probe' }),
    MulterModule.register({ dest: './uploads' }),
    ProbeModule,
    ClassifyModule,
    ExportModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, ProbeWorker],
  exports: [TasksService],
})
export class TasksModule {}