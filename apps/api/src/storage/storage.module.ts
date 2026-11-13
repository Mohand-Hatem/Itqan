import { Module } from "@nestjs/common";
import { StorageService } from "./storage.service.js";

// Factory, not class injection: the service's only argument is an optional config loader.
@Module({
  providers: [{ provide: StorageService, useFactory: () => new StorageService() }],
  exports: [StorageService],
})
export class StorageModule {}
