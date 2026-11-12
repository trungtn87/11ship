import { Module } from '@nestjs/common';
import { TermsPageController } from './legal.controller';

@Module({ controllers: [TermsPageController] })
export class LegalModule {}
