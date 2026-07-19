import { Module } from '@nestjs/common'
import { CryptoService } from './crypto.service'
import { ProviderController } from './provider.controller'
import { ProviderResolverService } from './provider-resolver.service'
import { ProviderService } from './provider.service'
import { WebdavService } from './webdav.service'

@Module({
  controllers: [ProviderController],
  providers: [CryptoService, ProviderService, ProviderResolverService, WebdavService],
  exports: [CryptoService, ProviderService, ProviderResolverService],
})
export class ProviderModule {}
