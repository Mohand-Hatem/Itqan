import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { accessCodeKey } from "./code-batches/crypto";

async function bootstrap() {
  // Fail at startup, not on the first code redemption, when a production secret is missing.
  accessCodeKey();
  const app = configureApp(await NestFactory.create(AppModule));

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
}

bootstrap();
