import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { chat, AIConfigurationError, loadSkill } from "./agents/gemini.js";
import { asyncRoute } from "./async-route.js";
import { q } from "./db.js";
import { requireAuth } from "./auth.js";

export const assistant = Router();

const assistantRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 8,
  message: { error: "Too many assistant requests, please try again later" },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1200),
});

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const imageMediaTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

class ChatImageTooLargeError extends Error {}

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(12),
  image_base64: z.string().min(1).optional(),
  media_type: imageMediaTypeSchema.optional(),
}).refine(
  ({ image_base64, media_type }) =>
    (image_base64 === undefined) === (media_type === undefined),
);

function validateChatImage(imageBase64, mediaType) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      imageBase64
    )
  ) {
    throw new Error("Invalid image data");
  }

  const image = Buffer.from(imageBase64, "base64");

  if (image.length > MAX_IMAGE_BYTES) {
    throw new ChatImageTooLargeError();
  }

  if (!image.length || image.toString("base64") !== imageBase64) {
    throw new Error("Invalid image size or encoding");
  }

  const signatureMatches =
    mediaType === "image/jpeg"
      ? image.length >= 3 &&
        image[0] === 0xff &&
        image[1] === 0xd8 &&
        image[2] === 0xff
      : mediaType === "image/png"
        ? image
            .subarray(0, 8)
            .equals(
              Buffer.from([
                0x89,
                0x50,
                0x4e,
                0x47,
                0x0d,
                0x0a,
                0x1a,
                0x0a,
              ])
            )
        : image.length >= 12 &&
          image.toString("ascii", 0, 4) === "RIFF" &&
          image.toString("ascii", 8, 12) === "WEBP";

  if (!signatureMatches) {
    throw new Error("Image content does not match its media type");
  }
}

assistant.post(
  "/chat",
  assistantRateLimit,
  requireAuth,
  asyncRoute(async (req, res) => {
    try {
      const imageBase64 = req.body?.image_base64;

      if (
        typeof imageBase64 === "string" &&
        (
          imageBase64.length > MAX_IMAGE_BASE64_LENGTH ||
          (
            imageBase64.length === MAX_IMAGE_BASE64_LENGTH &&
            !imageBase64.endsWith("=")
          )
        )
      ) {
        return res.status(413).json({
          error: "Chat images must be 5 MB or smaller.",
        });
      }

      const parsed = chatRequestSchema.safeParse(req.body);

      if (
        !parsed.success ||
        parsed.data.messages.at(-1)?.role !== "user"
      ) {
        return res.status(400).json({
          error:
            "Provide up to 12 user/assistant messages ending with a user message.",
        });
      }

      if (parsed.data.image_base64) {
        try {
          validateChatImage(
            parsed.data.image_base64,
            parsed.data.media_type
          );
        } catch (error) {
          if (error instanceof ChatImageTooLargeError) {
            return res.status(413).json({
              error: "Chat images must be 5 MB or smaller.",
            });
          }

          return res.status(400).json({
            error: "The image must be valid JPEG, PNG, or WEBP data.",
          });
        }
      }

      const question = parsed.data.messages.at(-1).content;

      const escapedQuestion = question.replace(
        /[\\%_]/g,
        "\\$&"
      );

      // ------------------------------------------------------------
      // Load report context from PostgreSQL.
      // Keep this separate from the Gemini try/catch so production
      // database errors are visible and return a useful response.
      // ------------------------------------------------------------

      let publicReports;
      let ownReports;

      try {
        console.log("SolveKey assistant: loading report context");

        [publicReports, ownReports] = await Promise.all([
          q(
            `SELECT id,category,severity,status,description,summary,address,created_at
             FROM reports
             WHERE duplicate_of IS NULL
               AND concat_ws(' ',category,description,summary,address)
                   ILIKE $1 ESCAPE '\\'
             ORDER BY created_at DESC
             LIMIT 8`,
            [`%${escapedQuestion}%`]
          ),

          q(
            `SELECT id,category,severity,status,description,summary,created_at
             FROM reports
             WHERE user_id=$1
             ORDER BY created_at DESC
             LIMIT 5`,
            [req.user.id]
          ),
        ]);

        console.log(
          "SolveKey assistant: report context loaded",
          {
            publicReports: publicReports.rows.length,
            ownReports: ownReports.rows.length,
          }
        );
      } catch (error) {
        console.error(
          "SolveKey assistant database error:",
          error?.name || "Error",
          error?.message || error
        );

        if (error?.stack) {
          console.error(error.stack);
        }

        return res.status(500).json({
          error: "The AI assistant could not load report data.",
        });
      }

      const context = {
        matching_public_reports: publicReports.rows,
        current_user_reports: ownReports.rows,
      };

      const messages = parsed.data.messages.map(
        ({ role, content }) => ({
          role,
          content,
        })
      );

      if (parsed.data.image_base64) {
        const lastMessage = messages.at(-1);

        lastMessage.content = [
          {
            type: "text",
            text: lastMessage.content,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.data.media_type,
              data: parsed.data.image_base64,
            },
          },
        ];
      }

      // ------------------------------------------------------------
      // Gemini request
      // ------------------------------------------------------------

      try {
        console.log("SolveKey assistant: sending request to Gemini");

        const answer = await chat({
          system: [
            loadSkill("civic-assistant"),

            "You are SolveKey's civic-services assistant for Karachi.",

            "Use only the supplied report context for claims about SolveKey reports, counts, statuses, locations, and departments.",

            "If the supplied context does not answer a question, say that you cannot verify it and suggest checking the relevant official agency.",

            "Do not claim that a report was filed, changed, or escalated unless the API explicitly confirms that action.",

            "Do not expose another resident's identity or private account details.",

            "When an image is attached, analyze visible civic issues such as road or footpath damage, public waste, water supply, leakage, drainage, street lights, or public electrical infrastructure. Describe only visible evidence and state when the image is unclear.",

            `Report context: ${JSON.stringify(context)}`,
          ].join("\n"),

          messages,
        });

        console.log("SolveKey assistant: Gemini response received");

        return res.json({ answer });
      } catch (error) {
        console.error(
          "SolveKey assistant Gemini error:",
          error?.name || "Error",
          error?.message || error
        );

        if (error?.status) {
          console.error(
            "SolveKey assistant Gemini status:",
            error.status
          );
        }

        if (error?.stack) {
          console.error(error.stack);
        }

        if (error instanceof AIConfigurationError) {
          return res.status(503).json({
            error:
              "The AI assistant is unavailable until GEMINI_API_KEY is configured.",
          });
        }

        return res.status(502).json({
          error: "The AI assistant could not complete this request.",
        });
      }
    } catch (error) {
      console.error(
        "SolveKey assistant unexpected error:",
        error?.name || "Error",
        error?.message || error
      );

      if (error?.stack) {
        console.error(error.stack);
      }

      return res.status(500).json({
        error: "The AI assistant encountered an unexpected error.",
      });
    }
  })
);

assistant.get(
  "/recommendations",
  requireAuth,
  asyncRoute(async (req, res) => {
    const [history, lastReport] = await Promise.all([
      q(
        `SELECT category,COUNT(*)::int AS count
         FROM reports
         WHERE user_id=$1 AND category IS NOT NULL
         GROUP BY category
         ORDER BY count DESC,category
         LIMIT 3`,
        [req.user.id]
      ),

      q(
        `SELECT lat,lng
         FROM reports
         WHERE user_id=$1
         ORDER BY created_at DESC
         LIMIT 1`,
        [req.user.id]
      ),
    ]);

    if (!lastReport.rows.length) {
      return res.json({
        items: [],
        message:
          "Submit a report to get recommendations based on your activity and area.",
      });
    }

    const preferredCategories = history.rows.map(
      (row) => row.category
    );

    const { rows } = await q(
      `SELECT
         r.id,
         r.lat,
         r.lng,
         r.category,
         r.severity,
         r.status,
         r.description,
         r.summary,
         r.image_url,
         r.department_id,
         d.name AS department_name,
         r.upvotes,
         r.created_at,
         (
           6371000 * acos(
             LEAST(
               1,
               cos(radians($1))
               * cos(radians(r.lat))
               * cos(radians(r.lng) - radians($2))
               + sin(radians($1))
               * sin(radians(r.lat))
             )
           )
         ) AS distance_m
       FROM reports r
       LEFT JOIN departments d
         ON d.id=r.department_id
       WHERE r.user_id IS DISTINCT FROM $3
         AND r.duplicate_of IS NULL
         AND r.status IN ('pending','reported','in_progress')
       ORDER BY
         CASE
           WHEN r.category = ANY($4::text[])
           THEN 0
           ELSE 1
         END,
         distance_m ASC,
         r.severity DESC NULLS LAST,
         r.created_at DESC
       LIMIT 20`,
      [
        lastReport.rows[0].lat,
        lastReport.rows[0].lng,
        req.user.id,
        preferredCategories,
      ]
    );

    const items = rows.slice(0, 5).map((report) => ({
      ...report,

      reason: preferredCategories.includes(report.category)
        ? `Similar to your recent ${report.category.replaceAll(
            "_",
            " "
          )} reports; ${Math.round(
            report.distance_m
          )} m from your last report`
        : report.distance_m <= 2000
          ? `Nearby open issue, ${Math.round(
              report.distance_m
            )} m from your last report`
          : `Open community issue, ${Math.round(
              report.distance_m
            )} m from your last report`,
    }));

    res.json({ items });
  })
);
