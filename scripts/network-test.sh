#!/bin/bash
set -euo pipefail
# This script requires a disposable Linux container with NET_ADMIN and --network none.
# Only its own loopback interface is changed; no host or production traffic is shaped.
mkdir -p /results
node dist-server/index.mjs > /results/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  if node -e 'fetch("http://127.0.0.1:2567/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then break; fi
  sleep .1
done
# Each direction crosses lo's queue: nominal RTT=150 ms, jitter and real TCP loss.
tc qdisc add dev lo root netem delay 75ms 15ms distribution normal loss 1%
tc -s qdisc show dev lo | tee /results/netem-before.txt
(
  sleep 25
  printf 'Injecting a one-second TCP connection stall\n'
  tc qdisc change dev lo root netem loss 100%
  sleep 1
  tc qdisc change dev lo root netem delay 75ms 15ms distribution normal loss 1%
) &
stall_pid=$!
node dist-tools/loadtest.mjs --endpoint http://127.0.0.1:2567 --seconds 90 --output /results/packet-loss.json
wait "$stall_pid"
tc -s qdisc show dev lo | tee /results/netem-after.txt
