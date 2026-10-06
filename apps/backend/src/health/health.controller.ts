import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface HealthBody {
  data: { status: string };
}

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  // Liveness never touches the database: a database outage must not make the process look dead.
  @Get('live')
  live(): HealthBody {
    return { data: { status: 'ok' } };
  }

  @Get('ready')
  async ready(): Promise<HealthBody> {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException();
    }
    return { data: { status: 'ready' } };
  }
}
