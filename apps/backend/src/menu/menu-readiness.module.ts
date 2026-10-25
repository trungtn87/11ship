import { Module } from '@nestjs/common';
import { MenuReadinessReader } from './menu-readiness-reader';

/**
 * The menu fact the shop setup needs (issue #190). It imports nothing, so the shop-setup module can use it without importing MenuModule (which
 * itself uses shop-setup): the module graph stays acyclic and needs no forwardRef.
 */
@Module({ providers: [MenuReadinessReader], exports: [MenuReadinessReader] })
export class MenuReadinessModule {}
