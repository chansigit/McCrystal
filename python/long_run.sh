#!/bin/sh
# Trains without end, an hour at a time, and after each hour plays the policy the way
# the baselines were played (100 characters, six game hours, three seeds). Results
# accumulate in runs/NAME/evals.txt. Stop with: touch runs/NAME/stop
#   sh python/long_run.sh NAME [extra arguments for train_ppo.py]
set -u
cd "$(dirname "$0")/.."
name=$1; shift
export PYTHONPATH=python
mkdir -p "runs/$name"
round=0
while [ ! -e "runs/$name/stop" ]; do
    round=$((round + 1))
    resume=""
    [ -e "runs/$name/policy.pt" ] && resume="--resume runs/$name/policy.pt"
    .venv/bin/python python/train_ppo.py --name "$name" --minutes 60 --seed $((round * 1000)) $resume "$@" >> "runs/$name/train.out" 2>&1 || break
    cp "runs/$name/policy.pt" "runs/$name/policy-$round.pt"
    { echo "== after round $round, $(date '+%Y-%m-%d %H:%M')"; .venv/bin/python python/eval_policy.py "runs/$name/policy.pt" --seeds 42,7,99 2>&1 | tail -8; } >> "runs/$name/evals.txt"
done
