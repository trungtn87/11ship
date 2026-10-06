import { DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './app-config';

@Module({})
export class ConfigModule {
  // The configuration is validated once by the caller (main.ts or a test) and injected,
  // so the module itself never reads process.env.
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
