import { Body, Controller, Post } from '@nestjs/common';
import { LoadsService } from './loads.service';
import { IngestLoadsDto } from './dto/ingest.dto';

@Controller('loads')
export class LoadsController {
  constructor(private readonly service: LoadsService) {}

  @Post()
  ingest(@Body() dto: IngestLoadsDto) {
    return this.service.ingest(dto);
  }
}
