import { DynamicModule, Module } from '@nestjs/common';
import { JsonLogger } from './json-logger';

export const APP_LOGGER = Symbol('APP_LOGGER');

@Module({})
export class LoggingModule {
  static forRoot(logger: JsonLogger): DynamicModule {
    return {
      module: LoggingModule,
      global: true,
      providers: [{ provide: APP_LOGGER, useValue: logger }],
      exports: [APP_LOGGER],
    };
  }
}
