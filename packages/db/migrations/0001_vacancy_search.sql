-- Обычный array_to_string помечен STABLE, а выражение генерируемого столбца должно быть IMMUTABLE.
-- Для text[] результат от настроек сессии не зависит, так что обёртка честно IMMUTABLE.
CREATE FUNCTION immutable_array_to_string(text[], text) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
	RETURN array_to_string($1, $2);--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', "title"), 'A')
  || setweight(to_tsvector('russian', coalesce("company", '') || ' ' || immutable_array_to_string("skills", ' ')), 'B')
  || setweight(to_tsvector('russian', "summary" || ' ' || immutable_array_to_string("locations", ' ') || ' ' || coalesce("salary_raw", '')), 'C')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "vacancies_search_vector_index" ON "vacancies" USING gin ("search_vector");