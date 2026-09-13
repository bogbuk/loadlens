import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { AdminService } from './admin.service';
import { SetBlockedDto, SetCloudDto, SetPlanDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('users')
  users(@Query('q') q?: string) {
    return this.service.listUsers(q);
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Patch('users/:email/plan')
  setPlan(@Param('email') email: string, @Body() dto: SetPlanDto) {
    return this.service.setPlan(email, dto.plan);
  }

  @Patch('users/:email/block')
  setBlocked(@Param('email') email: string, @Body() dto: SetBlockedDto) {
    return this.service.setBlocked(email, dto.blocked);
  }

  @Patch('users/:email/cloud')
  setCloud(@Param('email') email: string, @Body() dto: SetCloudDto) {
    return this.service.setCloudEnabled(email, dto.enabled);
  }
}
