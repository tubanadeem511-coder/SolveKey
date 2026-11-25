import { q } from "./db.js";
import { runPipeline } from "./agents/orchestrator.js";
import { createNotification } from "./notifications.js";

const MAX_ATTEMPTS = 3;
const LOCK_DURATION_MINUTES = 5;

export function startReportWorker(io) {
  let running = false;

  async function processNext() {
    if (running) return;
    running = true;
    let currentJob = null;
    try {
      const { rows: jobs } = await q(
        `WITH candidate AS (
           SELECT report_id FROM report_jobs
           WHERE (status='queued' AND available_at <= now())
              OR (status='processing' AND locked_until < now())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE report_jobs job
         SET status='processing',
             attempts=job.attempts+1,
             locked_until=now() + ($1::int * interval '1 minute'),
             updated_at=now()
         FROM candidate
         WHERE job.report_id=candidate.report_id
         RETURNING job.report_id,job.attempts`,
        [String(LOCK_DURATION_MINUTES)]
      );
      if (!jobs.length) return;

      currentJob = jobs[0];
      const { rows: reports } = await q(
        `SELECT r.id,r.user_id,r.image_url,r.lat,r.lng,r.address,r.category,r.description,
           EXISTS (
             SELECT 1 FROM agent_logs log
             WHERE log.report_id=r.id AND log.agent_name='VisionAgent'
               AND log.output->>'submissionPrecheck'='true'
               AND log.output->>'civic_relevant'='true'
           ) AS classification_prevalidated
         FROM reports r WHERE r.id=$1`,
        [currentJob.report_id]
      );
      if (!reports.length) {
        await q(
          `UPDATE report_jobs SET status='failed',last_error=$2,locked_until=NULL,updated_at=now()
           WHERE report_id=$1`,
          [currentJob.report_id, "Associated report no longer exists"]
        );
        return;
      }

      await runPipeline({ report: reports[0], io });
      await q(
        `UPDATE report_jobs SET status='completed',last_error=NULL,locked_until=NULL,updated_at=now()
         WHERE report_id=$1`,
        [currentJob.report_id]
      );
    } catch (error) {
      console.error("Report worker failed", error);
      if (currentJob) await recordFailure(currentJob.report_id, currentJob.attempts, error, io);
    } finally {
      running = false;
    }
  }

  async function recordFailure(reportId, attempts, error, socketServer) {
    const shouldRetry = attempts < MAX_ATTEMPTS;
    await q(
      `UPDATE report_jobs
       SET status=$2,
           available_at=CASE WHEN $2='queued' THEN now() + interval '30 seconds' ELSE available_at END,
           locked_until=NULL,
           last_error=$3,
           updated_at=now()
       WHERE report_id=$1`,
      [reportId, shouldRetry ? "queued" : "failed", error instanceof Error ? error.message : String(error)]
    );
    if (!shouldRetry) {
      const { rows } = await q(`SELECT user_id FROM reports WHERE id=$1`, [reportId]);
      if (rows[0]?.user_id) {
        await createNotification({
          userId: rows[0].user_id,
          type: "report_analysis",
          title: "Report analysis could not finish",
          body: `AI analysis for report #${reportId} failed after ${attempts} attempts. The report remains saved.`,
          payload: { reportId },
          io: socketServer,
        });
      }
    }
  }

  const timer = setInterval(() => {
    void processNext().catch((error) => console.error("Report worker polling failed", error));
  }, 1000);
  timer.unref?.();
  void processNext();
  return () => clearInterval(timer);
}
