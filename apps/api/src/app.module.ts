import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bull'
import { PrismaModule } from './prisma/prisma.module'
import { TasksModule } from './tasks/tasks.module'
import { ProbeModule } from './probe/probe.module'
import { ClassifyModule } from './classify/classify.module'
import { AiModule } from './ai/ai.module'
import { ExportModule } from './export/export.module'
import { ScreenHintsModule } from './screen-hints/screen-hints.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    PrismaModule,
    TasksModule,
    ProbeModule,
    ClassifyModule,
    AiModule,
    ExportModule,
    ScreenHintsModule,
  ],
})
export class AppModule {}