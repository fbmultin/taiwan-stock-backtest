#!/bin/bash
# Step 0 重跑:全部工作排成清單,2 核平行(xargs -P 2),長的排前面。
# 每個工作輸出到自己的檔案;所有種子由 rerunlib.js 的基準種子決定,與執行順序無關。
cd "$(dirname "$0")"
mkdir -p out
{
  for c in A 0051 0055 006201; do echo "gate $c 1 0 4000 out/gate_${c}_L1.jsonl"; done
  for e in 0051 0055 0052 0053 0057 006201 006203 006204; do echo "shift $e 0 2000 out/shift_${e}.jsonl"; done
  for c in A 0051 0055 006201; do for L in 5 10 20 60 250; do echo "gate $c $L 0 4000 out/gate_${c}_L${L}.jsonl"; done; done
  for c in A 0051 0055 006201; do for d in 5 10 15 20 30 40; do echo "power $c $d 0 500 out/power_${c}_d${d}.jsonl"; done; done
  echo "bcmp 0 500 out/bcmp_A_L20.jsonl"
  for c in A 0051 0055 006201; do echo "COV $c"; done
} > out/jobs.txt
run() {
  if [ "$1" = "COV" ]; then node coverage.js "$2" "out/coverage_$2.json"; else node rerun.js "$@"; fi
  echo "$(date +%T) done $*" >> out/progress.log
}
export -f run
xargs -P 2 -L 1 bash -c 'run "$@"' _ < out/jobs.txt
echo ALLDONE >> out/progress.log
