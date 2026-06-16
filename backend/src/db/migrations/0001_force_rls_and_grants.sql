ALTER TABLE "addresses"   FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "carts"       FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cart_items"  FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"      FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"    FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reviews"     FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM app_rw;--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM app_rw;
