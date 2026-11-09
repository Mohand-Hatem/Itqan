import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantMiddleware } from "./tenant.middleware.js";
import { TenantResolver } from "./tenant-resolver.js";

@Module({
  imports: [DatabaseModule],
  providers: [TenantResolver],
  exports: [TenantResolver],
})
export class TenancyModule implements NestModule {
  // Every route needs a tenant (or the admin host) except health checks.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).exclude("health").forRoutes("*path");
  }
}
