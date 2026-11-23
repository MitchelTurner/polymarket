import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { HistoryController } from './history.controller';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [HistoryController, AdminController],
  providers: [PrismaService],
})
export class AppModule {}
