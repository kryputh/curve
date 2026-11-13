# PostgreSQL restore verification

Run `node output/pg-validation/restore-run.mjs` after supplying absolute executable paths in `PG_DUMP_PATH` and `PG_RESTORE_PATH`. The local ignored runner uses the installed `embedded-postgres` dependency, creates a fresh cluster and two uniquely named databases, and stops that cluster afterward. Its bundled server does not include the dump/restore client utilities; supply compatible PostgreSQL clients separately.

The tracked `scripts/verify-restore.mjs` accepts `CURVE_RESTORE_SOURCE_URL` and `CURVE_RESTORE_TARGET_URL`. Both must point at empty local databases whose names match `curve_restore_<hex>_source` or `_target`; it refuses populated databases and identical names. It never drops databases. Credentials reach PostgreSQL utilities through environment variables, not command-line arguments or stdout.

Verification registers two real tenant accounts, creates a project, ingests five canonical OTLP histogram observations, stops the application, creates a custom-format PostgreSQL backup, restores the empty target, and starts the application against the restored database. It asserts that the original session cookie still works, API request totals remain five, and the other tenant's original cookie remains unable to read the project.

The temporary backup and disposable stopped cluster remain on disk for inspection. These contain test data only. This exercise does not cover Umami's separate database, deployment secrets, or object storage, and is not a production backup policy. Never substitute production database URLs.
