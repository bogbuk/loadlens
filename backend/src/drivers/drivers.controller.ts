import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProGuard } from './pro.guard';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@UseGuards(JwtAuthGuard, ProGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly service: DriversService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(req.user.userId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateDriverDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateDriverDto) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
