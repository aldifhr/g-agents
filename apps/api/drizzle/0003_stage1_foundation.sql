-- Stage 1: foundation.
-- Decouple providers from agents, add personas, normalize conversation kinds
-- and turn policy, and move every timestamp to timestamptz.
--
-- This migration is written by hand because it backfills data: the old
-- one-provider-per-agent shape is lifted into a shared `providers` table and
-- the agent keeps a `provider_id` pointer.

--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"encrypted_api_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Lift each agent provider into a shared provider row, then point the agent at it.
INSERT INTO "providers" ("id", "name", "base_url", "encrypted_api_key", "created_at", "updated_at")
SELECT
	ap."agent_id",
	COALESCE(NULLIF(a."name", ''), 'Provider') || ' provider',
	ap."base_url",
	ap."encrypted_api_key",
	COALESCE(ap."updated_at"::timestamptz, now()),
	COALESCE(ap."updated_at"::timestamptz, now())
FROM "agent_providers" ap
LEFT JOIN "agents" a ON a."id" = ap."agent_id";
--> statement-breakpoint

-- New agent columns: provider pointer, model, persona, settings.
ALTER TABLE "agents" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "persona_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

UPDATE "agents" a
SET
	"provider_id" = ap."agent_id",
	"model" = COALESCE(ap."model", '')
FROM "agent_providers" ap
WHERE ap."agent_id" = a."id";--> statement-breakpoint

ALTER TABLE "agents" ADD CONSTRAINT "agents_provider_id_providers_id_fk"
	FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_persona_id_personas_id_fk"
	FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Agent timestamps to timestamptz.
ALTER TABLE "agents" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint

-- Conversation columns: turn policy, creator, settings.
ALTER TABLE "conversations" ADD COLUMN "turn_policy" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "created_by" text DEFAULT 'You' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

UPDATE "conversations" SET "turn_policy" = CASE
	WHEN "kind" = 'dm' THEN 'single'
	WHEN "kind" = 'chat' THEN 'mentions'
	ELSE 'rounds'
END;--> statement-breakpoint

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_turn_policy_check"
	CHECK ("conversations"."turn_policy" IN ('single', 'mentions', 'rounds'));--> statement-breakpoint

ALTER TABLE "conversations" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint

-- Membership policy columns.
ALTER TABLE "conversation_agents" ADD COLUMN "can_speak" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_agents" ADD COLUMN "can_act" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_agents" ADD COLUMN "joined_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Runs: finished_at -> ended_at, timestamps to timestamptz.
ALTER TABLE "runs" RENAME COLUMN "finished_at" TO "ended_at";--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "started_at" TYPE timestamp with time zone USING "started_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "ended_at" TYPE timestamp with time zone USING "ended_at"::timestamptz;

--> statement-breakpoint
-- Messages: sender -> sender_type, add parts/status/run_id, timestamps.
ALTER TABLE "messages" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "status" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint

UPDATE "messages" SET "sender_type" = "sender";--> statement-breakpoint
UPDATE "messages" SET "parts" = jsonb_build_array(jsonb_build_object('type', 'text', 'text', "text"));--> statement-breakpoint

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_sender_check";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "sender";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_check" CHECK ("messages"."sender_type" IN ('user', 'agent', 'system'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_status_check" CHECK ("messages"."status" IN ('complete', 'streaming', 'error'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk"
	FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "messages_run" ON "messages" USING btree ("run_id");--> statement-breakpoint

-- Tasks, tool_calls, project_memory, task_artifacts timestamps.
ALTER TABLE "tasks" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project_memory" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "project_memory" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project_memory" ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "project_memory" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "task_artifacts" ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "task_artifacts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint

-- The old provider table is now redundant.
DROP TABLE "agent_providers";

--> statement-breakpoint
-- Stage 2: execution records.
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent_id" text,
	"task_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" IN ('running', 'done', 'error', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"agent_run_id" text,
	"provider_id" text,
	"model" text DEFAULT '' NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"covers_until_message_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_run" ON "agent_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "usage_events_run" ON "usage_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "usage_events_agent_run" ON "usage_events" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "conversation_summaries_conversation" ON "conversation_summaries" USING btree ("conversation_id","created_at");
