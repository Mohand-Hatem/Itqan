import { Module } from "@nestjs/common";
import { QuestionBanksController } from "./question-banks.controller.js";
import { QuestionBanksService } from "./question-banks.service.js";

@Module({
  controllers: [QuestionBanksController],
  providers: [QuestionBanksService],
  exports: [QuestionBanksService],
})
export class QuestionBanksModule {}
