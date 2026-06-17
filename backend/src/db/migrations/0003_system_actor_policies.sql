CREATE POLICY "orders_system" ON "orders" AS PERMISSIVE FOR ALL TO "app_rw"
  USING (nullif(current_setting('app.system', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.system', true), '') = 'on');

CREATE POLICY "payments_system" ON "payments" AS PERMISSIVE FOR ALL TO "app_rw"
  USING (nullif(current_setting('app.system', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.system', true), '') = 'on');
