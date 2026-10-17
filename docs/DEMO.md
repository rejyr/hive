# Demo — "We used Hive to build Hive"

Format: 90-second video (public link) + the same flow live at the table. Three laptops, three people, one phone camera. No props. Simulated drafts only — nothing real is sent, ever.

## The beats

| Time | Shot | What happens | On the dashboard |
|---|---|---|---|
| 0:00–0:10 | Wide: three people working, normal terminal chaos | VO: "Three of us, three Claude sessions. Normally these agents know nothing about each other." | — |
| 0:10–0:20 | Cut to dashboard | VO: "Hive. Your team's agents, finally working as a team." | 3 presence avatars, live feed scrolling real events |
| 0:20–0:40 | A finishes work ("server's deployed — schema and endpoint are in the hive"), stands up, leaves | Coffee beat. Camera holds on A's empty chair + screen | A's SHARE events land |
| 0:40–1:00 | B, building the dashboard, needs A's endpoint + schema. Asks their Claude. Instant answer | VO: "No Slack ping. No 'wait till he's back.'" Empty chair in frame | RECALL event: "from A's session · 2 min ago" |
| 1:00–1:15 | C starts documenting setup steps → agent: "A already wrote these, 10 min ago — building on them instead" | The prevented duplicate | DEDUPE event + "duplicates prevented" counter ticks |
| 1:15–1:30 | Someone types "where are we?" → Queen synthesis of all three workstreams | VO: "That's the standup we never had to have. Today it was three of us shipping a startup. Tomorrow it's any team whose agents need to work as one." | QUEEN event card fills |

End card: logo · "Your team's agents, finally working as a team." · hive.style.dev · GitHub URL.

## Filming plan

- One phone (wide shot, landscape, stable against a water bottle) + QuickTime screen recordings on all three laptops + a screen recording of the dashboard. Cut in iMovie/CapCut — no fancy editing, real speed, captions for the two money moments (RECALL and DEDUPE).
- Record the RECALL beat for real but rehearsed: seed the hive with the day's actual build context first (`scripts/seed.js` only if live data is messy).
- Shoot by **3:30pm**, leaving 30 min to cut and upload (unlisted YouTube = public link). Rehearse the full 90s twice before recording.

## Live table version (judges walk up)

Laptops turned outward, dashboard on the biggest screen. Run one live beat only — B recalling A's context — then talk over the feed history. Have the kill answer ready: close the server tab? Everything reconnects.

## Hard rules

- No real emails/messages; outreach content, if shown, is drafts in the ledger.
- Never fake an event on camera — seed beforehand instead; everything that moves on screen must be a real server event.
