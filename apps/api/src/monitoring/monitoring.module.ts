import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { MetricsService } from './metrics.service'
import { HealthController } from './health.controller'
import { ProbeModule } from '../probe/probe.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [
    PrismaModule,
    ProbeModule,
    BullModule.registerQueue({
      name: 'probe',
    }),
  ],
  controllers: [HealthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MonitoringModule {}
