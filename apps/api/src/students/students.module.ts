import { Module } from "@nestjs/common";
import { ProvisioningModule } from "../provisioning/provisioning.module.js";
import { DevicesController, StudentsAccessController } from "./students-access.controller.js";
import { StudentsAccessService } from "./students-access.service.js";
import { StudentsController } from "./students.controller.js";
import { StudentsService } from "./students.service.js";

@Module({
  imports: [ProvisioningModule],
  controllers: [DevicesController, StudentsAccessController, StudentsController],
  providers: [StudentsAccessService, StudentsService],
  exports: [StudentsAccessService, StudentsService],
})
export class StudentsModule {}
