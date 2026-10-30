import { Module } from '@nestjs/common';
import { AddressChangeRepository } from './address-change-repository';

@Module({
  providers: [AddressChangeRepository],
  exports: [AddressChangeRepository],
})
export class AddressChangeReadModule {}
