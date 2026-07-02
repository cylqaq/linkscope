import { Module } from '@nestjs/common'
import { LinkScopeMcpServer } from './mcp-server'
import { TasksModule } from '../tasks/tasks.module'
import { ExportModule } from '../export/export.module'
import { ProbeModule } from '../probe/probe.module'
import { ScreenHintsModule } from '../screen-hints/screen-hints.module'

@Module({
  imports: [TasksModule, ExportModule, ProbeModule, ScreenHintsModule],
  providers: [LinkScopeMcpServer],
  exports: [LinkScopeMcpServer],
})
export class McpModule {}