import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import { AppModule } from './app.module'
import { isOriginAllowed, parseCorsOrigins } from './cors.util'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  app.setGlobalPrefix('api')
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/api/uploads/' })

  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }
      callback(null, isOriginAllowed(origin, corsOrigins))
    },
    credentials: true,
  })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

  const port = process.env.PORT || 3001
  await app.listen(port)
  console.log(`🚀 超创平台 API 运行在 http://localhost:${port}`)
}

bootstrap()
