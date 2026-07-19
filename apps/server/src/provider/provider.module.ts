import { Module } from '@nestjs/common'
import { CryptoService } from './crypto.service'
import { ProviderController } from './provider.controller'
import { ProviderResolverService } from './provider-resolver.service'
import { ProviderService } from './provider.service'

@Module({
  controllers: [ProviderController],
  providers: [CryptoService, ProviderService, ProviderResolverService],
  exports: [CryptoService, ProviderService, ProviderResolverService],
})
export class ProviderModule {}
