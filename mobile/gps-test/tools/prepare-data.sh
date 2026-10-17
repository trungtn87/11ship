#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
# Geofabrik explicitly distributes extracts. Do not substitute public OSM tile servers.
curl --fail --location --retry 4 https://download.geofabrik.de/asia/vietnam-latest.osm.pbf -o vietnam.osm.pbf
source_date="$(osmium fileinfo -g header.option.osmosis_replication_timestamp vietnam.osm.pbf | cut -c1-10)"
test -n "$source_date"
osmium extract -b 106.0,22.43,106.52,22.91 -s complete_ways vietnam.osm.pbf -o map.osm.pbf
osmium export map.osm.pbf -f geojsonseq -o map.geojsonseq
python3 "$root/mobile/gps-test/tools/build-map.py" map.geojsonseq "$root/mobile/gps-test/app/src/main/assets/caobang" --source-date "$source_date"
mkdir -p "$root/ops/m14/data"
# Extra graph buffer for detours outside the displayed package.
osmium extract -b 105.85,22.25,106.70,23.08 -s complete_ways vietnam.osm.pbf -o "$root/ops/m14/data/caobang.osm.pbf" --overwrite
cp "$root/mobile/gps-test/app/src/main/assets/caobang/NOTICE.txt" "$root/ops/m14/data/NOTICE.txt"
sha256sum "$root/ops/m14/data/caobang.osm.pbf"
