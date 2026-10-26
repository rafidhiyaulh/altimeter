#!/bin/sh
# Run SQL against the shared Supabase project over HTTPS (Management API), as the postgres role.
# usage: scripts/dbq.sh "select 1"   |   scripts/dbq.sh -f path/to/file.sql
# The project is linked in ../perisai (same Singapore project; Altimeter lives in its own schemas).
WORKDIR="${ALT_SUPABASE_WORKDIR:-$HOME/Developer/perisai}"
if [ "$1" = "-f" ]; then
  exec supabase db query --linked --workdir "$WORKDIR" --output-format json -f "$2" 2>&1 | grep -v -e 'new version of Supabase CLI' -e 'recommend updating regularly'
else
  exec supabase db query --linked --workdir "$WORKDIR" --output-format json "$1" 2>&1 | grep -v -e 'new version of Supabase CLI' -e 'recommend updating regularly'
fi
