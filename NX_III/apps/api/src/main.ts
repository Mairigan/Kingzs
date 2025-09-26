import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NXLogger } from '@nx-exchange/common';
import * as helmet from 'helmet';
import * as compression from 'compression';
import { ThrottlerGuard } from '@nestjs/throttler';

async function bootstrap() {
  const logger = NXLogger.getInstance();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log']
  });

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || [],
    credentials: true,
  });

  // Global validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Rate limiting
  app.useGlobalGuards(new ThrottlerGuard(app.get(ThrottlerGuard)));

  // Global prefix
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  logger.info(`🚀 NX Exchange API running on port ${port}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});