import { Module } from "@nestjs/common";
import { DevicesController, StudentsAccessController } from "./students-access.controller.js";
import { StudentsAccessService } from "./students-access.service.js";

@Module({
  controllers: [DevicesController, StudentsAccessController],
  providers: [StudentsAccessService],
})
export class StudentsModule {}
