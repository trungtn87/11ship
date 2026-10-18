import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { M14_ROUTING, M14RouteClient } from './m14-route-client';

/**
 * M14 road distance and travel time. The origin comes from the validated configuration (M14_ROUTING_ORIGIN); without it every route answer is
 * "unavailable" and nothing is guessed. The client is also M06's route-matrix port.
 */
@Module({
  providers: [{ provide: M14_ROUTING, useFactory: (config: AppConfig) => config.m14Routing, inject: [APP_CONFIG] }, M14RouteClient],
  exports: [M14RouteClient],
})
export class M14RoutingModule {}
