CREATE TABLE "project_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'project' NOT NULL,
	"conversation_id" text,
	"kind" text DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_memory_scope_check" CHECK ("project_memory"."scope" IN ('project', 'conversation')),
	CONSTRAINT "project_memory_kind_check" CHECK ("project_memory"."kind" IN ('decision', 'architecture', 'rule', 'note'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"trigger_message_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"active_agent_id" text,
	"error" text DEFAULT '' NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" IN ('running', 'done', 'error', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "task_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"conversation_id" text NOT NULL,
	"run_id" text,
	"tool_call_id" text,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "task_artifacts_kind_check" CHECK ("task_artifacts"."kind" IN ('report', 'diff', 'log', 'test_result', 'file'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_active_agent_id_agents_id_fk" FOREIGN KEY ("active_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_memory_scope" ON "project_memory" USING btree ("scope","conversation_id");--> statement-breakpoint
CREATE INDEX "runs_conversation_started" ON "runs" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "task_artifacts_task" ON "task_artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_artifacts_conversation" ON "task_artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "task_artifacts_run" ON "task_artifacts" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_run" ON "tasks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tool_calls_run" ON "tool_calls" USING btree ("run_id");