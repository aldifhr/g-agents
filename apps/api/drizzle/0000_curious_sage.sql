CREATE TABLE "agent_providers" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"encrypted_api_key" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"initials" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_agents" (
	"conversation_id" text NOT NULL,
	"agent_id" text NOT NULL,
	CONSTRAINT "conversation_agents_conversation_id_agent_id_pk" PRIMARY KEY("conversation_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "conversations_kind_check" CHECK ("conversations"."kind" IN ('dm', 'group'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"agent_id" text,
	"sender" text NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "messages_sender_check" CHECK ("messages"."sender" IN ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "space_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "space_meta_id_check" CHECK ("space_meta"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "agent_providers" ADD CONSTRAINT "agent_providers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_agents" ADD CONSTRAINT "conversation_agents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_agents" ADD CONSTRAINT "conversation_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_agents_agent" ON "conversation_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversations_updated" ON "conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created" ON "messages" USING btree ("conversation_id","created_at");