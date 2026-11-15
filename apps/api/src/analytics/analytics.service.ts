import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, Prisma, type ScopedPrismaClient } from "@itqan/database";
import type { AnalyticsOverviewResponseDto } from "@itqan/shared";
import { SCOPED_PRISMA } from "../database/database.module.js";

type RawAnalyticsRow = {
  students: number | bigint | string;
  activeStudents7d: number | bigint | string;
  courses: number | bigint | string;
  publishedItems: number | bigint | string;
  quizParticipation: number | bigint | string;
  averageGrade: number | string | null;
  pendingRequests: number | bigint | string;
};

@Injectable()
export class AnalyticsService {
  constructor(@Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient) {}

  /**
   * Plain SQL analytics overview (FR-L02, step 9.9a).
   * Aggregates all 7 metrics in a single database round trip directly in PostgreSQL.
   */
  async getOverview(): Promise<AnalyticsOverviewResponseDto> {
    const context = getRequestContext();
    if (context?.kind !== "tenant") throw new NotFoundException();
    const tenantId = context.tenantId;

    const rows = await this.db.$queryRaw<RawAnalyticsRow[]>(Prisma.sql`
      WITH
        student_counts AS (
          SELECT
            COUNT(*)::int AS total_students,
            COUNT(DISTINCT CASE
              WHEN (
                EXISTS (
                  SELECT 1 FROM sessions s
                  WHERE s.tenant_id = ${tenantId}::uuid
                    AND s.user_id = m.user_id
                    AND s.updated_at >= NOW() - INTERVAL '7 days'
                )
                OR EXISTS (
                  SELECT 1 FROM lesson_progress lp
                  WHERE lp.tenant_id = ${tenantId}::uuid
                    AND lp.membership_id = m.id
                    AND lp.updated_at >= NOW() - INTERVAL '7 days'
                )
                OR EXISTS (
                  SELECT 1 FROM attempts a
                  WHERE a.tenant_id = ${tenantId}::uuid
                    AND a.membership_id = m.id
                    AND a.created_at >= NOW() - INTERVAL '7 days'
                )
              ) THEN m.user_id
            END)::int AS active_students_7d
          FROM memberships m
          WHERE m.tenant_id = ${tenantId}::uuid
            AND m.role = 'student'
            AND m.status = 'active'
        ),
        course_counts AS (
          SELECT COUNT(*)::int AS total_courses
          FROM courses c
          WHERE c.tenant_id = ${tenantId}::uuid
            AND c.deleted_at IS NULL
        ),
        item_counts AS (
          SELECT COUNT(*)::int AS published_items
          FROM content_items ci
          WHERE ci.tenant_id = ${tenantId}::uuid
            AND ci.deleted_at IS NULL
            AND ci.published_at IS NOT NULL
        ),
        attempt_stats AS (
          SELECT
            COUNT(*)::int AS quiz_participation,
            ROUND(
              AVG(
                CASE
                  WHEN a.submitted_at IS NOT NULL AND a.max_score > 0 AND a.score IS NOT NULL
                  THEN (a.score::numeric / a.max_score::numeric * 100.0)
                END
              ),
              2
            )::float AS average_grade
          FROM attempts a
          WHERE a.tenant_id = ${tenantId}::uuid
        ),
        request_counts AS (
          SELECT COUNT(*)::int AS pending_requests
          FROM support_requests sr
          WHERE sr.tenant_id = ${tenantId}::uuid
            AND sr.status = 'open'
        )
      SELECT
        sc.total_students AS "students",
        sc.active_students_7d AS "activeStudents7d",
        cc.total_courses AS "courses",
        ic.published_items AS "publishedItems",
        ast.quiz_participation AS "quizParticipation",
        ast.average_grade AS "averageGrade",
        rc.pending_requests AS "pendingRequests"
      FROM
        student_counts sc,
        course_counts cc,
        item_counts ic,
        attempt_stats ast,
        request_counts rc;
    `);

    const row = rows[0] ?? {
      students: 0,
      activeStudents7d: 0,
      courses: 0,
      publishedItems: 0,
      quizParticipation: 0,
      averageGrade: null,
      pendingRequests: 0,
    };

    return {
      students: Number(row.students ?? 0),
      activeStudents7d: Number(row.activeStudents7d ?? 0),
      courses: Number(row.courses ?? 0),
      publishedItems: Number(row.publishedItems ?? 0),
      quizParticipation: Number(row.quizParticipation ?? 0),
      averageGrade:
        row.averageGrade === null || row.averageGrade === undefined
          ? null
          : Number(row.averageGrade),
      pendingRequests: Number(row.pendingRequests ?? 0),
    };
  }
}
