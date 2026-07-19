import { Module } from '@nestjs/common'
import { CryptoService } from './crypto.service'
import { ProviderController } from './provider.controller'
import { ProviderService } from './provider.service'

@Module({
  controllers: [ProviderController],
  providers: [CryptoService, ProviderService],
  exports: [CryptoService, ProviderService],
})
export class ProviderModule {}
