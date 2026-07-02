import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { HealthController } from './health.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'probe',
    }),
  ],
  controllers: [HealthController],
})
export class MonitoringModule {}
