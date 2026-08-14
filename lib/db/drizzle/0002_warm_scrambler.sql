CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
