import { Module } from '@nestjs/common';
import { PrivacyPageController, TermsPageController } from './legal.controller';

@Module({ controllers: [TermsPageController, PrivacyPageController] })
export class LegalModule {}
