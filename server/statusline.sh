#!/bin/sh
# Claude Code status line that SessionDeck reads for the context bar, e.g. "Opus | 42% ctx (84k/200k)".
# It also keeps the 5-hour and weekly usage in ~/.claude/sessiondeck-usage.json for the limit display and
# the limit pause (Claude.ai subscriptions only, no extra API calls).
# Install on the server:
#   cp statusline.sh ~/.claude/statusline.sh && chmod +x ~/.claude/statusline.sh
# and in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
# Needs jq. Any existing status line works too, as long as it prints "NN% ctx (NNk/NNNk)" somewhere.
input=$(cat)
usage="$HOME/.claude/sessiondeck-usage.json"
{ printf '%s' "$input" | jq -ce '.rate_limits | select(.five_hour)' > "$usage.$$" && mv "$usage.$$" "$usage" || rm -f "$usage.$$"; } 2>/dev/null
printf '%s' "$input" | jq -r '
  .context_window as $c
  | (.model.display_name // "") as $m
  | if ($c.context_window_size // 0) > 0 then
      "\($m) | \(($c.used_percentage // 0) | floor)% ctx (\((($c.total_input_tokens // 0) / 1000) | floor)k/\(($c.context_window_size / 1000) | floor)k)"
    else $m end'
