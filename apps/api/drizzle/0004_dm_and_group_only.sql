-- Drop the `chat` room kind.
--
-- A room with several agents is one thing; whether they all speak or only the
-- ones you call is the turn policy, not a different kind of room. So a `chat`
-- becomes a group with the `mentions` policy, keeping its messages and members.
--
--> statement-breakpoint
UPDATE "conversations" SET "kind" = 'group', "turn_policy" = 'mentions' WHERE "kind" = 'chat';--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_check";--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_check" CHECK ("conversations"."kind" IN ('dm', 'group'));
