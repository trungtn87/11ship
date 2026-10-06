# Fixtures

M00-B1 has no business fixtures: there are no business tables yet.

The transaction tests (F04) create and drop their own temporary tables on a single connection, so
nothing here is loaded into a shared schema. Add fixtures to this folder only together with the
migration that creates the tables they populate, and never load them into DEV or production data.
