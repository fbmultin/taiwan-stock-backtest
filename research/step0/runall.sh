#!/bin/bash
# 兩條平行工作流,各跑一半的模擬編號;輸出依模式/ETF 分檔,可續跑分析
cd "$(dirname "$0")"
half() { # $1=起 $2=迄 $3=標籤
  node step0run.js garch $1 $2 out/garch_$3.jsonl
  for e in 0050 0056 006208 00692; do node step0run.js shift $1 $2 out/shift_${e}_$3.jsonl $e; done
}
( half 0 1000 a; node step0run.js power 0 250 out/power_a.jsonl; echo done > out/A.done ) &
( half 1000 2000 b; node step0run.js power 250 500 out/power_b.jsonl; echo done > out/B.done ) &
wait
