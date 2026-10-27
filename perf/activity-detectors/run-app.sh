#!/bin/bash
# Launch the real app with the perf sampler enabled, measure startup and
# shutdown, and restore the user's prefs afterwards.
# usage: perf/activity-detectors/run-app.sh <checkout-dir> <label> <seconds> <out-dir>
set -u
REPO="$1"; LABEL="$2"; SECS="$3"; OUT="$4"
PREFS="$HOME/Library/Application Support/Desktop Pets/desktop-pets-prefs.json"
mkdir -p "$OUT"
[ -f "$PREFS" ] && cp -p "$PREFS" "$OUT/.prefs-backup.json"
rm -f "$OUT/$LABEL.jsonl"
cd "$REPO"
now() { python3 -c 'import time; print(time.time())'; }
T0=$(now)
DESKTOP_PETS_PERF_LOG="$OUT/$LABEL.jsonl" DESKTOP_PETS_PERF_LABEL="$LABEL" npm start > "$OUT/$LABEL.stdout.log" 2>&1 &
for _ in $(seq 1 300); do grep -q "listening on" "$OUT/$LABEL.stdout.log" && break; sleep 0.1; done
T1=$(now)
echo "startup_to_server_listening_s=$(python3 -c "print(round($T1-$T0,2))")" > "$OUT/$LABEL.lifecycle.txt"
sleep "$SECS"
PID=$(pgrep -f "Electron.app/Contents/MacOS/Electron \.$")
T2=$(now)
kill -TERM "$PID"
while kill -0 "$PID" 2>/dev/null; do sleep 0.1; done
T3=$(now)
echo "shutdown_after_sigterm_s=$(python3 -c "print(round($T3-$T2,2))")" >> "$OUT/$LABEL.lifecycle.txt"
echo "runtime_json_after_exit=$([ -f ~/.clawd/runtime.json ] && echo present || echo removed)" >> "$OUT/$LABEL.lifecycle.txt"
[ -f "$OUT/.prefs-backup.json" ] && cp -p "$OUT/.prefs-backup.json" "$PREFS" && rm "$OUT/.prefs-backup.json"
